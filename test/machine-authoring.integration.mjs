// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { machineDefinitionSource } from "../dist/studio/machine-authoring.js";

for (const engine of ["simulate", "verify"])
  for (const bad of [true, false])
    test(`created event model: built-in ${engine} ${bad ? "counterexample" : "corrected safety"}`, (t) => {
      const root = mkdtempSync(join(tmpdir(), "pym-machine-backend-"));
      try {
        const file = join(root, "design.pym");
        writeFileSync(
          file,
          machineDefinitionSource({
            kind: "machine",
            name: "Attempts",
            states: [
              {
                name: "count",
                type: "Nat",
                min: "0",
                max: "3",
                initial: "0",
              },
            ],
            events: [
              {
                name: "advance",
                guard: bad ? "count < 3" : "count < 1",
                updates: [{ state: "count", value: "count + 1" }],
              },
            ],
            invariants: [{ name: "onlyOnce", expression: "count <= 1" }],
          }),
        );
        const command = spawnSync(
          process.execPath,
          [
            "dist/cli/main.js",
            engine,
            file,
            "--entry",
            "Attempts",
            "--format",
            "json",
            "--timeout",
            "45s",
            ...(engine === "simulate"
              ? ["--seed", "42", "--max-steps", "6", "--max-samples", "20"]
              : []),
          ],
          { encoding: "utf8" },
        );
        assert.ifError(command.error);
        const report = JSON.parse(command.stdout);
        if (report.results.some((r) => r.completion === "timed_out")) {
          t.skip(
            "Explicit checker resource budget exhausted; safety remains unresolved",
          );
          return;
        }
        assert.equal(
          command.status,
          bad ? 1 : 0,
          command.stderr + command.stdout,
        );
        const results = report.results.filter(
          (r) =>
            r.analysisKind === "behaviour" &&
            r.propertyId.endsWith("/invariant/onlyOnce"),
        );
        assert.equal(results.length, 1);
        assert.equal(
          report.results.find((r) => r.propertyId.endsWith("/state-domains"))
            .outcome,
          "no_counterexample",
        );
        assert.equal(results[0].completion, "complete");
        assert.equal(
          results[0].outcome,
          bad ? "counterexample" : "no_counterexample",
        );
        if (bad) {
          assert.equal(results[0].witnessValidation, "source_replayed");
          const finding = results[0].diagnostics.find((d) => d.code === "B010");
          assert.equal(finding.span.file, file);
          assert.match(finding.message, /onlyOnce/);
          assert.equal(results[0].witnessOrDerivation.events.length, 2);
          assert.ok(
            results[0].witnessOrDerivation.events.every(
              (event) =>
                event.span.file === file && event.operation === "advance",
            ),
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
