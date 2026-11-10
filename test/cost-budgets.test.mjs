import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
function check(source) {
  const root = mkdtempSync(join(tmpdir(), "pym-budget-proof-"));
  try {
    const file = join(root, "main.pym");
    writeFileSync(file, source);
    return analyseFile(file).report;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const main = (report) =>
  report.results.find((r) => r.propertyId.endsWith("#main/cost/calls"));
test("an unconstrained work variable cannot establish a constant budget", () => {
  const report = check(
    "op scan(n: Nat) -> Unit cost calls exact n; flow main(n: Nat) -> Unit budget calls <= 5 { call scan(n); }",
  );
  assert.notEqual(main(report).outcome, "established");
  assert.equal(main(report).completion, "incomplete");
  assert.ok(main(report).outstandingObligations.length);
});
test("the maximum of a variable budget is not a lower bound on that budget", () => {
  // n=0 is permitted: five calls violate a budget of zero.
  const report = check(
    "op five() -> Unit cost calls exact 5; flow main(n: Nat) -> Unit bound n <= 10 budget calls <= n { call five(); }",
  );
  assert.notEqual(main(report).outcome, "established");
});
test("a pointwise symbolic budget can be proved without a numeric population bound", () => {
  const report = check(
    "op scan(n: Nat) -> Unit cost calls exact 2 * n + 1; flow main(n: Nat) -> Unit budget calls <= 3 * n + 2 { call scan(n); }",
  );
  assert.equal(main(report).outcome, "established");
  assert.equal(main(report).completion, "complete");
});

test("an upper-bound budget excess is unresolved until its source path is validated", () => {
  const report = check(
    "op step() -> Unit cost calls exact 1; flow main(n: Nat) -> Unit bound n <= 10 budget calls <= 1 { for i in n { if i == 0 { return unit; } call step(); } return unit; }",
  );
  const result = main(report);
  assert.ok(result.diagnostics.some((d) => d.code === "K002"));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.completion, "unsupported");
  assert.equal(result.witnessValidation, "unvalidated");
  assert.ok(
    result.outstandingObligations.some((o) =>
      o.includes("source-path feasibility"),
    ),
  );
});

test("symbolic coverage agrees with independently enumerated integer populations", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-budget-populations-"));
  let state = 0xbad15;
  const random = (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) % n;
  };
  const expression = (c) =>
    `${c[0]} + ${c[1]} * n + ${c[2]} * m + ${c[3]} * n * m + ${c[4]} * n * n`;
  const value = (c, n, m) =>
    c[0] + c[1] * n + c[2] * m + c[3] * n * m + c[4] * n * n;
  const cases = Array.from({ length: 160 }, () => ({
    work: Array.from({ length: 5 }, () => random(4)),
    budget: Array.from({ length: 5 }, () => random(4)),
  }));
  try {
    const file = join(root, "populations.pym");
    writeFileSync(
      file,
      cases
        .map(
          (c, i) =>
            `op work${i}(n: Nat, m: Nat) -> Unit cost calls exact ${expression(c.work)}; flow case${i}(n: Nat, m: Nat) -> Unit bound n <= 3 bound m <= 3 budget calls <= ${expression(c.budget)} { call work${i}(n,m); }`,
        )
        .join("\n"),
    );
    const report = analyseFile(file).report;
    assert.ok(
      report.diagnostics.every((d) => d.code === "K002" || d.code === "K006"),
      JSON.stringify(report.diagnostics),
    );
    const counts = { covered: 0, exceeded: 0, unresolved: 0 };
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const r = report.results.find((r) =>
        r.propertyId.endsWith(`#case${i}/cost/calls`),
      );
      const safe = [0, 1, 2, 3].every((n) =>
        [0, 1, 2, 3].every((m) => value(c.work, n, m) <= value(c.budget, n, m)),
      );
      if (r.outcome === "established") {
        counts.covered++;
        assert.equal(safe, true, `false coverage for ${JSON.stringify(c)}`);
      } else if (r.outcome === "counterexample") {
        counts.exceeded++;
        assert.equal(safe, false, `false violation for ${JSON.stringify(c)}`);
      } else {
        counts.unresolved++;
        assert.ok(r.outstandingObligations.length);
      }
    }
    assert.ok(counts.covered > 0);
    assert.ok(counts.exceeded > 0);
    console.log(
      "Pointwise symbolic budget outcomes over 160 independently enumerated populations:",
      counts,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
