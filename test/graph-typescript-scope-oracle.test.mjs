import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify } from "../dist/graph/languages/typescript/rename.js";
import {
  agrees,
  analyse,
  buildCorpus,
  runOracle,
} from "./fixtures/graph-typescript/scope-oracle.mjs";

// The scope analysis of `require` against Node itself: every call site in a
// deterministic corpus is run in Node and classified by the analysis.
test("the require scope analysis agrees with Node on every corpus site", async () => {
  const cases = buildCorpus();
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-scope-oracle-"));
  try {
    const node = await runOracle(scratch, cases);
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
      }
    }
    assert.ok(sites >= 200, `corpus has ${sites} sites`);
    assert.deepEqual(disagreements, []);
    // Never "real" where Node did not reach the real loader, in any category.
    for (const item of cases) {
      const ours = analyse(classify, item);
      for (const id of item.sites)
        if (node[id] !== "real")
          assert.notEqual(ours[id], "real", `${item.file} ${id}`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
