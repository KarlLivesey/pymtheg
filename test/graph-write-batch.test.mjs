import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";

const fixtureRoot = new URL("./fixtures/graph/toy/", import.meta.url);
const dump = (store) =>
  JSON.stringify({
    files: store.files(),
    symbols: store.findSymbols(),
    links: store.links(),
    contexts: store.contexts(),
  });
// Analysis rewrites every file, so the analysis write phase is exercised too.
const analysed = {
  ...toy,
  analyze: ({ files }) =>
    files.map((file) => ({
      path: file.path,
      result: { ...file.result, data: { analysed: true } },
    })),
};
const registry = () => new LanguageRegistry([analysed]);

async function project(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-write-batch-"));
  const root = join(scratch, "project");
  await mkdir(root);
  await cp(fixtureRoot, root, { recursive: true });
  const stores = [];
  const open = (name = "graph.sqlite", options) => {
    const store = new SqliteGraphStore(
      join(scratch, name),
      "batch-project",
      options,
    );
    stores.push(store);
    return store;
  };
  const cold = async () => {
    const fresh = open(`cold-${stores.length}.sqlite`);
    await indexProject(root, registry(), fresh);
    return dump(fresh);
  };
  const edit = () =>
    Promise.all([
      writeFile(join(root, "lib.toy"), "def helper\ndef extra\ncall extra\n"),
      writeFile(
        join(root, "main.toy"),
        "import lib.toy\ndef main\ncall extra\n",
      ),
    ]);
  try {
    await run({ scratch, root, open, cold, edit });
  } finally {
    for (const store of stores)
      try {
        store.close();
      } catch {}
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Fail the nth replaceFile call of the next run (counting from 1). */
function failAt(store, nth) {
  const original = store.replaceFile;
  let calls = 0;
  store.replaceFile = function (...args) {
    if (++calls === nth) throw Error("injected storage failure");
    return original.apply(this, args);
  };
  return () => {
    store.replaceFile = original;
  };
}

test("a failure part-way through the parse writes keeps none of them; the next run recovers to cold", async () => {
  await project(async ({ root, open, cold, edit }) => {
    const store = open();
    await indexProject(root, registry(), store);
    const before = dump(store);
    await edit();
    const restore = failAt(store, 2);
    await assert.rejects(
      indexProject(root, registry(), store),
      /injected storage failure/,
    );
    restore();
    // The first file's write was committed under one-commit-per-file; now nothing is.
    assert.equal(dump(store), before);
    await indexProject(root, registry(), store);
    assert.equal(dump(store), await cold());
  });
});

test("a failure part-way through the analysis writes keeps the committed parse phase; the next run recovers to cold", async () => {
  await project(async ({ root, open, cold, edit }) => {
    const store = open();
    await indexProject(root, registry(), store);
    await edit();
    // Two parse writes, then the second analysis write fails.
    const restore = failAt(store, 4);
    await assert.rejects(
      indexProject(root, registry(), store),
      /injected storage failure/,
    );
    restore();
    for (const file of store.files())
      assert.equal(file.result.data, undefined, `${file.path} not analysed`);
    await indexProject(root, registry(), store);
    assert.equal(dump(store), await cold());
  });
});

test("a process killed mid-batch leaves the previous snapshot; the next run recovers to cold", async () => {
  await project(async ({ scratch, root, open, cold, edit }) => {
    const database = join(scratch, "graph.sqlite");
    let store = open();
    await indexProject(root, registry(), store);
    const before = dump(store);
    store.close();
    await edit();
    const dist = new URL("../dist/graph/", import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const g = await import(${JSON.stringify(dist + "index.js")});
        const toy = (await import(${JSON.stringify(dist + "languages/toy/index.js")})).default;
        const store = new g.SqliteGraphStore(${JSON.stringify(database)}, "batch-project");
        const original = store.replaceFile;
        let calls = 0;
        store.replaceFile = function (...args) {
          original.apply(this, args);
          if (++calls === 1) process.exit(7); // after one write, before the batch commits
        };
        await g.indexProject(${JSON.stringify(root)}, new g.LanguageRegistry([toy]), store);`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 7, child.stderr);
    store = open();
    assert.equal(dump(store), before);
    await indexProject(root, registry(), store);
    assert.equal(dump(store), await cold());
  });
});

test("read-only stores without the file-status index read identical links", async () => {
  await project(async ({ scratch, root, open }) => {
    const store = open();
    await indexProject(root, registry(), store);
    const indexed = JSON.stringify(store.links());
    store.close();
    const raw = new DatabaseSync(join(scratch, "graph.sqlite"));
    raw.exec("DROP INDEX graph_file_status");
    raw.close();
    const reader = open("graph.sqlite", { readOnly: true });
    assert.equal(JSON.stringify(reader.links()), indexed);
    const writer = open("graph.sqlite");
    assert.equal(JSON.stringify(writer.links()), indexed);
    await assert.rejects(
      writer.writeBatch(() => writer.writeBatch(async () => {})),
      /do not nest/,
    );
  });
});
