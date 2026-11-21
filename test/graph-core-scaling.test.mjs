// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";

// Count executed JS lookup/array work and actual SQL rows returned, not elapsed time.
// total_changes includes triggers and foreign-key effects, unlike a count of API calls.
async function measure(store, run) {
  const counts = {
    visits: 0,
    lookups: 0,
    iterations: 0,
    rows: 0,
    decodedFiles: 0,
    writes: 0,
    mutations: [],
  };
  const undo = [];
  const replace = (object, key, value) => {
    const old = object[key];
    object[key] = value(old);
    undo.push(() => (object[key] = old));
  };
  const nativePrepare = store.db.prepare.bind(store.db);
  const changes = () =>
    Number(nativePrepare("SELECT total_changes() AS n").get().n);
  const before = changes();
  for (const name of ["map", "filter", "some", "find", "findIndex", "flatMap"])
    replace(
      Array.prototype,
      name,
      (original) =>
        function (callback, ...rest) {
          return original.call(
            this,
            function (...args) {
              counts.visits++;
              return callback.apply(this, args);
            },
            ...rest,
          );
        },
    );
  for (const prototype of [Map.prototype, Set.prototype])
    for (const name of ["get", "set", "has", "add", "delete"])
      if (prototype[name])
        replace(
          prototype,
          name,
          (original) =>
            function (...args) {
              counts.lookups++;
              return original.apply(this, args);
            },
        );
  // Count for...of, spread and destructuring, including Map/Set entries/keys/values.
  for (const [prototype, names] of [
    [Array.prototype, [Symbol.iterator, "values", "entries", "keys"]],
    [Map.prototype, [Symbol.iterator, "values", "entries", "keys"]],
    [Set.prototype, [Symbol.iterator, "values", "entries", "keys"]],
  ])
    for (const name of names)
      replace(
        prototype,
        name,
        (original) =>
          function (...args) {
            const iterator = original.apply(this, args);
            const next = iterator.next.bind(iterator);
            const wrapped = {
              next(...values) {
                const result = next.apply(undefined, values);
                if (!result.done) counts.iterations++;
                return result;
              },
              [Symbol.iterator]() {
                return this;
              },
            };
            if (iterator.return)
              wrapped.return = iterator.return.bind(iterator);
            if (iterator.throw) wrapped.throw = iterator.throw.bind(iterator);
            return wrapped;
          },
      );
  replace(
    JSON,
    "parse",
    (original) =>
      function (...args) {
        const value = original(...args);
        if (value?.text !== undefined && value?.result !== undefined)
          counts.decodedFiles++;
        return value;
      },
  );
  replace(
    store.db,
    "prepare",
    () =>
      function (sql) {
        const statement = nativePrepare(sql);
        for (const name of ["all", "get", "run"]) {
          const original = statement[name].bind(statement);
          statement[name] = (...args) => {
            const result = original(...args);
            if (name === "all") counts.rows += result.length;
            if (name === "get" && result !== undefined) counts.rows++;
            if (name === "run" && result.changes)
              counts.mutations.push({ sql, args });
            return result;
          };
        }
        return statement;
      },
  );
  try {
    await run();
  } finally {
    for (const restore of undo.reverse()) restore();
  }
  counts.writes = changes() - before;
  return counts;
}

test("first/repeat work is linear; unchanged has zero parses and writes and a fixed number of stored-file decodes per file; one edit writes only its facts", async (t) => {
  const observations = [];
  for (const count of [40, 80, 160, 320]) {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-core-counts-"));
    let store;
    try {
      const root = join(scratch, "project");
      await mkdir(root);
      for (let i = 0; i < count; i++)
        await writeFile(join(root, `${i}.syn`), "source");
      const database = join(scratch, "graph.sqlite");
      store = new SqliteGraphStore(database, "counts");
      let parses = 0;
      const registry = new LanguageRegistry([
        {
          ...synthetic,
          parse(input) {
            parses++;
            return synthetic.parse(input);
          },
        },
      ]);
      const first = await measure(store, () =>
        indexProject(root, registry, store),
      );
      assert.equal(parses, count);
      // The store keeps no decoded file between reads (C-2), so each phase that
      // needs records decodes them again: a fixed number of decodes per file
      // (resolver input, added-link validation, stored replacement), never a
      // retained whole-graph copy.
      assert.ok(first.decodedFiles <= 3 * count, String(first.decodedFiles));
      const bytes = await readFile(database);
      parses = 0;
      const repeat = await measure(store, () =>
        indexProject(root, registry, store),
      );
      assert.equal(parses, 0);
      assert.equal(repeat.writes, 0);
      // Plus one cache-check read per file.
      assert.ok(repeat.decodedFiles <= 4 * count, String(repeat.decodedFiles));
      assert.deepEqual(await readFile(database), bytes);
      await writeFile(join(root, "0.syn"), "edited source");
      const changed = await measure(store, () =>
        indexProject(root, registry, store),
      );
      assert.equal(parses, 1);
      // The synthetic links resolve to their own symbols: all other outcomes are identical.
      const ownIds = new Set(
        [
          ...store.findSymbols({ file: "0.syn" }),
          ...store.links().filter((l) => l.file === "0.syn"),
        ].map((x) => x.id),
      );
      for (const { sql, args } of changed.mutations) {
        if (/graph_files|DELETE FROM graph_links WHERE file|SELECT/.test(sql))
          assert.equal(args[0], "0.syn", sql);
        else if (/graph_symbols/.test(sql)) assert.ok(ownIds.has(args[0]), sql);
        else if (/UPDATE graph_links/.test(sql))
          assert.ok(ownIds.has(args[1]), sql);
        else if (/graph_links|graph_candidates/.test(sql))
          assert.ok(ownIds.has(args[0]), sql);
        // The index run's mark (C-22): set with the first write, cleared last.
        else if (/graph_meta/.test(sql))
          assert.match(sql, /'index-run'|'command-complete'/, sql);
        else assert.fail(`Unexpected write: ${sql}`);
      }
      assert.ok(
        changed.writes > 0 && changed.writes <= 201,
        JSON.stringify(changed),
      );
      const symbol = store.findSymbols({ file: "0.syn" })[0];
      const queries = await measure(store, () => {
        assert.equal(store.findSymbols({ name: symbol.name }).length, 1);
        assert.equal(store.outgoing(symbol.id, "calls").length, 1);
        assert.equal(store.incoming(symbol.id, "calls").length, 1);
        assert.equal(store.unresolved().length, 0);
        assert.equal(
          store.neighbourhood(symbol.id, 2, "calls").symbols.length,
          1,
        );
      });
      assert.equal(queries.decodedFiles, 0);
      assert.ok(queries.rows <= 12, JSON.stringify(queries));
      const ambiguous = await measure(store, () =>
        assert.equal(store.ambiguous().length, count * 10),
      );
      assert.equal(ambiguous.rows, count * 10);
      assert.equal(ambiguous.decodedFiles, 0);
      observations.push({
        files: count,
        first,
        repeat,
        changedWrites: changed.writes,
        queryRows: queries.rows,
      });
      for (let i = 1; i < observations.length; i++)
        for (const phase of ["first", "repeat"])
          for (const metric of ["visits", "lookups", "iterations", "rows"]) {
            const previous = observations[i - 1][phase][metric];
            const current = observations[i][phase][metric];
            assert.ok(
              current <= 2 * previous + 50,
              `${phase} ${metric} grows linearly: ${previous} -> ${current}`,
            );
          }
    } finally {
      store?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  }
  for (const observation of observations)
    assert.equal(
      observation.changedWrites,
      observations[0].changedWrites,
      "One-file writes do not grow with project size",
    );
  for (const { files, first, repeat, changedWrites, queryRows } of observations)
    t.diagnostic(
      JSON.stringify({
        files,
        first: {
          visits: first.visits,
          lookups: first.lookups,
          iterations: first.iterations,
          rows: first.rows,
          writes: first.writes,
        },
        repeat: {
          visits: repeat.visits,
          lookups: repeat.lookups,
          iterations: repeat.iterations,
          rows: repeat.rows,
          writes: repeat.writes,
          decodedFiles: repeat.decodedFiles,
        },
        changedWrites,
        queryRows,
      }),
    );
});

test("a rename writes the changed file and the affected caller, preserving unrelated link outcomes", async () => {
  const { default: toy } = await import("../dist/graph/languages/toy/index.js");
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-core-retarget-"));
  let store;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    for (const [path, text] of Object.entries({
      "target.toy": "def target\n",
      "caller.toy": "def caller\ncall target\n",
      "other.toy": "def other\ncall other\n",
    }))
      await writeFile(join(root, path), text);
    let parses = 0;
    const registry = new LanguageRegistry([
      {
        ...toy,
        parse(input) {
          parses++;
          return toy.parse(input);
        },
        resolve({ symbols, links }) {
          const named = new Map(
            symbols
              .filter((s) => s.kind === "function")
              .map((s) => [s.name, s.id]),
          );
          return links.map((l) => ({
            linkId: l.id,
            targetId: named.get(l.targetName) ?? null,
          }));
        },
      },
    ]);
    store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "retarget");
    await indexProject(root, registry, store);
    const caller = store.links().find((l) => l.file === "caller.toy");
    const other = store.links().find((l) => l.file === "other.toy");
    assert.equal(caller.resolution, "resolved");
    parses = 0;
    await writeFile(join(root, "target.toy"), "def renamed\n");
    const counted = await measure(store, () =>
      indexProject(root, registry, store),
    );
    assert.equal(parses, 1);
    assert.deepEqual(
      store.links().find((l) => l.file === "other.toy"),
      other,
    );
    assert.equal(
      store.links().find((l) => l.file === "caller.toy").resolution,
      "unresolved",
    );
    // Foreign-key invalidation already cleared the caller: writeTargets must not rewrite it.
    assert.equal(
      counted.mutations.filter(({ sql }) => /UPDATE graph_links/.test(sql))
        .length,
      0,
    );
    for (const { sql, args } of counted.mutations) {
      assert.ok(!args.includes(other.id), sql);
      if (/graph_files|DELETE FROM graph_links WHERE file/.test(sql))
        assert.equal(args[0], "target.toy");
    }
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("neighbourhood hydrates an ambiguous link once even when it visits all candidate endpoints", async () => {
  const observations = [];
  for (const count of [40, 80, 160, 320]) {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-core-candidates-"));
    let store;
    try {
      const root = join(scratch, "project");
      await mkdir(root);
      for (let i = 0; i < count; i++)
        await writeFile(join(root, `${i}.syn`), "source");
      store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "candidates");
      const registry = new LanguageRegistry([
        {
          ...synthetic,
          resolve({ symbols, links }) {
            return [
              { linkId: links[0].id, candidateIds: symbols.map((s) => s.id) },
            ];
          },
        },
      ]);
      await indexProject(root, registry, store);
      const ambiguous = store.ambiguous()[0];
      let decodedLinks = 0;
      const original = JSON.parse;
      JSON.parse = (...args) => {
        const value = original(...args);
        if (value?.id === ambiguous.id) decodedLinks++;
        return value;
      };
      let measured;
      try {
        measured = await measure(store, () => {
          const result = store.neighbourhood(ambiguous.sourceId, 2);
          assert.equal(result.symbols.length, count * 10);
          assert.equal(result.links.length, count * 10);
        });
      } finally {
        JSON.parse = original;
      }
      assert.equal(decodedLinks, 1);
      assert.equal(measured.decodedFiles, 0);
      observations.push(measured);
    } finally {
      store?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  }
  for (let i = 1; i < observations.length; i++)
    for (const key of ["rows", "visits", "lookups"])
      assert.ok(
        observations[i][key] <= 2 * observations[i - 1][key] + 50,
        `${key} must scale with candidate/result size`,
      );
});
