import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteGraphStore,
  LanguageRegistry,
  indexProject,
} from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";

// Destructive nested mutations, not just replacement of the returned root.
function corrupt(value) {
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === "object") corrupt(value[key]);
    else value[key] = typeof value[key] === "number" ? -1 : "mutated";
  }
  if (Array.isArray(value)) value.push("mutated");
}

test("every store snapshot and retained module argument is isolated from later reads and runs", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-core-isolation-"));
  let store;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    await writeFile(
      join(root, "x.toy"),
      "def x\ncall x\ncall missing\ndef y\ndef z\n",
    );
    await writeFile(join(root, "project.cfg"), "config");
    const retained = [];
    let authoritative = false;
    const metadata = () => ({ nested: { values: ["original"] } });
    const module = {
      ...toy,
      contextFiles: ["project.cfg"],
      parse(input) {
        const result = toy.parse(input);
        result.data = metadata();
        result.diagnostics.push({
          message: "informational",
          range: { start: 0, end: 0 },
        });
        for (const fact of [...result.symbols, ...result.links])
          fact.data = metadata();
        retained.push(input, result);
        return result;
      },
      analyze(context) {
        const result = structuredClone(context.files[0].result);
        result.data = metadata();
        result.data.nested.values.push("analyzed");
        const output = authoritative ? [{ path: "x.toy", result }] : [];
        retained.push(context, output);
        // An in-place edit without an authoritative replacement must not enter the cache.
        context.files[0].result.data.nested.values[0] = "module-local edit";
        return output;
      },
      resolve(context) {
        const source = context.symbols.find((symbol) => symbol.name === "x");
        const output = {
          resolutions: toy.resolve(context),
          links: [
            {
              key: "choice",
              file: "x.toy",
              sourceId: source.id,
              kind: "implements",
              targetName: "choice",
              range: source.range,
              data: metadata(),
              candidateIds: context.symbols
                .filter((symbol) => symbol.kind === "function")
                .map((symbol) => symbol.id),
            },
          ],
        };
        retained.push(context, output);
        return output;
      },
    };
    const registry = new LanguageRegistry([module]);
    const database = join(scratch, "graph.sqlite");
    store = new SqliteGraphStore(database, "isolation");
    await indexProject(root, registry, store);
    const id = store.findSymbols({ name: "x" })[0].id;
    const read = (target = store) => ({
      file: target.getFile("x.toy"),
      files: target.files(),
      contexts: target.contexts(),
      symbols: target.findSymbols(),
      named: target.findSymbols({ name: "x" }),
      links: target.links(),
      outgoing: target.outgoing(id),
      incoming: target.incoming(id),
      unresolved: target.unresolved(),
      ambiguous: target.ambiguous(),
      neighbourhood: target.neighbourhood(id, 3),
    });
    // This oracle has no aliases to any store result, including cache-hit results.
    const expected = structuredClone(read());
    assert.equal(expected.file.result.data.nested.values[0], "original");
    for (const key of Object.keys(expected)) {
      corrupt(read()[key]);
      assert.deepEqual(read(), expected, `${key} mutations must not leak`);
    }
    // Exercise first decoding as well as warmed caches for both cache families.
    for (const first of [
      (target) => target.getFile("x.toy"),
      (target) => target.files(),
      (target) => target.contexts(),
    ]) {
      const cold = new SqliteGraphStore(database);
      try {
        corrupt(first(cold));
        assert.deepEqual(
          read(cold),
          expected,
          "cold snapshots must also be independent",
        );
      } finally {
        cold.close();
      }
    }
    const repeat = await indexProject(root, registry, store);
    const expectedReport = structuredClone(repeat);
    // Mutate every parse input/output, analyze context, resolve context/output retained
    // across invocations. Current-run snapshot semantics are not changed by this test.
    for (const value of retained) corrupt(value);
    corrupt(repeat);
    assert.deepEqual(
      read(),
      expected,
      "retained callback objects must not corrupt persisted/cache facts",
    );
    const next = await indexProject(root, registry, store);
    assert.deepEqual(
      next,
      expectedReport,
      "reports and callback inputs must be fresh on the next run",
    );
    assert.deepEqual(read(), expected);
    authoritative = true;
    const analyzed = await indexProject(root, registry, store);
    assert.equal(analyzed.analyzed, 1);
    const expectedAnalyzed = structuredClone(read());
    assert.deepEqual(expectedAnalyzed.file.result.data.nested.values, [
      "original",
      "analyzed",
    ]);
    for (const value of retained) corrupt(value);
    assert.deepEqual(
      read(),
      expectedAnalyzed,
      "authoritative analyze outputs must also be copied into storage",
    );
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
