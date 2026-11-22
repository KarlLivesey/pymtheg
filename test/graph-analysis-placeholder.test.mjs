// SPDX-License-Identifier: MIT
// C-52: a file an analyse-only module was asked about comes back with a
// result or a named failure cause, never the indexer's "Awaiting project
// analysis" placeholder (microsoft/TypeScript at SW-7 stored 8,409 such
// files from a pre-merge build).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";

test("a module that answers a file with the placeholder fails that file with a named cause", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "c52-placeholder-"));
  const root = join(scratch, "project");
  await mkdir(root);
  await writeFile(join(root, "a.toy"), "def a\n");
  await writeFile(join(root, "b.toy"), "def b\ncall a\n");
  // Analyse-only: answers b.toy properly, and hands a.toy's stored input
  // (the placeholder) back.
  const { parse, ...rest } = toy;
  const module = {
    ...rest,
    analyze(context) {
      return context.files.map((file) =>
        file.path === "a.toy"
          ? { path: file.path, result: file.result }
          : { path: file.path, result: parse({ path: file.path, text: file.text }) },
      );
    },
  };
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "c52");
  try {
    const report = await indexProject(root, new LanguageRegistry([module]), store);
    const a = store.getFile("a.toy").result;
    assert.equal(a.status, "failed");
    assert.notEqual(a.diagnostics[0].message, "Awaiting project analysis");
    assert.match(a.diagnostics[0].message, /module returned no result for this file/);
    assert.equal(a.failureKind, "transient");
    assert.equal(store.getFile("b.toy").result.status, "clean");
    assert.deepEqual(report.analysisErrors, [
      { module: module.id, message: "returned no result for 1 files" },
    ]);
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
