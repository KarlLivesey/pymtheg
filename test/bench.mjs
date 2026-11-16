// SPDX-License-Identifier: MIT
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
const dir = mkdtempSync(join(tmpdir(), "pym-bench-"));
try {
  const measurements = [];
  for (const count of [1000, 10000]) {
    const file = join(dir, "rules.pym");
    writeFileSync(
      file,
      Array.from(
        { length: count },
        (_, i) => `rule copy${i}(p: Int) -> Bool = p > 0;`,
      ).join("\n"),
    );
    const { report } = analyseFile(file);
    assert.equal(report.measurements.ruleDefinitions, count);
    assert.equal(report.measurements.ruleNodes, count * 3);
    assert.equal(report.measurements.rulePairComparisons, 0);
    assert.equal(report.measurements.parses, 1);
    measurements.push({
      ruleCount: count,
      ...report.measurements,
      rssBytes: process.memoryUsage().rss,
    });
  }
  const result = {
    date: new Date().toISOString(),
    node: process.versions.node,
    measurements,
    note: "One measurement per size, warm process; no theoretical runtime guarantee. Counts are deterministic; timings are observations.",
  };
  writeFileSync(
    "evidence/benchmarks.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
