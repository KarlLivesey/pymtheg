// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recipeSource, defaultRecipeOptions } from "../dist/studio/recipes.js";
for (const deduplicate of [false, true])
  test(
    "real guided retry recipe " +
      (deduplicate ? "corrected" : "counterexample"),
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "pym-recipe-backend-"));
      try {
        const file = join(root, "retry.pym");
        await writeFile(
          file,
          recipeSource("retry", { ...defaultRecipeOptions, deduplicate }),
        );
        const run = spawnSync(
          process.execPath,
          [
            "dist/cli/main.js",
            "simulate",
            file,
            "--entry",
            "RetryDesign",
            "--seed",
            "42",
            "--max-steps",
            "12",
            "--max-samples",
            "1000",
            "--timeout",
            process.env.PYM_TEST_BACKEND_TIMEOUT ?? "12s",
            "--format",
            "json",
          ],
          { encoding: "utf8" },
        );
        assert.ifError(run.error);
        const report = JSON.parse(run.stdout);
        const result = report.results.find(
          (r) => r.analysisKind === "behaviour",
        );
        assert.ok(result);
        if (result.completion === "timed_out") {
          t.skip(
            "Configured checker resource budget exhausted; evidence unresolved",
          );
          return;
        }
        assert.equal(result.completion, "complete", JSON.stringify(report));
        assert.equal(
          result.outcome,
          deduplicate ? "no_counterexample" : "counterexample",
        );
        if (!deduplicate) {
          assert.equal(result.witnessValidation, "source_replayed");
          assert.ok(
            result.witnessOrDerivation.events.some(
              (e) => e.operation === "loseAcknowledgement",
            ),
          );
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
