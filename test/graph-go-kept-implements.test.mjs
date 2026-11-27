// SPDX-License-Identifier: MIT
// C-56: an index session keeps Go's implements decisions (C-56b) under a key
// of everything they are made from. A body edit reuses them; any change to
// what they are made from misses the key and makes them again. Under the
// tests a reused value is also made again and must be identical, so every
// session run here proves the kept value equal to a recomputed one. Every
// store equals a cold index.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  indexProject,
  IndexSession,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import go from "../dist/graph/languages/go/index.js";
import { graphWork, resetGraphWork } from "../dist/graph/work.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const graphAt = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");
function tree(files) {
  const base = mkdtempSync(join(tmpdir(), "c56-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  return { base, root, write };
}
async function differencesFromCold(base, root, registry) {
  const rows = storeRows(graphAt(root));
  const path = join(base, `cold-${Math.random().toString(36).slice(2)}.sqlite`);
  const cold = new SqliteGraphStore(path, rows.project[0]);
  try {
    await indexProject(root, registry, cold, {
      excludeDirectories: [".pymtheg"],
    });
  } finally {
    cold.close();
  }
  return compareRows(rows, storeRows(path));
}
const index = (root, session) =>
  executeGraph({ command: "index", root }, { session });

const files = {
  "go.mod": "module example.com/m\n\ngo 1.22\n",
  "shape/shape.go":
    "package shape\n\ntype Shape interface{ Area() int }\n\ntype Named interface{ Name() string }\n",
  "box/box.go":
    'package box\n\nimport "example.com/m/shape"\n\ntype Box struct{ W, H int }\n\nfunc (b Box) Area() int { return b.W * b.H }\n\nfunc Use(s shape.Shape) int { return s.Area() }\n\nfunc Make() int { return Use(Box{1, 2}) }\n',
  "dot/dot.go":
    'package dot\n\ntype Dot struct{}\n\nfunc (*Dot) Area() int { return 0 }\n\nfunc (Dot) Name() string { return "dot" }\n',
  // A struct promoting an embedded type's method: a function named like the
  // embedded type changes the decisions, and only `surface.functions`.
  "emb/emb.go":
    "package emb\n\ntype I interface{ M() }\n\ntype Base struct{}\n\nfunc (Base) M() {}\n\ntype W struct{ Base }\n",
  // The second review's reproduction: renaming `helper` to `X` in another
  // file changes only that file's `surface.functions`, and T's promoted
  // `Read` with it.
  "rd/a.go":
    "package rd\n\ntype Reader interface{ Read() int }\n\ntype X struct{}\n\nfunc (X) Read() int { return 1 }\n\ntype T struct{ X }\n",
  "rd/b.go": "package rd\n\nfunc helper() {}\n",
  // Sol's review cases. (a) X under one build constraint, the other
  // configuration's file empty: a function X added there.
  "bc/base.go":
    "//go:build !alternate\n\npackage bc\n\ntype X struct{}\n\nfunc (X) M() {}\n\ntype T struct{ X }\n\ntype I interface{ M() }\n",
  "bc/alt.go": "//go:build alternate\n\npackage bc\n",
  // (b) A type alias and a function of one name: their order matters.
  "ord/o.go":
    'package ord\n\nimport "strings"\n\ntype X = strings.Builder\n\nfunc X() {}\n\ntype S struct{ X }\n\ntype I interface{ String() string }\n',
  // An import's path changes under the same alias: no declaration changes,
  // but the embedded type does (file facts).
  "imp/i.go":
    'package imp\n\nimport ext "strings"\n\ntype S struct{ ext.Builder }\n\ntype I interface{ String() string }\n',
  // An interface embedding another: the embedded interface changes.
  "iemb/i.go":
    "package iemb\n\ntype P interface{ M() }\n\ntype Q interface{ N() }\n\ntype R interface{ P }\n\ntype T struct{}\n\nfunc (T) M() {}\n",
  // An embedded type changes (embeds).
  "emb2/e.go":
    "package emb2\n\ntype I interface{ M() }\n\ntype A struct{}\n\nfunc (A) M() {}\n\ntype B struct{}\n\ntype W struct{ A }\n",
  // A body edit can change the decisions: an anonymous struct embedding X
  // inside a function body implements I (Sol's review, restic's Hasher).
  "bod/b.go":
    "package bod\n\ntype I interface{ M() }\n\ntype X struct{}\n\nfunc (X) M() {}\n\nfunc F() {}\n",
  // A directory with no Go file: the notes build (given only Go files) and
  // the resolution build (given every file) see different directories, so
  // each keeps its own value; a body edit must still reuse both.
  "web/app.ts": "export const app = 1;\n",
  // Sol's second review: a non-Go file decides whether `io` is the
  // standard library or a checkout directory, which changes which alias
  // lookups fill the memo before a later one reaches the depth limit.
  "testdata/pkg/a.go":
    "package p\ntype Container struct { Variant }\ntype T struct{}\nfunc (T) M() {}\n",
  "testdata/pkg/b_linux.go":
    'package p\nimport "io"\ntype Variant = io.Reader\n',
  "testdata/pkg/c_windows.go":
    "package p\ntype Outer interface { A0 }\ntype Variant = X\ntype A0 = A1\ntype A1 = A2\ntype A2 = A3\ntype A3 = A4\ntype A4 = A5\ntype A5 = A6\ntype A6 = A7\ntype A7 = A8\ntype A8 = A9\ntype A9 = X\ntype X = Base\ntype Base interface { M() }\n",
  // (c) A failed file (no surface), moved into the implementers' package.
  "zz/broken.go": "package box\n\nfunc Broken( {\n",
  // Two init functions share an identity: an anonymous struct in the first
  // renumbers the second's (C-56a).
  "dot/init.go":
    "package dot\n\nfunc init() {}\n\nfunc init() { _ = struct{ A int }{} }\n",
};

test("a session reuses Go's implements decisions across body edits, proven equal to a recomputation, and recomputes on every other change", async () => {
  const { base, root, write } = tree(files);
  const remove = (path) => rmSync(join(root, path));
  const steps = [
    // [name, edit, reused: true when the key must hold]
    [
      "a body edit",
      () =>
        write(
          "box/box.go",
          files["box/box.go"].replace("Use(Box{1, 2})", "Use(Box{3, 4})"),
        ),
      true,
    ],
    [
      "add a file declaring an implementer",
      () =>
        write(
          "tri/tri.go",
          "package tri\n\ntype Tri struct{}\n\nfunc (Tri) Area() int { return 3 }\n",
        ),
      false,
    ],
    ["another body edit", () => write("box/box.go", files["box/box.go"]), true],
    [
      // Invalid Go, but a normal state mid-edit: only `surface.functions`
      // changes, and the promoted method set with it (review).
      "a function named like an embedded type (func Base beside type Base)",
      () => write("emb/emb.go", files["emb/emb.go"] + "\nfunc Base() {}\n"),
      false,
    ],
    ["remove it again", () => write("emb/emb.go", files["emb/emb.go"]), false],
    [
      "rename helper to X in another file (T's promoted Read)",
      () => write("rd/b.go", "package rd\n\nfunc X() {}\n"),
      false,
    ],
    ["rename it back", () => write("rd/b.go", files["rd/b.go"]), false],
    [
      "(a) a function X added under the other build constraint",
      () => write("bc/alt.go", files["bc/alt.go"] + "\nfunc X() {}\n"),
      false,
    ],
    ["(a) removed again", () => write("bc/alt.go", files["bc/alt.go"]), false],
    [
      "(b) the alias and the function of one name swap order",
      () =>
        write(
          "ord/o.go",
          files["ord/o.go"].replace(
            "type X = strings.Builder\n\nfunc X() {}\n",
            "func X() {}\n\ntype X = strings.Builder\n",
          ),
        ),
      false,
    ],
    ["(b) swapped back", () => write("ord/o.go", files["ord/o.go"]), false],
    [
      "an import's path changes under the same alias",
      () =>
        write("imp/i.go", files["imp/i.go"].replace('"strings"', '"bytes"')),
      false,
    ],
    [
      "the import changed back",
      () => write("imp/i.go", files["imp/i.go"]),
      false,
    ],
    [
      "an embedded type changes",
      () =>
        write(
          "emb2/e.go",
          files["emb2/e.go"].replace(
            "type W struct{ A }",
            "type W struct{ B }",
          ),
        ),
      false,
    ],
    [
      "the embed changed back",
      () => write("emb2/e.go", files["emb2/e.go"]),
      false,
    ],
    [
      "a TypeScript file appears in testdata/src/io (a directory, no Go file)",
      () => write("testdata/src/io/fixture.ts", "export const fixture = 1;\n"),
      false,
    ],
    [
      "the TypeScript file goes again",
      () => rmSync(join(root, "testdata/src/io/fixture.ts")),
      false,
    ],
    [
      "a body edit adds an anonymous struct embedding X (it implements I)",
      () =>
        write(
          "bod/b.go",
          files["bod/b.go"].replace(
            "func F() {}",
            "func F() { _ = struct{ X }{} }",
          ),
        ),
      false,
    ],
    ["the body edit undone", () => write("bod/b.go", files["bod/b.go"]), false],
    [
      "go.mod cannot be decoded (its read status changes)",
      () =>
        writeFileSync(
          join(root, "go.mod"),
          Buffer.concat([
            Buffer.from(files["go.mod"]),
            Buffer.from([0xff, 0xfe, 0x0a]),
          ]),
        ),
      false,
      // Go's analysis stops on a context file it cannot read: the run
      // fails and keeps nothing, so the decisions are never reused.
      "fails",
    ],
    ["go.mod restored", () => write("go.mod", files["go.mod"]), false],
    [
      "an interface's embedded interface changes",
      () =>
        write(
          "iemb/i.go",
          files["iemb/i.go"].replace(
            "type R interface{ P }",
            "type R interface{ Q }",
          ),
        ),
      false,
    ],
    [
      "the interface embed changed back",
      () => write("iemb/i.go", files["iemb/i.go"]),
      false,
    ],
    [
      "(c) a failed file moves into the implementers' package",
      () => {
        rmSync(join(root, "zz/broken.go"));
        write("box/broken.go", files["zz/broken.go"]);
      },
      false,
    ],
    [
      "(c) moved back",
      () => {
        rmSync(join(root, "box/broken.go"));
        write("zz/broken.go", files["zz/broken.go"]);
      },
      false,
    ],
    [
      "a body edit of the file holding the implementers (a scoped run)",
      () => write("rd/a.go", files["rd/a.go"].replace("return 1", "return 2")),
      true,
    ],
    [
      "an anonymous struct in the first of two init (renumbers the second's)",
      () =>
        write(
          "dot/init.go",
          "package dot\n\nfunc init() { _ = struct{ B int }{} }\n\nfunc init() { _ = struct{ A int }{} }\n",
        ),
      false,
    ],
    [
      "rename that file",
      () => renameSync(join(root, "tri/tri.go"), join(root, "tri/triangle.go")),
      false,
    ],
    [
      "change a method's signature",
      () =>
        write(
          "dot/dot.go",
          files["dot/dot.go"].replace("Area() int", "Area() int64"),
        ),
      false,
    ],
    ["delete a file", () => remove("tri/triangle.go"), false],
    [
      "change go.mod's module path",
      () => write("go.mod", "module example.com/n\n\ngo 1.22\n"),
      false,
    ],
    ["add go.work", () => write("go.work", "go 1.22\n\nuse .\n"), false],
    [
      "a body edit after all that",
      () =>
        write(
          "box/box.go",
          files["box/box.go"].replace("Use(Box{1, 2})", "Use(Box{5, 6})"),
        ),
      true,
    ],
  ];
  try {
    const registry = await discoverLanguages();
    const session = new IndexSession({ registry });
    assert.equal((await index(root, session)).sync.complete, true);
    for (const [name, edit, reused, fails] of steps) {
      edit();
      resetGraphWork();
      if (fails === "fails") {
        assert.equal((await index(root, session)).sync.complete, false, name);
        continue;
      }
      assert.equal((await index(root, session)).sync.complete, true, name);
      const counts = graphWork.counts;
      if (reused) {
        // Both builds (analysis notes and resolution) reuse the kept value,
        // and each reuse was made again and found identical.
        // (Two normal builds, and the lossless resolver where it is built.)
        assert.equal(counts["go.implementsMade"] ?? 0, 0, name);
        assert.ok(counts["go.implementsReused"] >= 2, name);
        assert.equal(
          counts["go.implementsChecked"],
          counts["go.implementsReused"],
          name,
        );
      } else
        // A miss: the notes build makes them again (the resolution build
        // may then reuse that run's own value).
        assert.ok((counts["go.implementsMade"] ?? 0) >= 1, `${name}: a miss`);
      assert.deepEqual(
        await differencesFromCold(base, root, registry),
        [],
        name,
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a stopped run keeps no implements decisions; the next run makes them again", async () => {
  const { base, root, write } = tree(files);
  try {
    const production = await discoverLanguages();
    let stop = false;
    const registry = new LanguageRegistry(
      production.modules.map((module) =>
        module.id !== "go"
          ? module
          : {
              ...module,
              async resolve(context) {
                const result = await module.resolve(context);
                if (stop) throw Error("stopped after Go's resolution");
                return result;
              },
            },
      ),
    );
    const session = new IndexSession({ registry });
    assert.equal((await index(root, session)).sync.complete, true);
    stop = true;
    write("box/box.go", files["box/box.go"].replace("{1, 2}", "{7, 8}"));
    assert.equal((await index(root, session)).sync.complete, false);
    stop = false;
    write("box/box.go", files["box/box.go"].replace("{1, 2}", "{9, 9}"));
    resetGraphWork();
    assert.equal((await index(root, session)).sync.complete, true);
    assert.ok((graphWork.counts["go.implementsMade"] ?? 0) >= 1);
    assert.deepEqual(await differencesFromCold(base, root, production), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/** Go's resolver called directly with a kept state the test controls. */
async function resolveInputs() {
  const { base, root } = tree(files);
  const store = new SqliteGraphStore(join(base, "graph.sqlite"));
  try {
    await indexProject(root, await discoverLanguages(), store);
    return {
      projectId: store.projectId,
      files: store.files().filter((file) => file.module === "go"),
      contextFiles: store.contexts(),
      symbols: store.findSymbols(),
      links: store
        .links()
        .filter((link) => link.module === "go" && link.origin === "parse")
        .map((link) => ({
          ...link,
          targetId: null,
          targetStatus: null,
          candidates: [],
          resolution: "unresolved",
        })),
    };
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
}
function keptState() {
  const values = new Map();
  return {
    values,
    get: (name, key) => {
      const entry = values.get(name);
      return entry && entry.key === key ? entry.value : undefined;
    },
    set: (name, key, value) => values.set(name, { key, value }),
  };
}

test("the key covers each file's toolchain status: a change misses it", async () => {
  const inputs = await resolveInputs();
  const kept = keptState();
  resetGraphWork();
  await go.resolve({ ...inputs, kept });
  resetGraphWork();
  await go.resolve({ ...inputs, kept });
  assert.equal(graphWork.counts["go.implementsMade"] ?? 0, 0, "same inputs");
  assert.ok(graphWork.counts["go.implementsReused"] >= 1, "same inputs");
  const withToolchain = inputs.files.map((file) => ({
    ...file,
    result: {
      ...file.result,
      data: {
        ...file.result.data,
        toolchain: { status: "outside-configuration", reason: "test" },
      },
    },
  }));
  resetGraphWork();
  await go.resolve({ ...inputs, files: withToolchain, kept });
  assert.ok((graphWork.counts["go.implementsMade"] ?? 0) >= 1);
  assert.equal(graphWork.counts["go.implementsReused"] ?? 0, 0);
});

test("a wrong value under the right key fails the run; a value under another key is not used", async () => {
  const inputs = await resolveInputs();
  const kept = keptState();
  await go.resolve({ ...inputs, kept });
  const name = "go:implements";
  const entry = kept.values.get(name);
  assert.ok(entry);
  // A key miss: the value is never read, the decisions are made again.
  kept.values.set(name, { key: "another key", value: entry.value });
  resetGraphWork();
  const fresh = await go.resolve({ ...inputs, kept });
  assert.ok((graphWork.counts["go.implementsMade"] ?? 0) >= 1);
  assert.ok(fresh.links.some((link) => link.kind === "implements"));
  // A stale value under the current key: the check finds it.
  kept.values.set(name, {
    key: kept.values.get(name).key,
    value: { ...entry.value, implementers: [] },
  });
  await assert.rejects(
    async () => go.resolve({ ...inputs, kept }),
    /differ from a recomputation/,
  );
});

const shadowFiles = {
  "go.mod": "module example.com/m\n\ngo 1.22\n",
  "api/api.go":
    "package api\n\ntype R interface{ Read() int }\n\ntype F struct{}\n\nfunc (F) Read() int { return 1 }\n",
  // A failed file makes its package lossy, so open dispatch sets are
  // checked again by the shadow resolver (built without lossy packages).
  "api/broken.go": "package api\n\nfunc Broken( {\n",
  "use/use.go":
    'package use\n\nimport "example.com/m/api"\n\nfunc U(r api.R) int { return r.Read() }\n',
};

test("the resolver that ignores lossy packages keeps its own value; the normal builds share one", async () => {
  const { base, root, write } = tree(shadowFiles);
  try {
    const registry = await discoverLanguages();
    const session = new IndexSession({ registry });
    assert.equal((await index(root, session)).sync.complete, true);
    // A body edit of the dispatching file: its open set is decided again,
    // with the shadow resolver.
    write(
      "use/use.go",
      shadowFiles["use/use.go"].replace(
        "return r.Read()",
        "return r.Read() + 0",
      ),
    );
    resetGraphWork();
    assert.equal((await index(root, session)).sync.complete, true);
    // Shadows were built in this run. Every build reused its mode's value,
    // each reuse made again and found identical.
    assert.ok((graphWork.counts["go.shadowResolvers"] ?? 0) >= 1);
    assert.equal(graphWork.counts["go.implementsMade"] ?? 0, 0);
    assert.ok(graphWork.counts["go.implementsReused"] >= 2);
    assert.equal(
      graphWork.counts["go.implementsChecked"],
      graphWork.counts["go.implementsReused"],
    );
    assert.deepEqual(await differencesFromCold(base, root, registry), []);
    // One value per resolver mode: the normal builds share one, the
    // resolver that ignores lossy packages keeps its own.
    const kept = session.kept.get(`go\u0000${go.version}`);
    assert.ok(kept?.has("go:implements") && kept.has("go:implements:lossless"));
    assert.notEqual(
      kept.get("go:implements").key,
      kept.get("go:implements:lossless").key,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the kept decisions are named by the store's ids (both builds name declarations alike)", async () => {
  const { base, root } = tree(files);
  try {
    const registry = await discoverLanguages();
    const session = new IndexSession({ registry });
    assert.equal((await index(root, session)).sync.complete, true);
    const kept = session.kept.get(`go\u0000${go.version}`);
    const notes = kept?.get("go:implements")?.value;
    assert.ok(notes && notes.complete.length > 0);
    const db = new SqliteGraphStore(graphAt(root));
    const ids = new Set(db.findSymbols().map((symbol) => symbol.id));
    db.close();
    const named = [
      ...notes.complete,
      ...notes.possible.flat(),
      ...notes.implementers.map(([type, iface]) => [type, iface]).flat(),
    ];
    assert.ok(named.length > 0);
    for (const id of named) assert.ok(ids.has(id), id);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
