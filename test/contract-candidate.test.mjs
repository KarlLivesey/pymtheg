// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
const file = "/tmp/contract-candidate.pym";
function check(source) {
  return analyseFile(file, () => {}, { buffers: { [file]: source } }).report;
}
test("a mixed safe/unsafe input range gives a located replay-confirmed counterexample", () => {
  const report = check(
    "op charge(amount: Nat) -> Unit requires amount > 0;\nflow checkout(total: Nat) -> Unit { call charge(total); return unit; }\n",
  );
  const review = report.diagnostics.find((d) => d.code === "C004");
  assert.ok(review);
  assert.equal(review.severity, "error");
  assert.match(review.message, /source inputs.*total.*0.*replayed/);
  assert.equal(review.span.file, file);
  assert.equal(
    review.span.start,
    report.snapshot.files[0].text.indexOf("call charge"),
  );
  const result = report.results.find((r) => r.analysisKind === "call-contract");
  assert.equal(result.outcome, "counterexample");
  assert.equal(result.witnessValidation, "source_replayed");
  assert.deepEqual(result.witnessOrDerivation.examples[0].inputs, {
    total: "0",
  });
  assert.deepEqual(result.outstandingObligations, []);
});
test("guarded calls stay established and definite violations retain their existing error", () => {
  const guarded = check(
    "op charge(amount: Nat) -> Unit requires amount > 0; flow checkout(total: Nat) -> Unit { if total > 0 { call charge(total); } return unit; }",
  );
  assert.equal(
    guarded.diagnostics.some((d) => d.code === "C006"),
    false,
  );
  assert.equal(
    guarded.results.find((r) => r.analysisKind === "call-contract").outcome,
    "established",
  );
  const violated = check(
    "op charge(amount: Nat) -> Unit requires amount > 0; flow checkout() -> Unit { call charge(0); return unit; }",
  );
  assert.ok(
    violated.diagnostics.some(
      (d) => d.code === "C004" && d.severity === "error",
    ),
  );
  assert.equal(
    violated.diagnostics.some((d) => d.code === "C006"),
    false,
  );
});
test("correlated source arguments are replayed while unsupported execution remains unresolved", () => {
  const correlated = check(
    "op pair(a: Nat, b: Nat) -> Unit requires a == b; flow f(n: Nat) -> Unit { call pair(n, n + 1); return unit; }",
  );
  const result = correlated.results.find(
    (r) => r.analysisKind === "call-contract",
  );
  assert.equal(result.outcome, "counterexample");
  assert.equal(result.witnessValidation, "source_replayed");
  assert.equal(result.witnessOrDerivation.examples[0].sourceReplay, true);
  const unsupported = check(
    'op consume(text: String) -> Unit requires text == "ok" effects(remote.Net); flow f(text: String) -> Unit { call consume(text); return unit; }',
  );
  assert.equal(
    unsupported.diagnostics.some(
      (d) => d.code === "C007" && /no concrete candidate/.test(d.message),
    ),
    true,
  );
});
