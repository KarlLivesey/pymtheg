// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import {
  lower,
  replay,
  sourceMappingValid,
  initial,
  step,
} from "../dist/behaviour/model.js";
import { result, exitStatus } from "../dist/reporting/report.js";
function fixture(source, fn) {
  const dir = mkdtempSync(join(tmpdir(), "pym-model-"));
  try {
    const file = join(dir, "main.pym");
    writeFileSync(file, source);
    return fn(analyseFile(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const src =
  "machine Swap { state left: Nat in 0..1 = 0; state right: Nat in 0..1 = 1; event exchange when left == 0 { left = right; right = left; } invariant original = left == 0; }";
test("simultaneous source updates, valid replay and corrupt witness rejection", () =>
  fixture(src, ({ ir }) => {
    const p = lower(ir, "Swap");
    assert.equal(p.kind, "supported");
    const m = p.model,
      first = initial(m.machine),
      next = step(m.machine, first, "exchange");
    assert.deepEqual(next, { left: 1n, right: 0n });
    const trace = [
      { values: first, event: -2 },
      { values: next, event: 0 },
    ];
    assert.equal(replay(m, trace).valid, true);
    assert.equal(
      replay(m, [trace[0], { values: { left: 1n, right: 1n }, event: 0 }])
        .valid,
      false,
    );
    assert.equal(sourceMappingValid(m, ir), true);
    assert.equal(
      sourceMappingValid({ ...m, snapshotId: "changed" }, ir),
      false,
    );
    assert.equal(sourceMappingValid({ ...m, hash: "changed" }, ir), false);
    const wrongSpan = {
      ...m,
      events: m.events.map((e) => ({
        ...e,
        span: { ...e.span, start: 0, end: 1 },
      })),
    };
    assert.equal(
      sourceMappingValid(wrongSpan, ir),
      false,
      "in-bounds spans must still identify the actual source event",
    );
  }));
test("a valid structured flow lowers from its typed source", () =>
  fixture("flow f() -> Unit { return unit; }", ({ ir }) => {
    assert.equal(ir.diagnostics.length, 0);
    assert.equal(lower(ir, "f").kind, "supported");
  }));
test("result renderer cannot promote incomplete/sampled/heuristic claims", () =>
  fixture(src, ({ ir, report }) => {
    for (const options of [
      { completion: "incomplete" },
      { completion: "timed_out" },
      { completion: "cancelled" },
      { method: "simulation" },
      { method: "heuristic" },
      { outstandingObligations: ["hole"] },
    ])
      assert.equal(result(ir, "test", "test", options).outcome, "inconclusive");
    for (const [completion, exit] of [
      ["incomplete", 2],
      ["unsupported", 2],
      ["timed_out", 2],
      ["failed", 3],
      ["cancelled", 130],
    ]) {
      report.results = [result(ir, "test", "test", { completion })];
      assert.equal(exitStatus(report), exit);
    }
  }));
test("locally typed String expressions are rejected before behavioural lowering", () =>
  fixture(
    'machine M { state n: Nat in 0..1 = 0; invariant equal = "text" == "text"; }',
    ({ ir }) => {
      assert.equal(ir.diagnostics.length, 0);
      const plan = lower(ir, "M");
      assert.equal(plan.kind, "unsupported");
      assert.match(plan.reasons.join(), /literals/);
    },
  ));
test("repeated-call consistency checks use an effect index rather than pairwise scans", () => {
  for (const count of [100, 400]) {
    const source =
      Array.from(
        { length: count },
        (_, i) => `op read${i}() -> Unit effects(remote.Store) stable;`,
      ).join("\n") +
      `\nflow f(N: Nat) -> Unit effects(remote.Store) bound N <= 20 { for i in N { ${Array.from({ length: count }, (_, i) => `call read${i}();`).join(" ")} } }`;
    fixture(source, ({ report }) => {
      assert.equal(
        report.results.filter((r) => r.analysisKind === "repeated-work").length,
        count,
      );
      assert.ok(report.measurements.repeatedEffectVisits <= 2 * count);
      assert.ok(
        report.results
          .filter((r) => r.analysisKind === "repeated-work")
          .every((r) => !r.witnessOrDerivation.safeToInvestigateHoist),
      );
    });
  }
});
test("task local model counts initial retry attempts and preserves uncertain results", () => {
  const { report } = analyseFile("examples/mvp/task-local.pym");
  const costs = report.results.filter((r) => r.analysisKind === "cost");
  assert.equal(
    costs.find((r) => r.propertyId.includes("#blindRetry/")).witnessOrDerivation
      .maximum,
    "3",
  );
  assert.equal(
    costs.find((r) => r.propertyId.includes("#reconcileFirst/"))
      .witnessOrDerivation.maximum,
    "1",
  );
  assert.ok(report.diagnostics.some((d) => d.code === "K002"));
  assert.ok(!report.diagnostics.some((d) => d.code === "C002"));
});
