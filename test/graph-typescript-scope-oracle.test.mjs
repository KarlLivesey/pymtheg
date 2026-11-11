import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript from "../dist/graph/languages/typescript/index.js";
import { classify } from "../dist/graph/languages/typescript/rename.js";
import {
  agrees,
  analyse,
  buildCorpus,
  checkEmitted,
  runOracle,
} from "./fixtures/graph-typescript/scope-oracle.mjs";

// The scope analysis of `require` against Node itself: every call site in a
// deterministic corpus is run in Node; the analysis' classification AND the
// links the module actually emits for that site must agree with Node.
test("the require scope analysis and the emitted links agree with Node on every corpus site", async () => {
  const cases = buildCorpus();
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-scope-oracle-"));
  const corpus = join(scratch, "corpus");
  let store;
  try {
    const node = await runOracle(corpus, cases);
    store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "oracle");
    const report = await indexProject(
      corpus,
      new LanguageRegistry([typescript]),
      store,
    );
    assert.deepEqual(report.analysisErrors, []);
    const links = store.links();
    const depModule = store
      .findSymbols({ file: "dep.cjs" })
      .find((symbol) => symbol.kind === "module");
    assert.ok(depModule, "dep.cjs is indexed");
    const disagreements = [];
    let sites = 0;
    for (const item of cases) {
      const ours = analyse(classify, item);
      for (const id of item.sites) {
        sites++;
        if (!agrees(item.category, node[id], ours[id]))
          disagreements.push(
            `${item.file} [${item.mode}] ${item.template} ${id}: node=${node[id]} ours=${ours[id]}`,
          );
        const emitted = checkEmitted(
          item,
          id,
          node[id],
          ours[id],
          links,
          depModule.id,
        );
        if (emitted)
          disagreements.push(
            `${item.file} [${item.mode}] ${item.template} ${id}: emitted: ${emitted} (node=${node[id]} ours=${ours[id]})`,
          );
      }
    }
    assert.ok(sites >= 200, `corpus has ${sites} sites`);
    assert.deepEqual(disagreements, []);
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
