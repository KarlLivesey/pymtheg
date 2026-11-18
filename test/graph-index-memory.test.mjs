// SPDX-License-Identifier: MIT
// C-2: indexing must not keep decoded graph records alive or deep-copy the
// graph per module. Behaviour proxies, not memory sizes: v8.queryObjects
// counts live objects after a full garbage collection, so the counts below are
// exact and independent of machine speed or heap limits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryObjects } from "node:v8";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";

/** Marks every decoded stored file record so live ones can be counted. */
class DecodedFile {}
const isFileRecord = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof value.text === "string" &&
  typeof value.result === "object";

async function observe(counts, run) {
  const parse = JSON.parse;
  const clone = globalThis.structuredClone;
  JSON.parse = function (...args) {
    const value = parse.apply(this, args);
    if (isFileRecord(value))
      Object.setPrototypeOf(value, DecodedFile.prototype);
    return value;
  };
  // Count stored file records handed to structuredClone, at any depth.
  globalThis.structuredClone = (value, ...rest) => {
    const seen = new Set();
    const walk = (item) => {
      if (item === null || typeof item !== "object" || seen.has(item)) return;
      seen.add(item);
      if (isFileRecord(item) && "module" in item) counts.clonedFiles++;
      for (const child of Object.values(item)) walk(child);
    };
    walk(value);
    return clone(value, ...rest);
  };
  try {
    await run();
  } finally {
    JSON.parse = parse;
    globalThis.structuredClone = clone;
  }
}
const live = () => queryObjects(DecodedFile, { format: "count" });

test("indexing keeps no decoded file alive and deep-copies no file record, at any project size", async () => {
  for (const count of [20, 80]) {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-index-memory-"));
    let store;
    try {
      const root = join(scratch, "project");
      await mkdir(root);
      for (let i = 0; i < count; i++)
        await writeFile(join(root, `${i}.syn`), `source ${i}`);
      store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "memory");
      let counts;
      // Two modules over the same files: the second must not see the first's
      // resolver input still alive, and nothing may outlive the run.
      const second = {
        ...synthetic,
        id: "second",
        extensions: [".syn2"],
        resolve(context) {
          counts.liveDuringResolve.push(live());
          // It owns no files: nothing to resolve, but it still gets the graph.
          return synthetic.resolve({ ...context, symbols: [], links: [] });
        },
      };
      const first = {
        ...synthetic,
        // A project phase over every file: its input and results must be
        // gone before resolution starts.
        analyze({ files }) {
          return files.map((file) => ({
            path: file.path,
            result: file.result,
          }));
        },
        resolve(context) {
          counts.liveDuringResolve.push(live());
          return synthetic.resolve(context);
        },
      };
      const registry = new LanguageRegistry([first, second]);
      for (const run of ["cold", "unchanged", "edited"]) {
        if (run === "edited")
          await writeFile(join(root, "0.syn"), "edited source");
        counts = { clonedFiles: 0, liveDuringResolve: [] };
        await observe(counts, async () => {
          const report = await indexProject(root, registry, store);
          assert.equal(report.symbols, count * 10, run);
          assert.deepEqual(report.resolutionErrors, [], run);
        });
        assert.equal(counts.clonedFiles, 0, `${run}: no file record cloned`);
        // While a module resolves, only its own input (one record per file)
        // is alive: no store cache, no earlier module's copy.
        assert.deepEqual(counts.liveDuringResolve, [count, count], run);
        assert.equal(live(), 0, `${run}: no decoded record outlives the run`);
      }
    } finally {
      store?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  }
});

test("a module's analysis write prepares each statement once, however many links it writes", async () => {
  const prepared = [];
  for (const count of [20, 80]) {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-index-statements-"));
    let store;
    try {
      const root = join(scratch, "project");
      await mkdir(root);
      for (let i = 0; i < count; i++)
        await writeFile(join(root, `${i}.syn`), `source ${i}`);
      store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "statements");
      // Count statements prepared while the store writes a module's
      // resolution: ten resolved links, ten definite and ten candidate
      // derived links per file.
      let writing = false;
      let calls = 0;
      const prepare = store.db.prepare.bind(store.db);
      store.db.prepare = (sql) => {
        if (writing) calls++;
        return prepare(sql);
      };
      const replace = store.replaceAnalysis.bind(store);
      store.replaceAnalysis = (...args) => {
        writing = true;
        try {
          return replace(...args);
        } finally {
          writing = false;
        }
      };
      const report = await indexProject(
        root,
        new LanguageRegistry([synthetic]),
        store,
      );
      assert.equal(report.links, count * 30);
      assert.equal(report.ambiguous, count * 10);
      prepared.push(calls);
    } finally {
      store?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  }
  // The reads before the write prepare a fixed few as well.
  assert.equal(prepared[0], prepared[1], JSON.stringify(prepared));
  assert.ok(prepared[0] <= 12, JSON.stringify(prepared));
});
