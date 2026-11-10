import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
const file = "/tmp/guard-continuations.pym";
function checked(body, inputs = "qty: Nat") {
  return analyseFile(file, () => {}, {
    buffers: {
      [file]: `op r(q: Nat) -> Unit requires q > 0 requires q <= 50; flow f(${inputs}) -> Unit { ${body} return unit; }`,
    },
  }).report;
}
for (const body of [
  "if qty > 50 { return unit; } if qty == 0 { return unit; } call r(qty);",
  "if qty == 0 { return unit; } if qty > 50 { return unit; } call r(qty);",
  "if qty == 0 { return unit; } else { if qty > 50 { return unit; } else { call r(qty); } }",
  "if qty > 50 { return unit; } else { if qty == 0 { return unit; } } call r(qty);",
  "if !(qty != 0) { return unit; } if 50 < qty { return unit; } call r(qty);",
  "if qty != 0 { if qty <= 50 { call r(qty); } }",
  "if qty == 0 { return unit; } if qty > 50 { return unit; } for i in 2 { call r(qty); }",
])
  test(
    "guard continuation proves only the surviving scalar range: " + body,
    () => {
      const report = checked(body);
      assert.deepEqual(
        report.diagnostics.filter((d) => ["C004", "C006"].includes(d.code)),
        [],
      );
      const calls = report.results.filter(
        (r) => r.analysisKind === "call-contract",
      );
      assert.ok(calls.length);
      assert.ok(calls.every((r) => r.outcome === "established"));
    },
  );
test("a one-sided guard removes only the excluded witness; two surviving branches join conservatively", () => {
  const one = checked("if qty > 50 { return unit; } call r(qty);");
  const candidates = one.results
    .filter((r) => r.analysisKind === "call-contract")
    .flatMap((r) => r.witnessOrDerivation?.examples ?? []);
  assert.deepEqual(
    candidates.map((c) => c.inputs),
    [{ qty: "0" }],
  );
  const joined = checked(
    "if flag { if qty == 0 { return unit; } } if qty > 50 { return unit; } call r(qty);",
    "qty: Nat, flag: Bool",
  );
  assert.ok(
    joined.diagnostics.some(
      (d) => d.code === "C004" && /qty.*0/.test(d.message),
    ),
  );
  assert.equal(
    joined.results.find((r) => r.analysisKind === "call-contract").outcome,
    "counterexample",
  );
});
test("bounds cannot silently introduce misspelt symbolic names", () => {
  const source = "flow f(n: Nat) -> Unit bound nn <= 5 { return unit; }";
  const report = analyseFile(file, () => {}, {
    buffers: { [file]: source },
  }).report;
  const error = report.diagnostics.find((d) => d.code === "N002");
  assert.ok(error);
  assert.equal(error.severity, "error");
  assert.match(error.message, /Bound nn names no parameter/);
});
