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
    for (const [name, edit, reused] of steps) {
      edit();
      resetGraphWork();
      assert.equal((await index(root, session)).sync.complete, true, name);
      const counts = graphWork.counts;
      if (reused) {
        // Both builds (analysis notes and resolution) reuse, and each reuse
        // was made again and found identical.
        assert.equal(counts["go.implementsReused"], 2, name);
        assert.equal(counts["go.implementsChecked"], 2, name);
      } else
        assert.equal(counts["go.implementsReused"] ?? 0, 0, `${name}: a miss`);
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
    assert.equal(graphWork.counts["go.implementsReused"] ?? 0, 0);
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
  await go.resolve({ ...inputs, kept });
  assert.equal(graphWork.counts["go.implementsReused"], 1, "same inputs");
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
  assert.equal(graphWork.counts["go.implementsReused"] ?? 0, 0);
});

test("a wrong value under the right key fails the run; a value under another key is not used", async () => {
  const inputs = await resolveInputs();
  const kept = keptState();
  await go.resolve({ ...inputs, kept });
  const [name, entry] = [...kept.values][0];
  // A key miss: the value is never read, the decisions are made again.
  kept.values.set(name, { key: "another key", value: entry.value });
  resetGraphWork();
  const fresh = await go.resolve({ ...inputs, kept });
  assert.equal(graphWork.counts["go.implementsReused"] ?? 0, 0);
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
