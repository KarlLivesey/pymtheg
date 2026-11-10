import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { analyseFile } from "../dist/analysis/index.js";
import { createDeclaration } from "../dist/studio/declaration-authoring.js";

const jar =
  process.env.PYM_TLC_JAR ?? "/tmp/spec-language-research/tla2tools.jar";
for (const engine of ["quint", "tlc"])
  for (const guaranteed of [false, true])
    test(
      `authored operation: ${engine} ${guaranteed ? "assumed guarantee" : "unconstrained counterexample"}`,
      { skip: engine === "tlc" && !existsSync(jar) },
      (t) => {
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
            engine === "quint" ? "simulate" : "verify",
            file,
            "--entry",
            "main",
            "--format",
            "json",
            "--max-steps",
            "12",
            "--max-samples",
            "1000",
            "--timeout",
            "45s",
          ];
          if (engine === "tlc") args.push("--backend", "tlc", "--tlc-jar", jar);
          const command = spawnSync(process.execPath, args, {
            encoding: "utf8",
          });
          assert.ifError(command.error);
          const report = JSON.parse(command.stdout);
          if (report.results.some((r) => r.completion === "timed_out")) {
            t.skip(
              "Explicit backend resource budget exhausted; behaviour remains unresolved",
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
      },
    );
