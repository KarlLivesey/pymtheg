import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { tryFlow } from "../dist/behaviour/trial.js";
const file = "/tmp/pym-loop-facts.pym";
const check = (source) =>
  analyseFile(file, () => {}, { buffers: { [file]: source } });
const calls = (r) =>
  r.report.results.filter((r) => r.analysisKind === "call-contract");
test("signed list elements never acquire a nonnegative index fact", () => {
  const run = check(
    "op r(q: Int) -> Unit requires q >= 0; flow f(xs: List<Int>) -> Unit bound xs <= 3 { for x in xs { call r(x); } return unit; }",
  );
  assert.ok(calls(run).length);
  assert.ok(calls(run).every((r) => r.outcome !== "established"));
  assert.equal(tryFlow(run.ir, "f", { xs: ["-5"] }).completion, "violated");
  assert.ok(run.report.diagnostics.some((d) => d.code === "C004"));
});
test("established list and cardinality contracts survive boundary examples in the production trial evaluator", () => {
  for (const source of [
    "op r(q: Nat) -> Unit requires q >= 0; flow f(xs: List<Nat>) -> Unit bound xs <= 3 { for x in xs { call r(x); } return unit; }",
    "op r(q: Nat) -> Unit requires q > 0 requires q <= 3; flow f(n: Nat) -> Unit bound n <= 3 { for i in n { call r(i + 1); } return unit; }",
    "op r(q: Bool) -> Unit requires q == true; flow f(xs: List<Bool>) -> Unit bound xs <= 3 { for x in xs { if x { call r(x); } } return unit; }",
  ]) {
    const run = check(source);
    assert.deepEqual(
      run.report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    assert.ok(
      calls(run).every((r) => r.outcome === "established"),
      JSON.stringify(calls(run)),
    );
    const inputs = source.includes("List<Nat>")
      ? [{ xs: [] }, { xs: ["0"] }, { xs: ["0", "1", "50"] }]
      : source.includes("List<Bool>")
        ? [{ xs: [] }, { xs: [false, true] }]
        : [{ n: "0" }, { n: "1" }, { n: "3" }];
    for (const input of inputs) {
      const result = tryFlow(run.ir, "f", input);
      assert.equal(result.completion, "complete", JSON.stringify(result));
    }
  }
});
test("list bounds constrain length, never the values of list elements", () => {
  const run = check(
    "op r(q: Nat) -> Unit requires q <= 3; flow f(xs: List<Nat>) -> Unit bound xs <= 3 { for x in xs { call r(x); } return unit; }",
  );
  assert.ok(calls(run).some((r) => r.outcome === "inconclusive"));
  assert.equal(tryFlow(run.ir, "f", { xs: ["99"] }).completion, "violated");
});
test("mixed signatures produce candidates only for rule inputs, and unsupported rules still appear in findings", () => {
  const run = check(
    "op r(patient: String, q: Nat) -> Unit requires q > 0; flow f(patient: String, n: Nat) -> Unit { call r(patient,n); return unit; }",
  );
  assert.ok(
    run.report.diagnostics.some(
      (d) => d.code === "C004" && /source inputs/.test(d.message),
    ),
  );
  assert.deepEqual(calls(run)[0].witnessOrDerivation.examples[0].inputs, {
    patient: "",
    n: "0",
  });
  const unsupported = check(
    'op r(patient: String) -> Unit requires patient != "" effects(remote.Net); flow f(patient: String) -> Unit effects(remote.Net) { call r(patient); return unit; }',
  );
  assert.ok(
    unsupported.report.diagnostics.some(
      (d) => d.code === "C007" && /no concrete candidate/.test(d.message),
    ),
  );
});
test("assertions narrow continuing paths and scalar guard exclusions cannot reappear as candidates", () => {
  const asserted = check(
    "op r(q: Nat) -> Unit requires q > 0 requires q <= 50; flow f(n: Nat) -> Unit { assert n > 0 && n <= 50; call r(n); return unit; }",
  );
  assert.ok(calls(asserted).every((r) => r.outcome === "established"));
  const guarded = check(
    "op r(q: Nat) -> Unit requires q != 51; flow f(n: Nat) -> Unit { if n == 51 { return unit; } call r(n); return unit; }",
  );
  assert.ok(calls(guarded).every((r) => r.outcome === "established"));
});

test("established list-call contracts cannot contradict boundary trials across signed and unsigned guards", () => {
  let established = 0;
  for (const type of ["Int", "Nat"])
    for (const condition of ["q >= 0", "q > 0", "q <= 2", "q == 1", "q != 1"])
      for (const guard of [
        "",
        "if x < 0 { return unit; }",
        "if x <= 0 { return unit; }",
        "if x > 2 { return unit; }",
        "if x == 1 { return unit; }",
      ]) {
        const source = `op r(q: ${type}) -> Unit requires ${condition}; flow f(xs: List<${type}>) -> Unit bound xs <= 3 { for x in xs { ${guard} call r(x); } return unit; }`;
        const run = check(source),
          call = calls(run)[0];
        if (call?.outcome !== "established") continue;
        established++;
        for (const value of type === "Nat"
          ? [0, 1, 2, 3]
          : [-3, -1, 0, 1, 2, 3]) {
          const trial = tryFlow(run.ir, "f", { xs: [String(value)] });
          assert.equal(
            trial.completion,
            "complete",
            source + "\n" + JSON.stringify(trial),
          );
        }
      }
  assert.ok(
    established >= 10,
    `Expected a meaningful set of established contracts, saw ${established}`,
  );
});

test("Boolean aliases refine their captured bindings but cannot refine a shadowing loop variable", () => {
  const guarded = check(
    "op r(q: Nat) -> Unit requires q > 0 requires q <= 50; flow f(n: Nat) -> Unit { let ok = n > 0 && n <= 50; if !ok { return unit; } call r(n); return unit; }",
  );
  assert.ok(calls(guarded).every((r) => r.outcome === "established"));
  for (const n of ["0", "1", "50", "51"])
    assert.equal(tryFlow(guarded.ir, "f", { n }).completion, "complete");
  const shadow = check(
    "op r(q: Nat) -> Unit requires q > 0; flow f(n: Nat, count: Nat) -> Unit bound count <= 2 { let ok = n > 0; for n in count { if ok { call r(n); } } return unit; }",
  );
  assert.ok(calls(shadow).some((r) => r.outcome === "inconclusive"));
  assert.ok(shadow.report.diagnostics.some((d) => d.code === "N001"));
  assert.equal(
    tryFlow(shadow.ir, "f", { n: "1", count: "1" }).completion,
    "unsupported",
  );
});

test("alias predicates keep the same immutable binding through intervening range refinement", () => {
  const run = check(
    "op r(q: Nat) -> Unit requires q > 0 requires q <= 50; flow f(n: Nat) -> Unit { let ok = n <= 50; if n == 0 { return unit; } if !ok { return unit; } call r(n); return unit; }",
  );
  assert.ok(calls(run).every((r) => r.outcome === "established"));
  for (const n of ["0", "1", "50", "51"])
    assert.equal(tryFlow(run.ir, "f", { n }).completion, "complete");
});
