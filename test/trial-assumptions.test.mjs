// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { tryFlow } from "../dist/behaviour/trial.js";
for (const returns of ["Unit", "Bool"])
  test(`input trial retains abstract operation assumptions (${returns})`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pym-trial-assumptions-"));
    try {
      const file = join(root, "main.pym");
      await writeFile(
        file,
        `op fetch() -> ${returns} effects(remote.Store) atomic; flow main() -> Bool effects(remote.Store) { call fetch() as value; return true; }`,
      );
      const { ir, report } = analyseFile(file);
      assert.deepEqual(
        report.diagnostics.filter((x) => x.severity === "error"),
        [],
      );
      const result = tryFlow(ir, "main", {});
      assert.equal(
        result.completion,
        returns === "Unit" ? "complete" : "unsupported",
      );
      if (returns === "Unit") assert.equal(result.output, true);
      assert.ok(
        result.assumptions.some(
          (x) =>
            x.includes("#fetch") &&
            x.includes("environment contracts") &&
            x.includes("atomic"),
        ),
        JSON.stringify(result),
      );
      assert.ok(
        result.assumptions.some((x) =>
          x.includes("cancellation is not injected"),
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
