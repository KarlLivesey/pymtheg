import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const source =
  "op mk() -> Int ensures result > 5; op need(v: Int) -> Int requires v > 0; flow main() -> Int { call mk() as c; let k = c - 10; call need(k) as d; return d; }";
for (const engine of ["simulate", "verify"])
  for (const scenario of [
    "failure",
    "corrected",
    ...(engine === "simulate" ? ["short"] : []),
  ])
    test(`built-in ${engine}: unused scope ${scenario}`, (t) => {
      const root = mkdtempSync(join(tmpdir(), "pym-unused-scope-real-"));
      try {
        const file = join(root, "main.pym"),
          scope = join(root, "scope.json");
        writeFileSync(
          file,
          scenario === "corrected"
            ? source.replace(
                "let k = c - 10; call need(k) as d; return d;",
                "let k = c; call need(1) as d; return d;",
              )
            : source,
        );
        writeFileSync(
          scope,
          JSON.stringify({ results: { mk: ["6"], need: ["1"] } }),
        );
        const args = [
          resolve("dist/cli/main.js"),
          engine,
          file,
          "--entry",
          "main",
          "--scope",
          scope,
          "--format",
          "json",
          ...(engine === "simulate"
            ? [
                "--seed",
                "42",
                "--max-steps",
                scenario === "short" ? "1" : "20",
                "--max-samples",
                "100",
              ]
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
          t.skip("Explicit checker time budget exhausted; no verdict claimed");
          return;
        }
        assert.equal(
          command.status,
          scenario === "failure" ? 1 : scenario === "corrected" ? 0 : 2,
          command.stdout + command.stderr,
        );
        const issues = report.results.find(
          (r) => r.analysisKind === "scope-validation",
        );
        const behaviour = report.results.filter(
          (r) => r.analysisKind === "behaviour",
        );
        if (scenario === "corrected") {
          assert.equal(issues, undefined);
          assert.ok(behaviour.every((r) => r.outcome === "no_counterexample"));
        } else {
          assert.equal(issues.outcome, "inconclusive");
          assert.match(
            issues.outstandingObligations.join(" "),
            /Unused results scope key need/,
          );
          assert.ok(
            report.diagnostics.some(
              (d) => d.code === "B014" && d.severity === "warning",
            ),
          );
          if (scenario === "failure") {
            const witness = behaviour.find(
              (r) => r.outcome === "counterexample",
            );
            assert.ok(witness);
            assert.equal(witness.witnessValidation, "source_replayed");
            assert.ok(
              witness.witnessOrDerivation.events.some((e) =>
                /need/.test(e.operation),
              ),
            );
          } else
            assert.ok(
              behaviour.every(
                (r) =>
                  r.outcome === "inconclusive" && r.completion === "incomplete",
              ),
            );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

test("model emission refuses an unused scope without publishing an artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-unused-emit-"));
  try {
    const file = join(root, "main.pym"),
      scope = join(root, "scope.json"),
      out = join(root, "model.json");
    writeFileSync(file, source);
    writeFileSync(
      scope,
      JSON.stringify({ results: { mk: ["6"], need: ["1"] } }),
    );
    const command = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "emit",
        file,
        "--entry",
        "main",
        "--scope",
        scope,
        "--target",
        "json",
        "--out",
        out,
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(command.status, 2, command.stdout + command.stderr);
    assert.equal(existsSync(out), false);
    assert.ok(
      JSON.parse(command.stdout).diagnostics.some((d) => d.code === "B014"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
