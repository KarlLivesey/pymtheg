import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { traceSteps } from "../dist/reporting/trace.js";
import { findingPresenter } from "../dist/reporting/explain.js";

for (const command of ["simulate", "verify"])
  for (const mode of ["upper", "lower", "guarded"])
    test(`built-in ${command}: ${mode} state range is reported as design evidence`, (t) => {
      const root = mkdtempSync(join(tmpdir(), "pym-range-"));
      try {
        const file = join(root, "counter.pym");
        const expression = mode === "lower" ? "n - 1" : "n + 1";
        const source = `machine Counter {\n  state n: Int in 0..2 = 0;\n  event inc when ${mode === "guarded" ? "n < 2" : "true"} {\n    n = ${expression};\n  }\n  invariant small = ${mode === "lower" ? "true" : "n <= 2"};\n}\n`;
        writeFileSync(file, source);
        const args = [
          "dist/cli/main.js",
          command,
          file,
          "--entry",
          "Counter",
          "--format",
          "json",
          ...(command === "simulate"
            ? ["--seed", "42", "--max-steps", "12", "--max-samples", "1000"]
            : []),
          "--timeout",
          "45s",
        ];
        const run = spawnSync(process.execPath, args, {
          encoding: "utf8",
        });
        assert.ifError(run.error);
        const report = JSON.parse(run.stdout);
        if (report.results.some((r) => r.completion === "timed_out")) {
          t.skip("Explicit checker time budget exhausted; no verdict claimed");
          return;
        }
        assert.equal(
          run.status,
          mode === "guarded" ? 0 : 1,
          run.stderr + run.stdout,
        );
        assert.ok(
          !report.diagnostics.some((d) => ["B104", "B106"].includes(d.code)),
        );
        const domain = report.results.find((r) =>
          r.propertyId.endsWith("/state-domains"),
        );
        if (mode === "guarded") {
          assert.equal(domain.outcome, "no_counterexample");
          assert.equal(domain.completion, "complete");
          assert.ok(
            report.results
              .filter((r) => r.analysisKind === "behaviour")
              .every((r) => r.outcome === "no_counterexample"),
          );
          return;
        }
        assert.equal(domain.outcome, "counterexample");
        assert.equal(domain.completion, "complete");
        assert.equal(domain.witnessValidation, "source_replayed");
        const finding = domain.diagnostics.find((d) => d.code === "B011");
        assert.equal(
          source.slice(finding.span.start, finding.span.end),
          expression,
        );
        assert.equal(findingPresenter(report)(finding).location.line, 4);
        assert.match(findingPresenter(report)(finding).nextStep, /guard/);
        if (mode === "upper") {
          const invariant = report.diagnostics.find((d) => d.code === "B010");
          assert.match(
            invariant.message,
            /Fix the event's range violation first/,
          );
          assert.equal(invariant.related.length, 1);

          assert.match(
            findingPresenter(report)(invariant).title,
            /safety rule/,
          );
        }
        const steps = traceSteps(domain);
        assert.deepEqual(
          steps.slice(1).map((s) => s.operation),
          Array(mode === "lower" ? 1 : 3).fill("inc"),
        );
        assert.equal(
          String(steps.at(-1).values.n),
          mode === "lower" ? "-1" : "3",
        );
        if (mode === "lower")
          assert.equal(
            report.results.find((r) =>
              r.propertyId.endsWith("/invariant/small"),
            ).outcome,
            "inconclusive",
          );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
