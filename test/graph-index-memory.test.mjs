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
      // The last file belongs to the second module: a module that owns no
      // file is not handed the graph at all (C-22).
      for (let i = 0; i < count; i++)
        await writeFile(
          join(root, `${i}.${i === count - 1 ? "syn2" : "syn"}`),
          `source ${i}`,
        );
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
          // It resolves nothing, but it still gets the graph.
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
          // Derived links on its own files only.
          return synthetic.resolve({
            ...context,
            symbols: context.symbols.filter(
              (symbol) => symbol.module === synthetic.id,
            ),
          });
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

/**
 * A storage backend that does not declare independent reads: it caches its
 * symbol list and returns the same records to every caller, and it lacks the
 * optional light reads.
 */
function cachingAdapter(store) {
  let symbols;
  return {
    projectId: store.projectId,
    files: () => store.files(),
    getFile: (path) => store.getFile(path),
    contexts: () => store.contexts(),
    replaceContexts: (files) => store.replaceContexts(files),
    isParseFailure: (path) => store.isParseFailure(path),
    replaceFile(file, parseFailure) {
      symbols = undefined;
      return store.replaceFile(file, parseFailure);
    },
    removeFile(path) {
      symbols = undefined;
      return store.removeFile(path);
    },
    findSymbols: (query) =>
      query && Object.keys(query).length
        ? store.findSymbols(query)
        : (symbols ??= store.findSymbols()),
    links: () => store.links(),
    outgoing: (id, kind) => store.outgoing(id, kind),
    incoming: (id, kind) => store.incoming(id, kind),
    unresolved: () => store.unresolved(),
    ambiguous: () => store.ambiguous(),
    resolveLinks: (resolutions) => store.resolveLinks(resolutions),
    replaceAnalysis: (module, result) => store.replaceAnalysis(module, result),
    neighbourhood: (id, depth, kind) => store.neighbourhood(id, depth, kind),
    close: () => store.close(),
  };
}

test("a store that does not declare independent reads still gives each resolver its own input", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-index-shared-"));
  let store;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    for (let i = 0; i < 5; i++)
      await writeFile(join(root, `${i}.syn`), `source ${i}`);
    store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "shared");
    // Runs first and scribbles over the symbols it was given.
    const mutator = {
      id: "mutator",
      version: "1",
      extensions: [".mut"],
      parse: () => ({
        status: "clean",
        diagnostics: [],
        symbols: [],
        links: [],
      }),
      resolve({ symbols }) {
        for (const symbol of symbols) {
          symbol.name = "changed";
          symbol.key = "changed";
        }
        return [];
      },
    };
    const report = await indexProject(
      root,
      new LanguageRegistry([mutator, synthetic]),
      cachingAdapter(store),
    );
    assert.deepEqual(report.resolutionErrors, []);
    // Every parsed call resolves to its own symbol, as with an unshared store.
    assert.equal(report.links, 5 * 30);
    assert.equal(report.unresolved, 0);
    assert.equal(report.ambiguous, 5 * 10);
    assert.ok(store.findSymbols().every((symbol) => symbol.name !== "changed"));
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("validating added links decodes only the files that receive them", async () => {
  const { default: toy } = await import("../dist/graph/languages/toy/index.js");
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-index-validate-"));
  let store;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    await writeFile(join(root, "a.syn"), "source");
    await writeFile(join(root, "z.toy"), "def z\ncall z\n");
    store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "validate");
    // From the moment the synthetic resolver returns until the store writes
    // its result, record which stored files are decoded.
    let validating = false;
    const decoded = [];
    const resolveThenValidate = {
      ...synthetic,
      resolve(context) {
        const result = synthetic.resolve({
          ...context,
          symbols: context.symbols.filter((s) => s.module === synthetic.id),
        });
        validating = true;
        return result;
      },
    };
    const replace = store.replaceAnalysis.bind(store);
    store.replaceAnalysis = (...args) => {
      validating = false;
      return replace(...args);
    };
    const parse = JSON.parse;
    JSON.parse = function (...args) {
      const value = parse.apply(this, args);
      if (validating && isFileRecord(value)) decoded.push(value.path);
      return value;
    };
    let report;
    try {
      report = await indexProject(
        root,
        new LanguageRegistry([resolveThenValidate, toy]),
        store,
      );
    } finally {
      JSON.parse = parse;
    }
    assert.deepEqual(report.resolutionErrors, []);
    // The synthetic resolver adds links to a.syn only.
    assert.equal(store.linksForFile("a.syn").length, 30);
    assert.deepEqual(decoded, ["a.syn"]);
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("an added link without a file is a resolution error, not a crash", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-index-nofile-"));
  let store;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    await writeFile(join(root, "a.syn"), "source");
    store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "nofile");
    const malformed = {
      ...synthetic,
      resolve: ({ symbols }) => ({
        resolutions: [],
        links: [
          {
            key: "no-file",
            sourceId: symbols[0].id,
            kind: "calls",
            targetName: "x",
            range: { start: 0, end: 1 },
          },
        ],
      }),
    };
    const report = await indexProject(
      root,
      new LanguageRegistry([malformed]),
      store,
    );
    assert.deepEqual(report.resolutionErrors, [
      {
        module: "synthetic",
        message: "Invalid or duplicate added link origin/key",
      },
    ]);
    // Parsed facts stay; no link is resolved by the rejected result.
    assert.equal(report.symbols, 10);
    assert.equal(report.links, 10);
    assert.equal(report.unresolved, 10);
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
