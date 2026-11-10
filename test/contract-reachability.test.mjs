import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { tryFlow } from "../dist/behaviour/trial.js";
const file = "/tmp/pym-reachability-regression.pym";
const check = (source) =>
  analyseFile(file, () => {}, { buffers: { [file]: source } });

test("unvalidated reachability never turns a range-only violation into a complete counterexample", () => {
  for (const [params, guards, inputs] of [
    [
      "cents: Int",
      "if cents > 0 && cents < 100 { return unit; } if cents != 50 { return unit; }",
      { cents: "50" },
    ],
    [
      "cents: Int, label: String",
      'if label == "ok" { return unit; } if label != "ok" { return unit; }',
      { cents: "50", label: "ok" },
    ],
    [
      "cents: Int",
      "if cents > 0 && cents < 100 { return unit; } if cents != 50 { return unit; }",
      { cents: "0" },
    ],
  ]) {
    const run = check(
      `op charge(q: Int) -> Unit requires q >= 100; flow f(${params}) -> Unit { ${guards} call charge(50); return unit; }`,
    );
    assert.equal(tryFlow(run.ir, "f", inputs).completion, "complete");
    const call = run.report.results.find(
      (r) => r.analysisKind === "call-contract",
    );
    // A precise guard may eliminate the call entirely; otherwise it stays pending.
    if (call) {
      assert.equal(call.outcome, "inconclusive");
      assert.equal(call.completion, "unsupported");
      assert.equal(call.witnessValidation, "unvalidated");
      assert.ok(call.diagnostics.some((d) => d.code === "C009"));
    }
    assert.ok(!run.report.diagnostics.some((d) => d.code === "C004"));
  }
  const actual = check(
    "op charge(q: Int) -> Unit requires q >= 100; flow f() -> Unit { call charge(50); return unit; }",
  );
  assert.equal(tryFlow(actual.ir, "f", {}).completion, "violated");
  assert.ok(actual.report.diagnostics.some((d) => d.code === "C004"));
});

test("single-variable affine guards refine with signed integer rounding", () => {
  for (const [guard, rule] of [
    ["-d < -5000", "q <= 5000"],
    ["d - 5000 > 0", "q <= 5000"],
    ["2 * d > 10001", "q <= 5000"],
    ["-2 * d > -10001", "q >= 5001"],
    ["3 * d < -7", "q >= -2"],
    ["3 * d <= -7", "q >= -2"],
  ]) {
    const run = check(
      `op charge(q: Int) -> Unit requires ${rule}; flow f(d: Int) -> Unit { if ${guard} { return unit; } call charge(d); return unit; }`,
    );
    const call = run.report.results.find(
      (r) => r.analysisKind === "call-contract",
    );
    assert.equal(call?.outcome, "established", guard);
    for (const d of [-5001, -4, -3, -2, -1, 0, 5000, 5001, 5002])
      assert.equal(
        tryFlow(run.ir, "f", { d: String(d) }).completion,
        "complete",
        `${guard}: ${d}`,
      );
  }
});

test("assertion continuations and short-circuit expressions keep source reachability honest", () => {
  const blocked = check(
    'op charge(q: Int) -> Unit requires q >= 100; flow f(label: String) -> Unit { assert label == "ok"; assert label != "ok"; call charge(50); return unit; }',
  );
  assert.ok(!blocked.report.diagnostics.some((d) => d.code === "C004"));
  const pending = blocked.report.results.find(
    (r) => r.analysisKind === "call-contract",
  );
  if (pending) assert.equal(pending.outcome, "inconclusive");
  for (const expression of ["false && allowed(0)", "true || allowed(0)"]) {
    const run = check(
      `rule allowed(q: Int) -> Bool requires q >= 100 = true; flow f() -> Bool { return ${expression}; }`,
    );
    assert.equal(tryFlow(run.ir, "f", {}).completion, "complete");
    assert.ok(
      !run.report.results.some((r) => r.analysisKind === "call-contract"),
    );
  }
  const conditional = check(
    "rule allowed(q: Int) -> Bool requires q >= 100 = true; flow f(flag: Bool) -> Bool { return flag && allowed(0); }",
  );
  const call = conditional.report.results.find(
    (r) => r.analysisKind === "call-contract",
  );
  assert.equal(call.outcome, "inconclusive");
  assert.equal(call.witnessValidation, "unvalidated");
});

test("reachable bad calls remain errors after requirements, choices, loops and source calls", () => {
  for (const source of [
    "flow f(x: Int) -> Unit requires x > 0 { call r(-1); return unit; }",
    "flow f(b: Bool) -> Unit { if b { return unit; } call r(-1); return unit; }",
    "flow f(d: Int) -> Unit { if d > 3 { call r(-1); return unit; } call r(-1); return unit; }",
    "flow f(n: Nat) -> Unit bound n <= 3 { for i in n { let value = i; } call r(-1); return unit; }",
    "flow child() -> Unit { return unit; } flow f() -> Unit { call child(); call r(-1); return unit; }",
  ]) {
    const run = check("op r(q: Int) -> Unit requires q >= 0; " + source);
    const replayed = run.report.results.filter(
      (r) => r.witnessValidation === "source_replayed",
    );
    assert.ok(replayed.length, source);
    for (const property of replayed) {
      assert.equal(property.outcome, "counterexample");
      assert.ok(
        property.diagnostics.some(
          (d) => d.code === "C004" && d.severity === "error",
        ),
      );
      for (const example of property.witnessOrDerivation.examples)
        assert.equal(
          tryFlow(run.ir, example.entry, example.inputs).completion,
          "violated",
        );
    }
  }
});

test("a failure earlier in the source cannot confirm a different later condition", () => {
  const run = check(
    "op r(q: Int) -> Unit requires q > 0 requires q < 5; flow f() -> Unit { call r(0); call r(-1); return unit; }",
  );
  const calls = run.report.results.filter(
    (r) => r.analysisKind === "call-contract",
  );
  assert.equal(calls[0].outcome, "counterexample");
  assert.equal(calls[1].outcome, "inconclusive");
  assert.equal(calls[1].witnessValidation, "unvalidated");
});

test("return guarantee failures are replayed without claiming an unreachable return", () => {
  for (const source of [
    "flow f(x: Int) -> Int requires x > 0 ensures result > 0 { return -1; }",
    "flow f(b: Bool) -> Int ensures result > 0 { if b { return -1; } return 1; }",
    'flow f() -> String ensures result == "ok" { return "bad"; }',
  ]) {
    const run = check(source);
    const property = run.report.results.find(
      (r) => r.analysisKind === "contracts",
    );
    assert.equal(property.outcome, "counterexample", source);
    assert.equal(property.witnessValidation, "source_replayed", source);
    assert.ok(
      property.diagnostics.some(
        (d) => d.code === "C005" && d.severity === "error",
      ),
    );
    assert.deepEqual(property.outstandingObligations, []);
    for (const example of property.witnessOrDerivation.examples)
      assert.equal(
        tryFlow(run.ir, example.entry, example.inputs).completion,
        "violated",
      );
  }
  const impossible = check(
    'flow f(label: String) -> Int ensures result >= 0 { if label == "ok" { return 0; } if label != "ok" { return 0; } return -1; }',
  );
  assert.ok(!impossible.report.diagnostics.some((d) => d.code === "C005"));
});
