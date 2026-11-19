// SPDX-License-Identifier: MIT
// W3-L: the opt-in Go toolchain route. Fixtures under
// test/fixtures/graph-go-toolchain/ are compiler-checked (Go 1.27.4):
//   basic, config: `go build ./... && go vet ./...` pass (config also with
//     CGO_ENABLED=1 and with GOOS=windows);
//   conversion: `go build ./... && go vet ./...` pass;
//   library: `go build ./... && go vet ./...` pass (standard library only);
//   typeerror: `go build ./...` fails in package bad only ("cannot use
//     "three" (untyped string constant) as int value"), `go build ./good` passes.
// These tests need the user's `go` (the toolchain route's own requirement);
// without one on PATH they are skipped, and say so.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../dist/graph/index.js";
import go from "../dist/graph/languages/go/index.js";
import { graphConfig, graphToolchains } from "../dist/shared/config.js";

const FIXTURES = fileURLToPath(
  new URL("./fixtures/graph-go-toolchain/", import.meta.url),
);
const haveGo = (process.env.PATH ?? "")
  .split(delimiter)
  .some((dir) => dir && existsSync(join(dir, "go")));
const needsGo = haveGo ? {} : { skip: "no go on PATH (toolchain route)" };

/** Indexes a fixture; returns a readable dump and the report. */
async function index(fixture, options = {}, scratch) {
  const own = !scratch;
  scratch ??= await mkdtemp(join(tmpdir(), "pymtheg-go-toolchain-"));
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "tc");
  try {
    const report = await indexProject(
      join(FIXTURES, fixture),
      new LanguageRegistry([go]),
      store,
      { toolchainDirectory: join(scratch, "toolchain"), ...options },
    );
    const symbols = store.findSymbols();
    const name = (id) => {
      const s = symbols.find((item) => item.id === id);
      return s ? `${s.file}:${s.identity}` : null;
    };
    const links = store
      .links()
      .map((link) => ({
        file: link.file,
        kind: link.kind,
        at: link.targetName,
        start: link.range.start,
        target: name(link.targetId),
        candidates: link.candidates.map((c) => name(c.id)).sort(),
        data: link.data ?? null,
        ...(link.libraries
          ? {
              resolution: link.resolution,
              libraries: link.libraries.map(({ id: _id, ...rest }) => rest),
            }
          : {}),
      }))
      .sort((a, b) =>
        `${a.file}\u0000${a.start}\u0000${a.kind}` <
        `${b.file}\u0000${b.start}\u0000${b.kind}`
          ? -1
          : 1,
      );
    const files = store.files().map((file) => ({
      path: file.path,
      result: file.result,
    }));
    return { report, links, files, symbols };
  } finally {
    store.close();
    if (own) await rm(scratch, { recursive: true, force: true });
  }
}
const on = { toolchains: { go: true } };
const link = (dump, file, at, kind = "calls") => {
  const found = dump.links.filter(
    (item) => item.file === file && item.at === at && item.kind === kind,
  );
  assert.equal(found.length, 1, `${file} ${at}: ${found.length}`);
  return found[0];
};
const note = (report, status) =>
  report.toolchains?.find((item) => item.note.status === status)?.note;

test("the setting: graph.toolchain.go is the explicit opt-in, off by default", () => {
  assert.deepEqual(graphToolchains({ version: 1, scenarios: {} }), {});
  assert.deepEqual(
    graphToolchains({
      version: 1,
      scenarios: {},
      graph: graphConfig({ toolchain: { go: true } }),
    }),
    { go: true },
  );
  assert.deepEqual(
    graphToolchains({
      version: 1,
      scenarios: {},
      graph: graphConfig({ toolchain: { go: false } }),
    }),
    {},
  );
  assert.deepEqual(graphConfig({ toolchain: { go: "/usr/lib/go/bin/go" } }), {
    toolchain: { go: "/usr/lib/go/bin/go" },
  });
  assert.throws(() => graphConfig({ toolchain: { go: "go" } }), /absolute/);
  assert.throws(() => graphConfig({ toolchain: { rust: true } }), /Unknown/);
});

test("opt-in off: no toolchain fact anywhere, the same with no, empty or false settings", async () => {
  const plain = await index("basic");
  const empty = await index("basic", { toolchains: {} });
  const off = await index("basic", { toolchains: { go: false } });
  assert.equal(plain.report.toolchains, undefined);
  assert.deepEqual(empty.links, plain.links);
  assert.deepEqual(off.links, plain.links);
  assert.deepEqual(off.files, plain.files);
  assert.doesNotMatch(JSON.stringify(plain.files), /"tc"|"toolchain"/);
});

test(
  "upgrades: inferred types, generics, promotion, and a verified implementer set",
  needsGo,
  async () => {
    const off = await index("basic");
    const dump = await index("basic", on);
    const available = note(dump.report, "available");
    assert.ok(available, JSON.stringify(dump.report.toolchains));
    assert.equal(available.universeClean, true);
    assert.deepEqual(note(dump.report, "merged").disagreements, []);
    // A method on a generic function's result, and on a generic method's
    // result: unresolved source-only, definite with the toolchain.
    for (const at of ["store.First(files).Write", "b.Get().Write"]) {
      assert.equal(link(off, "app/app.go", at).target, null, at);
      const up = link(dump, "app/app.go", at);
      assert.equal(up.target, "store/store.go:(*File).Write", at);
      assert.equal(up.data.toolchain.origin, "toolchain");
      assert.equal(up.data.toolchain.upgrade, "definite");
      assert.equal(up.data.toolchain.from, "unresolved");
      assert.match(up.data.toolchain.go, /^go1\./);
      assert.match(up.data.toolchain.configuration, /cgo off/);
    }
    // Promotion through an embedded pointer: confirmed.
    assert.equal(
      link(dump, "app/app.go", "c.Close").target,
      "store/store.go:(*Base).Close",
    );
    // Dispatch: the source-only set lists Logger.Write (same counts, other
    // types); the verified set does not.
    assert.ok(
      link(off, "app/app.go", "w.Write").candidates.includes(
        "store/store.go:(Logger).Write",
      ),
    );
    const set = link(dump, "app/app.go", "w.Write");
    assert.deepEqual(set.candidates, [
      "store/store.go:(*File).Write",
      "store/store.go:Writer.Write",
    ]);
    assert.equal(set.data.toolchain.upgrade, "verified");
    assert.deepEqual(set.data.open, {
      reason: "external-implementers-possible",
    });
    // A generic implementer, or one in a _test.go file, may be the dynamic
    // value: no implementer set is claimed, the source-only set stands.
    for (const at of ["s.Shut", "p.Ping"]) {
      const kept = link(dump, "store/store.go", at);
      assert.deepEqual(
        kept.candidates,
        link(off, "store/store.go", at).candidates,
        at,
      );
      assert.equal(kept.data.toolchain, undefined, at);
    }
    // implements: the toolchain's pairs are definite, to the interface, and
    // the same-count Logger is not one; the generic Pool's source-only link
    // stands (the toolchain does not instantiate generics).
    const pairs = dump.links.filter((item) => item.kind === "implements");
    const verified = pairs
      .filter((item) => item.data.origin === "toolchain")
      .map((item) => [item.file, item.at, item.target])
      .sort();
    assert.deepEqual(verified, [
      ["store/store.go", "Writer", "store/store.go:Writer"],
      ["store/store_test.go", "Pinger", "store/store.go:Pinger"],
    ]);
    const writer = pairs.find((item) => item.at === "Writer");
    assert.equal(writer.data.pointerReceiver, true);
    const shutter = pairs.find((item) => item.at === "Shutter");
    assert.equal(shutter.target, null);
    assert.equal(shutter.data.unverified, "structural-match-unverified");
  },
);

test(
  "a package with a type error: it and its importers stay source-only; no implementer sets",
  needsGo,
  async () => {
    const off = await index("typeerror");
    const dump = await index("typeerror", on);
    const available = note(dump.report, "available");
    assert.equal(available.universeClean, false);
    assert.equal(available.packages.clean, 1);
    const status = (path) =>
      dump.files.find((file) => file.path === path).result.data.toolchain
        .status;
    assert.equal(status("good/good.go"), "in-configuration");
    assert.equal(status("bad/bad.go"), "package-has-errors");
    assert.equal(status("uses/uses.go"), "package-has-errors");
    // The importer's link is exactly the source-only one, with no toolchain origin.
    const before = link(off, "uses/uses.go", "bad.Name");
    const after = link(dump, "uses/uses.go", "bad.Name");
    assert.equal(after.target, before.target);
    assert.equal(after.data.toolchain, undefined);
    assert.equal(after.data.tc, undefined);
    // The clean package's own call is confirmed ...
    assert.equal(
      link(dump, "good/good.go", "Talk").data.toolchain.origin,
      "toolchain",
    );
    // ... but its dispatch set and implements pairs need an error-free universe.
    const set = link(dump, "good/good.go", "s.Speak");
    assert.deepEqual(
      set.candidates,
      link(off, "good/good.go", "s.Speak").candidates,
    );
    assert.equal(set.data.toolchain, undefined);
    assert.ok(
      dump.links
        .filter((item) => item.kind === "implements")
        .every(
          (item) => item.data.unverified === "structural-match-unverified",
        ),
    );
  },
);

test(
  "a cgo file and a build-tagged file are outside the configuration, source-only",
  needsGo,
  async () => {
    const off = await index("config");
    const dump = await index("config", on);
    const file = (path) =>
      dump.files.find((item) => item.path === path).result.data.toolchain;
    assert.equal(file("native/native.go").status, "in-configuration");
    for (const path of ["native/cnative.go", "native/native_windows.go"]) {
      assert.equal(file(path).status, "outside-configuration", path);
      assert.match(file(path).reason, /build constraints/, path);
      const inside = dump.links.filter(
        (item) => item.file === path && item.kind !== "contains",
      );
      assert.ok(inside.length > 0, path);
      for (const item of inside) {
        assert.equal(item.data?.toolchain, undefined, path);
        const before = off.links.find(
          (other) =>
            other.file === item.file &&
            other.start === item.start &&
            other.kind === item.kind &&
            other.at === item.at,
        );
        assert.equal(item.target, before.target, `${path} ${item.at}`);
      }
    }
  },
);

test("go missing: the index succeeds source-only and the report says why", async () => {
  const off = await index("basic");
  const missing = await index("basic", {
    ...on,
    environment: { PATH: "/nonexistent-dir" },
  });
  assert.deepEqual(missing.report.toolchains, [
    {
      module: "go",
      note: { status: "unavailable", reason: "go was not found on PATH" },
    },
  ]);
  assert.deepEqual(missing.report.analysisErrors, []);
  assert.deepEqual(missing.links, off.links);
  assert.deepEqual(missing.files, off.files);
  const bad = await index("basic", {
    toolchains: { go: "/nonexistent-dir/go" },
  });
  assert.match(
    note(bad.report, "unavailable").reason,
    /\/nonexistent-dir\/go does not exist/,
  );
});

test(
  "warm == cold: unchanged inputs reuse the facts, and a fresh run gives the same bytes",
  needsGo,
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-go-toolchain-"));
    try {
      const first = await index("basic", on, scratch);
      const warm = await index("basic", on, scratch);
      assert.equal(note(first.report, "available").cached, false);
      assert.equal(note(warm.report, "available").cached, true);
      assert.equal(warm.report.indexed, 0);
      const cold = await index("basic", on);
      assert.equal(note(cold.report, "available").cached, false);
      for (const dump of [warm, cold]) {
        assert.deepEqual(dump.links, first.links);
        assert.deepEqual(dump.files, first.files);
      }
      assert.equal(
        note(cold.report, "available").key,
        note(first.report, "available").key,
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

/** Path, size and content of every file under a directory. */
function treeHash(dir) {
  const hash = createHash("sha256");
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const info = statSync(p);
      hash.update(`${p} ${info.size}\n`);
      if (info.isDirectory()) walk(p);
      else hash.update(readFileSync(p));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

test(
  "the project is never written, and no run directory is left behind",
  needsGo,
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-go-toolchain-"));
    try {
      const before = treeHash(FIXTURES);
      await index("basic", on, scratch);
      await index("typeerror", on, scratch);
      assert.equal(treeHash(FIXTURES), before);
      const left = readdirSync(join(scratch, "toolchain", "go")).filter(
        (name) => name.startsWith("run-"),
      );
      assert.deepEqual(left, []);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

test(
  "cancellation: an aborted index stops the toolchain route and leaves nothing running",
  needsGo,
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-go-toolchain-"));
    try {
      const controller = new AbortController();
      controller.abort();
      const dump = await index(
        "basic",
        { ...on, signal: controller.signal },
        scratch,
      );
      assert.deepEqual(
        dump.report.analysisErrors.map((item) => item.message),
        ["Indexing was cancelled"],
      );
      const dir = join(scratch, "toolchain", "go");
      const left = existsSync(dir)
        ? readdirSync(dir).filter((name) => name.startsWith("run-"))
        : [];
      assert.deepEqual(left, []);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

test(
  "pointer conversions: the toolchain names the converted type, agreeing with the source-only route",
  needsGo,
  async () => {
    const off = await index("conversion");
    const dump = await index("conversion", on);
    assert.deepEqual(note(dump.report, "merged").disagreements, []);
    for (const result of [off, dump]) {
      const conversions = result.links.filter(
        (item) =>
          item.file === "p/p.go" &&
          item.kind === "calls" &&
          item.at === "*Batch",
      );
      assert.deepEqual(
        conversions.map((item) => item.target),
        ["p/p.go:Batch", "p/p.go:Batch"],
      );
      assert.equal(
        link(result, "p/p.go", "(*Batch)(nil).Apply").target,
        "p/p.go:(*Batch).Apply",
      );
    }
    // Decided by the toolchain, confirming the source-only target.
    for (const item of dump.links.filter(
      (entry) => entry.kind === "calls" && entry.at === "*Batch",
    )) {
      assert.equal(item.data.toolchain.origin, "toolchain");
      assert.equal(item.data.toolchain.from, "definite");
      assert.equal(item.data.toolchain.sourceOnly, undefined);
    }
  },
);

test(
  "C-14: library members get their declaring owner from go/types; source-only they stay unresolved",
  needsGo,
  async () => {
    const off = await index("library");
    const dump = await index("library", on);
    assert.equal(note(dump.report, "available")?.universeClean, true);
    const file = "app/app.go";
    const owner = (unit, symbol) => ({
      ecosystem: "go-std",
      unit,
      symbol,
      evidence: "declaring-owner",
    });
    const members = [
      ["buf.Write", "calls", owner("bytes", "Buffer.Write")],
      ["buf.String", "calls", owner("bytes", "Buffer.String")],
      // Promoted from the embedded sync.Mutex of a checkout struct.
      ["g.Lock", "calls", owner("sync", "Mutex.Lock")],
      // Promoted from *os.ProcessState: another unit than the receiver's.
      ["exitErr.ExitCode", "calls", owner("os", "ProcessState.ExitCode")],
      ['exec.Command("true").Run', "calls", owner("os/exec", "Cmd.Run")],
      ["resp.Body", "references", owner("net/http", "Response.Body")],
    ];
    for (const [at, kind, target] of members) {
      const before = link(off, file, at, kind);
      assert.equal(before.libraries, undefined, at);
      // A member promoted from a library type embedded in a checkout struct
      // has no reason yet: only a library-typed receiver does.
      assert.equal(
        before.data?.uncertainty,
        at === "g.Lock" ? undefined : "library-member-unproven",
        at,
      );
      const after = link(dump, file, at, kind);
      assert.equal(after.resolution, "library", at);
      assert.deepEqual(after.libraries, [target], at);
      assert.equal(after.data.toolchain.upgrade, "library", at);
    }
    // Interface methods are dispatch: no library symbol either way.
    for (const at of ["r.Read", "resp.Body.Close"]) {
      assert.equal(link(dump, file, at).libraries, undefined, at);
      assert.equal(link(off, file, at).libraries, undefined, at);
    }
    // Qualified names and builtins are the same with and without it.
    for (const at of ["strings.Count", "len", "errors.As"])
      assert.deepEqual(
        link(dump, file, at).libraries,
        link(off, file, at).libraries,
        at,
      );
    assert.deepEqual(link(off, file, "strings.Count").libraries, [
      {
        ecosystem: "go-std",
        unit: "strings",
        symbol: "Count",
        evidence: "import-binding",
      },
    ]);
  },
);
