// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
// W3-L round 1 review: each case fails without its fix. Fixtures under
// test/fixtures/graph-go-toolchain/ are compiler-checked (Go 1.27.4):
//   generics, anonstruct, outside, vendored, disagree, replace/app,
//     testanon: `CGO_ENABLED=0 go build ./... && go vet ./...` pass
//     (testanon also `go test ./...`); outside also
//     with GOOS=windows; disagree FAILS for GOOS=windows ("Helper already
//     declared through dot-import"), by design: it is valid for linux only.
// These tests need the user's `go`; without one on PATH they are skipped.
import assert from "node:assert/strict";
import { toolchainWorkDirectory } from "../dist/project/local-trust.js";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../dist/graph/index.js";
import go from "../dist/graph/languages/go/index.js";
import { linkNotes } from "../dist/graph/languages/go/resolve.js";
import { deepFreeze } from "../dist/graph/kept-input.js";
import {
  installation,
  runHelper,
} from "../dist/graph/languages/go/toolchain.js";

const FIXTURES = fileURLToPath(
  new URL("./fixtures/graph-go-toolchain/", import.meta.url),
);
const haveGo = (process.env.PATH ?? "")
  .split(delimiter)
  .some((dir) => dir && existsSync(join(dir, "go")));
const needsGo = haveGo ? {} : { skip: "no go on PATH (toolchain route)" };
const on = { toolchains: { go: true } };

async function scratch() {
  return await mkdtemp(join(tmpdir(), "pymtheg-go-toolchain-review-"));
}

/** Indexes a root into a store; returns a readable dump. */
async function index(root, store, options) {
  const report = await indexProject(
    root,
    new LanguageRegistry([go]),
    store,
    options,
  );
  const symbols = store.findSymbols();
  const name = (id) => {
    const s = symbols.find((item) => item.id === id);
    return s ? `${s.file}:${s.identity}` : null;
  };
  const links = store.links().map((link) => ({
    file: link.file,
    kind: link.kind,
    at: link.targetName,
    start: link.range.start,
    target: name(link.targetId),
    candidates: link.candidates.map((c) => name(c.id)).sort(),
    data: link.data ?? null,
  }));
  return {
    report,
    links,
    files: store
      .files()
      .map((file) => ({ path: file.path, result: file.result })),
  };
}
async function once(fixture, options = on) {
  const dir = await scratch();
  const store = new SqliteGraphStore(join(dir, "graph.sqlite"), "tc");
  try {
    return await index(join(FIXTURES, fixture), store, {
      toolchainDirectory: join(dir, "toolchain"),
      ...options,
    });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
const link = (dump, file, at, kind = "calls") => {
  const found = dump.links.filter(
    (item) => item.file === file && item.at === at && item.kind === kind,
  );
  assert.ok(found.length >= 1, `${file} ${at}`);
  return found;
};
const note = (report, status) =>
  report.toolchains?.find((item) => item.note.status === status)?.note;

test(
  "A: each instantiation of a generic interface gets its own verified set",
  needsGo,
  async () => {
    const dump = await once("generics");
    const sets = link(dump, "g/g.go", "x.Get").map((item) => item.candidates);
    assert.deepEqual(
      sets.sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      [
        ["g/g.go:(IntImpl).Get", "g/g.go:Getter.Get"],
        ["g/g.go:(StrImpl).Get", "g/g.go:Getter.Get"],
      ],
    );
    for (const item of link(dump, "g/g.go", "x.Get"))
      assert.equal(item.data.toolchain.upgrade, "verified");
  },
);

test(
  "an unnamed struct of embedded types is in the implementer search",
  needsGo,
  async () => {
    const dump = await once("anonstruct");
    const [set] = link(dump, "a/a.go", "rc.Read");
    assert.equal(set.data.toolchain.upgrade, "verified");
    assert.deepEqual(set.candidates, [
      "a/a.go:(file).Read",
      "a/a.go:(reader).Read",
      "a/a.go:ReadCloser.Read",
    ]);
  },
);

test(
  "an unnamed struct in a _test.go file withholds verification for its promoted methods",
  needsGo,
  async () => {
    const off = await once("testanon", {});
    const dump = await once("testanon");
    const [set] = link(dump, "p/p.go", "x.C");
    // Not verified: in the test binary x.C also reaches (c).C.
    assert.equal(set.data.toolchain, undefined);
    assert.deepEqual(set.candidates, link(off, "p/p.go", "x.C")[0].candidates);
    assert.ok(set.candidates.includes("p/p.go:(c).C"), set.candidates.join());
  },
);

test(
  "B: the default toolchain folder inside the project is never indexed",
  needsGo,
  async () => {
    const dir = await scratch();
    try {
      const root = join(dir, "project");
      cpSync(join(FIXTURES, "basic"), root, { recursive: true });
      // A stray Go file in Pymtheg's own storage (an older helper build, say)
      // is never source.
      mkdirSync(join(root, ".pymtheg", "rebuildable", "stale"), {
        recursive: true,
      });
      writeFileSync(
        join(root, ".pymtheg", "rebuildable", "stale", "golinks.go"),
        "package main\n\nfunc main() {}\n",
      );
      const store = new SqliteGraphStore(join(dir, "graph.sqlite"), "tc");
      try {
        const runs = [];
        for (let run = 0; run < 3; run++)
          runs.push(await index(root, store, on));
        // C-44: the default toolchain folder is the user's cache, outside
        // the project; nothing is built in the project.
        const work = join(toolchainWorkDirectory(root), "go");
        assert.ok(existsSync(work));
        assert.equal(
          existsSync(join(root, ".pymtheg", "rebuildable", "toolchain")),
          false,
        );
        // No helper build directory or build cache is left in the folder.
        assert.deepEqual(
          readdirSync(work).filter(
            (name) => name.startsWith("build") || name.startsWith("run-"),
          ),
          [],
        );
        assert.deepEqual(
          runs.map((run) => note(run.report, "available").cached),
          [false, true, true],
        );
        for (const run of runs) {
          assert.ok(
            run.files.every((file) => !file.path.startsWith(".pymtheg")),
          );
          assert.deepEqual(run.files, runs[0].files);
          assert.deepEqual(run.links, runs[0].links);
        }
        assert.deepEqual(
          runs.slice(1).map((run) => run.report.indexed),
          [0, 0],
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "B: a relative root works, and a broken project go.mod cannot break the helper build",
  needsGo,
  async () => {
    const dir = await scratch();
    try {
      const root = join(dir, "project");
      cpSync(join(FIXTURES, "basic"), root, { recursive: true });
      let store = new SqliteGraphStore(join(dir, "a.sqlite"), "tc");
      try {
        const dump = await index(relative(process.cwd(), root), store, on);
        assert.equal(note(dump.report, "available")?.universeClean, true);
      } finally {
        store.close();
      }
      // The helper is built in its own module: a broken go.mod in the project
      // (whose folder holds the toolchain directory) fails go list, not the build.
      writeFileSync(join(root, "go.mod"), "this is not a go.mod\n");
      await rm(join(root, ".pymtheg"), { recursive: true, force: true });
      store = new SqliteGraphStore(join(dir, "b.sqlite"), "tc");
      try {
        const dump = await index(root, store, on);
        const reason = note(dump.report, "unavailable")?.reason ?? "";
        assert.match(reason, /go list failed|helper exited/, reason);
        assert.doesNotMatch(reason, /did not build/);
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "C: editing a local replace target invalidates the facts (warm == cold)",
  needsGo,
  async () => {
    const dir = await scratch();
    try {
      cpSync(join(FIXTURES, "replace"), join(dir, "replace"), {
        recursive: true,
      });
      const root = join(dir, "replace", "app");
      const pairs = (dump) =>
        dump.links
          .filter((item) => item.kind === "implements" && item.target)
          .map((item) => `${item.file} ${item.at} ${item.target}`)
          .sort();
      const store = new SqliteGraphStore(join(dir, "graph.sqlite"), "tc");
      try {
        const options = { ...on, toolchainDirectory: join(dir, "toolchain") };
        const first = await index(root, store, options);
        assert.ok(
          pairs(first).some((pair) => pair.endsWith("use/use.go:I")),
          pairs(first).join(),
        );
        // dep is outside the project: only the fingerprint can see this edit.
        writeFileSync(
          join(dir, "replace", "dep", "dep.go"),
          "package dep\n\ntype Marker interface {\n\tMark()\n\tClose() error\n}\n",
        );
        const warm = await index(root, store, options);
        assert.equal(note(warm.report, "available").cached, false);
        assert.ok(!pairs(warm).some((pair) => pair.endsWith("use/use.go:I")));
      } finally {
        store.close();
      }
      // Cold, fresh store and toolchain folder: the same answer.
      const fresh = new SqliteGraphStore(join(dir, "fresh.sqlite"), "tc");
      try {
        const cold = await index(root, fresh, {
          ...on,
          toolchainDirectory: join(dir, "toolchain-cold"),
        });
        assert.ok(!pairs(cold).some((pair) => pair.endsWith("use/use.go:I")));
      } finally {
        fresh.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "D: an implements pair declared outside the configuration is kept, source-only",
  needsGo,
  async () => {
    const dump = await once("outside");
    const [pair] = link(
      dump,
      "o/hresult_windows.go",
      "Shortener",
      "implements",
    );
    assert.equal(pair.target, null);
    assert.deepEqual(pair.data.toolchain, {
      origin: "source-only",
      reason: "outside-configuration",
    });
    // The verified dispatch set keeps the member declared outside too.
    const [set] = link(dump, "o/o.go", "s.Short");
    assert.ok(set.candidates.includes("o/hresult_windows.go:(HRESULT).Short"));
  },
);

test(
  "F: a vendored module's import and calls are consistent definite links",
  needsGo,
  async () => {
    const off = await once("vendored", {});
    const dump = await once("vendored");
    const [imp] = link(dump, "use/use.go", "example.com/dep", "imports");
    assert.equal(
      link(off, "use/use.go", "example.com/dep", "imports")[0].target,
      null,
    );
    assert.equal(imp.target, "vendor/example.com/dep/dep.go:dep");
    assert.equal(imp.data.toolchain.origin, "toolchain");
    assert.equal(
      link(dump, "use/use.go", "dep.New().Do")[0].target,
      "vendor/example.com/dep/dep.go:(*Client).Do",
    );
  },
);

test(
  "G: a disagreement is recorded, the toolchain's target used, and counted",
  needsGo,
  async () => {
    const off = await once("disagree", {});
    const dump = await once("disagree");
    assert.equal(
      link(off, "q/q.go", "Helper")[0].target,
      "q/helper_windows.go:Helper",
    );
    const [call] = link(dump, "q/q.go", "Helper");
    assert.equal(call.target, "p/p.go:Helper");
    assert.equal(call.data.toolchain.sourceOnly, "q/helper_windows.go:Helper");
    const merged = note(dump.report, "merged");
    assert.equal(merged.disagreements.length, 1);
    assert.deepEqual(
      {
        file: merged.disagreements[0].file,
        name: merged.disagreements[0].name,
        sourceOnly: merged.disagreements[0].sourceOnly,
      },
      {
        file: "q/q.go",
        name: "Helper",
        sourceOnly: "q/helper_windows.go:Helper",
      },
    );
  },
);

test("G: forged facts: the toolchain's target is preferred, both recorded, a withdrawal", async () => {
  // Source-only facts of the basic fixture, then a forged toolchain fact on
  // two links: c.Close (source: (*Base).Close) said to be (*File).Write, and
  // store.Open said to be an external function.
  const dir = await scratch();
  const store = new SqliteGraphStore(join(dir, "graph.sqlite"), "tc");
  try {
    await indexProject(
      join(FIXTURES, "basic"),
      new LanguageRegistry([go]),
      store,
    );
    const files = store.files();
    const symbols = store.findSymbols();
    const write = symbols.find((s) => s.identity === "(*File).Write");
    const text = files.find((f) => f.path === "store/store.go").text;
    const writeAt = text.indexOf(
      "Write(p []byte) (int",
      text.indexOf("func (f *File)"),
    );
    const forge = (data, kind) => {
      if (kind === "c.Close")
        return {
          ...data,
          tc: { c: "method", at: ["store/store.go", writeAt, "Write"] },
        };
      if (kind === "store.Open")
        return { ...data, tc: { c: "func", ext: "example.com/x.Open" } };
      return data;
    };
    const app = files.find((f) => f.path === "app/app.go");
    app.result.links = app.result.links.map((l) => ({
      ...l,
      data: forge(l.data, l.targetName),
    }));
    // The resolver (the real resolution).
    const links = store
      .links()
      .filter((l) => l.module === "go" && l.origin === "parse")
      .map((l) => ({
        ...l,
        data: l.file === "app/app.go" ? forge(l.data, l.targetName) : l.data,
        targetId: null,
        targetStatus: null,
        candidates: [],
        resolution: "unresolved",
      }));
    // Frozen, as the indexer hands Go its inputs under the tests (C-55).
    const result = await go.resolve(
      deepFreeze({
        projectId: "tc",
        files,
        contextFiles: store.contexts(),
        symbols,
        links,
      }),
    );
    const byLink = new Map(result.resolutions.map((r) => [r.linkId, r]));
    const close = links.find((l) => l.targetName === "c.Close");
    const open = links.find((l) => l.targetName === "store.Open");
    assert.equal(byLink.get(close.id)?.targetId, write.id);
    assert.equal(byLink.get(open.id), undefined);
    // The notes (what analyze records): both targets, and the withdrawal.
    const notes = linkNotes("go", files, store.contexts()).get("app/app.go");
    const index = (name) =>
      app.result.links.findIndex((l) => l.targetName === name);
    assert.deepEqual(notes.get(index("c.Close")).toolchain, {
      upgrade: "definite",
      from: "definite",
      sourceOnly: "store/store.go:(*Base).Close",
    });
    assert.deepEqual(notes.get(index("store.Open")).toolchain, {
      upgrade: "external",
      from: "definite",
      sourceOnly: "store/store.go:Open",
    });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/** Processes whose command line mentions `needle` (Linux /proc). */
function processesWith(needle) {
  const found = [];
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (cmd.includes(needle)) found.push(pid);
    } catch {
      /* gone */
    }
  }
  return found;
}
/** Waits for a condition (a readiness handshake); fails after a safety budget, never asserts on time. */
async function until(condition, what) {
  for (let i = 0; i < 6000; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(
    `safety budget exhausted waiting for ${what} (unresolved, not a timing property)`,
  );
}
/** A project whose go list blocks: a FIFO with a .go name (W2-L hazard 12). */
async function blockedProject(dir) {
  const root = join(dir, "project");
  cpSync(join(FIXTURES, "basic"), root, { recursive: true });
  execFileSync("mkfifo", [join(root, "store", "blocker.go")]);
  return root;
}

test(
  "I: live cancellation: the helper is started, then aborted; nothing remains",
  needsGo,
  async () => {
    const dir = await scratch();
    try {
      const root = await blockedProject(dir);
      const store = new SqliteGraphStore(join(dir, "graph.sqlite"), "tc");
      try {
        const controller = new AbortController();
        const running = index(root, store, {
          ...on,
          toolchainDirectory: join(dir, "toolchain"),
          signal: controller.signal,
        });
        // Readiness: the helper (its command line names the project) is running.
        await until(
          () => processesWith(root).length > 0,
          "the helper to start",
        );
        controller.abort();
        // C-54: the route rethrows the signal's own reason, so the index is
        // cancelled as a whole (it was recorded as an analysis error before).
        await assert.rejects(
          running,
          (error) => error === controller.signal.reason,
        );
        await until(
          () => processesWith(root).length === 0,
          "the helper to be gone",
        );
        assert.deepEqual(
          readdirSync(join(dir, "toolchain", "go")).filter((n) =>
            n.startsWith("run-"),
          ),
          [],
        );
      } finally {
        store.close();
      }
    } finally {
      // A writer unblocks any reader left behind, so cleanup cannot hang.
      for (const pid of processesWith(dir))
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {
          /* gone */
        }
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "I: the helper's run limit: a timed-out run is unavailable and leaves nothing",
  needsGo,
  async () => {
    const dir = await scratch();
    try {
      const root = await blockedProject(dir);
      const workDir = join(dir, "toolchain");
      const install = await installation(true, process.env, workDir);
      assert.ok(!("unavailable" in install), JSON.stringify(install));
      // A controlled clock: the run limit fires only when the test says so;
      // the kill grace and finish delays run at once.
      let fire;
      const clock = {
        schedule(callback, ms) {
          if (ms === 12345) {
            fire = callback;
            return "limit";
          }
          return setTimeout(callback, 0);
        },
        cancel(handle) {
          if (handle !== "limit") clearTimeout(handle);
        },
      };
      const running = runHelper(root, install, [], workDir, undefined, {
        clock,
        limitMs: 12345,
      });
      await until(
        () => fire && processesWith(root).length > 0,
        "the helper to start",
      );
      fire();
      const result = await running;
      assert.match(result.unavailable ?? "", /timed_out/);
      await until(
        () => processesWith(root).length === 0,
        "the helper to be gone",
      );
      assert.deepEqual(
        readdirSync(workDir).filter((n) => n.startsWith("run-")),
        [],
      );
    } finally {
      for (const pid of processesWith(dir))
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {
          /* gone */
        }
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "I: a Go version or configuration change invalidates the facts",
  needsGo,
  async () => {
    const dir = await scratch();
    try {
      const root = join(FIXTURES, "config");
      const workDir = join(dir, "toolchain");
      const install = await installation(true, process.env, workDir);
      const run = (i) => runHelper(root, i, [], workDir);
      const first = await run(install);
      assert.equal(first.cached, false);
      assert.equal((await run(install)).cached, true);
      const version = await run({
        ...install,
        version: `${install.version}-other`,
      });
      assert.equal(version.cached, false);
      assert.notEqual(version.key, first.key);
      const windows = await run({
        ...install,
        goos: "windows",
        configuration: "windows/amd64, cgo off, GOAMD64=v1, no tags",
      });
      assert.equal(windows.cached, false);
      // A different configuration: native_windows.go is now in it.
      assert.match(windows.output, /^F\tnative\/native_windows\.go\t/m);
      assert.doesNotMatch(first.output, /^F\tnative\/native_windows\.go\t/m);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
