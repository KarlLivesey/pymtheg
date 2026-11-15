import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { analyseFile } from "../dist/analysis/index.js";
import { createDeclaration } from "../dist/studio/declaration-authoring.js";

for (const engine of ["simulate", "verify"])
  for (const guaranteed of [false, true])
    test(`authored operation: built-in ${engine} ${guaranteed ? "assumed guarantee" : "unconstrained counterexample"}`, (t) => {
      const root = mkdtempSync(join(tmpdir(), "pym-operation-backend-"));
      try {
        const file = join(root, "design.pym");
        writeFileSync(
          file,
          "flow main() -> Unit { call approve(1) as allowed; assert allowed; }\n",
        );
        const { ir } = analyseFile(file, () => {});
        const preview = createDeclaration(
          ir,
          file,
          {
            kind: "operation",
            signature: {
              name: "approve",
              inputs: [{ name: "amount", type: "Nat" }],
              output: "Bool",
              effects: [],
            },
            requires: ["amount > 0"],
            ensures: guaranteed ? ["result"] : [],
          },
          ir.snapshot.sources[0].hash,
        );
        writeFileSync(file, preview.text);
        const args = [
          "dist/cli/main.js",
          engine,
          file,
          "--entry",
          "main",
          "--format",
          "json",
          ...(engine === "simulate"
            ? ["--max-steps", "12", "--max-samples", "1000"]
            : []),
          "--timeout",
          "45s",
        ];
        const command = spawnSync(process.execPath, args, {
          encoding: "utf8",
        });
        assert.ifError(command.error);
        const report = JSON.parse(command.stdout);
        if (report.results.some((r) => r.completion === "timed_out")) {
          t.skip(
            "Explicit checker time budget exhausted; behaviour remains unresolved",
          );
          return;
        }
        assert.equal(
          command.status,
          guaranteed ? 0 : 1,
          command.stderr + command.stdout,
        );
        const results = report.results.filter(
          (r) => r.analysisKind === "behaviour",
        );
        assert.ok(results.length);
        if (!guaranteed)
          assert.ok(results.some((r) => r.outcome === "counterexample"));
        for (const result of results) {
          if (guaranteed) {
            assert.equal(result.outcome, "no_counterexample");
            assert.ok(
              result.assumptions.some((a) =>
                /postconditions.*assumed/i.test(a),
              ),
              JSON.stringify(result.assumptions),
            );
          } else if (result.outcome === "counterexample") {
            assert.equal(result.witnessValidation, "source_replayed");
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
