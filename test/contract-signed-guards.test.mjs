import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { tryFlow } from "../dist/behaviour/trial.js";
const file = "/tmp/pym-signed-guards.pym";
const check = (source) =>
  analyseFile(file, () => {}, { buffers: { [file]: source } });
const calls = (run) =>
  run.report.results.filter((r) => r.analysisKind === "call-contract");

test("signed bounds refine guards, aliases, asserts and copied caller rules in both orientations", () => {
  for (const body of [
    "if d < -500 { return unit; }",
    "if -500 > d { return unit; }",
    "let ok = d >= -500; if !ok { return unit; }",
    "assert d >= -500;",
    "if d < (0 - 500) { return unit; }",
  ]) {
    const run = check(
      `op r(q: Int) -> Unit requires q >= -500; flow f(d: Int) -> Unit { ${body} call r(d); return unit; }`,
    );
    assert.equal(calls(run).length, 1);
    assert.equal(calls(run)[0].outcome, "established", body);
    for (const d of [-501, -500, -499, 0, 1]) {
      const trial = tryFlow(run.ir, "f", { d: String(d) });
      if (body.startsWith("assert") && d < -500)
        assert.equal(trial.completion, "violated");
      else assert.equal(trial.completion, "complete", JSON.stringify(trial));
    }
  }
  const copied = check(
    "op r(q: Int) -> Unit requires q >= -5; flow f(d: Int) -> Unit requires d >= -5 { call r(d); return unit; }",
  );
  assert.equal(calls(copied)[0].outcome, "established");
  const excluded = check(
    "op r(q: Int) -> Unit requires q != -5; flow f(d: Int) -> Unit { if d == -5 { return unit; } call r(d); return unit; }",
  );
  assert.equal(calls(excluded)[0].outcome, "established");
});

test("candidate messages preserve original argument positions after filtering unrelated parameters", () => {
  const run = check(
    "op mv(a: String, b: Nat, c: Nat) -> Unit requires c > 0 requires b < 9; flow f(patient: String, minutes: Nat, count: Nat) -> Unit { call mv(patient, minutes, count); return unit; }",
  );
  const calls = run.report.results.filter(
    (r) => r.analysisKind === "call-contract",
  );
  const examples = calls.flatMap((r) => r.witnessOrDerivation?.examples ?? []);
  assert.ok(examples.some((e) => e.inputs.count === "0"));
  assert.ok(
    examples.some((e) => e.inputs.minutes === "9" && e.inputs.count !== "0"),
  );
  for (const example of examples)
    assert.equal(tryFlow(run.ir, "f", example.inputs).completion, "violated");
});

test("Boolean comparisons retain alias meaning and disjunctions retain bounded scalar holes", () => {
  for (const body of [
    "let ok = d != 0; if ok == false { return unit; }",
    "let ok = d != 0; if false == ok { return unit; }",
    "assert d < 0 || d > 0;",
    "if !(d < 0 || d > 0) { return unit; }",
  ]) {
    const run = check(
      `op r(q: Int) -> Unit requires q != 0; flow f(d: Int) -> Unit { ${body} call r(d); return unit; }`,
    );
    assert.equal(calls(run)[0].outcome, "established", body);
    for (const d of [-2, -1, 0, 1, 2]) {
      const trial = tryFlow(run.ir, "f", { d: String(d) });
      assert.equal(
        trial.completion,
        body.startsWith("assert") && d === 0 ? "violated" : "complete",
      );
    }
  }
  const unsafe = check(
    "op r(q: Int) -> Unit requires q != 0; flow f(d: Int, bypass: Bool) -> Unit { assert d != 0 || bypass; call r(d); return unit; }",
  );
  assert.ok(calls(unsafe).every((r) => r.outcome !== "established"));
  assert.equal(
    tryFlow(unsafe.ir, "f", { d: "0", bypass: true }).completion,
    "violated",
  );
});

test("infeasible assertions cannot silently produce a successful check", () => {
  for (const body of [
    "assert false;",
    "assert d > 5; assert d < 3;",
    "assert d >= -2; assert d <= -3;",
  ]) {
    const run = check(
      `op r(q: Int) -> Unit requires q > 0; flow f(d: Int) -> Unit { ${body} call r(d); return unit; }`,
    );
    assert.ok(
      run.report.diagnostics.some((d) => d.code === "C008"),
      body,
    );
    const result = run.report.results.find((r) =>
      r.diagnostics.some((d) => d.code === "C008"),
    );
    assert.equal(result.outcome, "inconclusive");
    assert.equal(result.completion, "unsupported");
    assert.equal(calls(run).length, 0);
    assert.equal(tryFlow(run.ir, "f", { d: "0" }).completion, "violated");
  }
  const valid = check(
    "flow f(d: Int) -> Unit { assert d >= -5; return unit; }",
  );
  assert.ok(!valid.report.diagnostics.some((d) => d.code === "C008"));
});
