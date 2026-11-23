// SPDX-License-Identifier: MIT
// C-53: a module that analyses has its files written once per run, with the
// analysed result, not once as parsed and again as analysed. A run stopped
// between its parse write and its analysis leaves its unfinished mark (and
// no other row), and the next run equals a cold index.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  discoverLanguages,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { graphWork, resetGraphWork } from "../dist/graph/work.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const production = await discoverLanguages();
const files = {
  "go.mod": "module example.com/m\n\ngo 1.22\n",
  "a/a.go": "package a\n\nfunc Hello() error { return nil }\n",
  "b/b.go":
    'package b\n\nimport "example.com/m/a"\n\nfunc B() error { return a.Hello() }\n',
  "Cargo.toml":
    '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n',
  "src/lib.rs": "pub mod a;\npub mod b;\n",
  "src/a.rs": "pub fn hello() -> u32 {\n    1\n}\n",
  "src/b.rs": "use crate::a::hello;\n\npub fn b() -> u32 {\n    hello()\n}\n",
};
function tree() {
  const base = mkdtempSync(join(tmpdir(), "c53-once-"));
  const root = join(base, "tree");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { base, root };
}
async function cold(base, root, projectId) {
  const path = join(base, "cold.sqlite");
  const store = new SqliteGraphStore(path, projectId);
  try {
    await indexProject(root, production, store);
  } finally {
    store.close();
  }
  return storeRows(path);
}

test("a cold index writes each Go and Rust file and link once", async () => {
  const { base, root } = tree();
  const store = new SqliteGraphStore(join(base, "graph.sqlite"));
  try {
    resetGraphWork();
    await indexProject(root, production, store);
    const counts = { ...graphWork.counts };
    const sources = store
      .files()
      .filter((file) => file.module === "go" || file.module === "rust");
    assert.equal(sources.length, 5);
    const links = store
      .links()
      .filter((link) => link.module === "go" || link.module === "rust");
    assert.ok(links.length > 0);
    assert.equal(
      counts["store.filesWritten"],
      store.files().length,
      "each file is written once",
    );
    assert.equal(
      counts["store.linkRowsDeleted"] ?? 0,
      0,
      "no link row is replaced",
    );
    assert.equal(
      counts["store.linkRowsInserted"],
      store.links().length,
      "each link row is inserted once",
    );
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});

for (const id of ["go", "rust"])
  test(`a run stopped in ${id} analysis after its parse write leaves only its mark; the next run equals cold`, async () => {
    const { base, root } = tree();
    const path = join(base, "graph.sqlite");
    try {
      const stop = new AbortController();
      const stopping = new LanguageRegistry(
        production.modules.map((module) =>
          module.id !== id
            ? module
            : {
                ...module,
                async analyze() {
                  stop.abort(Error("stopped between the phases"));
                  throw stop.signal.reason;
                },
              },
        ),
      );
      const first = new SqliteGraphStore(path);
      await assert.rejects(
        indexProject(root, stopping, first, { signal: stop.signal }),
        /stopped between the phases/,
      );
      const projectId = first.projectId;
      assert.equal(first.unfinishedIndexRun(), true, "the mark is left");
      const held = first.files().filter((file) => file.module === id).length;
      assert.equal(held, 0, `no ${id} file is written before its analysis`);
      first.close();
      const again = new SqliteGraphStore(path);
      const report = await indexProject(root, production, again);
      again.close();
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(
        compareRows(storeRows(path), await cold(base, root, projectId)),
        [],
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
