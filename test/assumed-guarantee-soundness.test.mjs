import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
const file = "/tmp/pym-guarantee-enumeration.pym";
function checked(guarantee, returnType, parameter, actual, precondition) {
  const source = `op produce(${parameter}) -> ${returnType} ensures ${guarantee}; op consume(v: ${returnType}) -> Unit requires ${precondition}; flow f() -> Unit { call produce(${actual}) as value; call consume(value); }`;
  const { report } = analyseFile(file, () => {}, {
    buffers: { [file]: source },
  });
  const consumer = report.results
    .filter(
      (r) => r.analysisKind === "call-contract" && r.propertyId.includes("#f/"),
    )
    .at(-1);
  return { report, consumer, source };
}
function compare(result, values, satisfies) {
  if (!values.length) {
    assert.ok(
      result.report.diagnostics.some((d) => d.code === "V002"),
      result.source,
    );
    assert.notEqual(result.consumer.outcome, "established", result.source);
    return;
  }
  const expected = values.every(satisfies)
    ? "established"
    : values.every((v) => !satisfies(v))
      ? "counterexample"
      : "inconclusive";
  assert.equal(result.consumer.outcome, expected, result.source);
  if (expected === "established")
    assert.ok(result.consumer.assumptions.length, result.source);
}
test("scalar guarantee narrowing agrees with independently enumerated bounded integer results", () => {
  for (let lower = -3; lower <= 3; lower++) {
    for (let upper = -3; upper <= 3; upper++) {
      const values = Array.from({ length: 7 }, (_, i) => i - 3).filter(
        (v) => v >= lower && v <= upper,
      );
      for (let threshold = -4; threshold <= 4; threshold++) {
        compare(
          checked(
            `result >= ${lower} && result <= ${upper}`,
            "Int",
            "",
            "",
            `v > ${threshold}`,
          ),
          values,
          (v) => v > threshold,
        );
      }
    }
  }
});
test("Boolean guarantee conjunctions agree with truth tables including actual input values", () => {
  const rules = [
    { text: "result", matches: (r, a) => r },
    { text: "!result", matches: (r, a) => !r },
    { text: "result == true", matches: (r, a) => r === true },
    { text: "false == result", matches: (r, a) => r === false },
    { text: "result != flag", matches: (r, a) => r !== a },
    { text: "result == flag", matches: (r, a) => r === a },
  ];
  for (const a of [true, false])
    for (const left of rules)
      for (const right of rules) {
        const values = [true, false].filter(
          (v) => left.matches(v, a) && right.matches(v, a),
        );
        for (const required of [true, false])
          compare(
            checked(
              `${left.text} && ${right.text}`,
              "Bool",
              "flag: Bool",
              String(a),
              required ? "v" : "!v",
            ),
            values,
            (v) => v === required,
          );
      }
});
