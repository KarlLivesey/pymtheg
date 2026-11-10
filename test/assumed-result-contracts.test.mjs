import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
const file = "/tmp/assumed-result-contracts.pym";
function check(source) {
  return analyseFile(file, () => {}, { buffers: { [file]: source } }).report;
}
function calls(report, name) {
  return report.results.filter(
    (r) =>
      r.analysisKind === "call-contract" && r.propertyId.includes(`#${name}/`),
  );
}
const base =
  "op mk() -> Int ensures result > 5; op need(v: Int) -> Unit requires v > 0;";
test("supported assumed return bounds discharge the consuming call and retain provenance through arithmetic", () => {
  const report = check(
    base +
      "flow good() -> Unit { call mk() as c; let k = c - 5; call need(k); }",
  );
  assert.deepEqual(report.diagnostics, []);
  const [producer, consumer] = calls(report, "good");
  assert.equal(producer.outcome, "established");
  assert.deepEqual(producer.assumptions, [
    `Trusted abstract postconditions of ${file}#mk`,
  ]);
  assert.equal(consumer.outcome, "established");
  assert.deepEqual(consumer.assumptions, [
    `Trusted abstract postconditions of ${file}#mk`,
  ]);
});
test("subtracting past the assumed bound remains unresolved; a guaranteed bad value violates", () => {
  const uncertain = calls(
    check(
      base +
        "flow bad() -> Unit { call mk() as c; let k = c - 10; call need(k); }",
    ),
    "bad",
  ).at(-1);
  assert.equal(uncertain.outcome, "inconclusive");
  assert.equal(uncertain.assumptions.length, 1);
  const violated = check(
    base.replace("result > 5", "result == 0") +
      "flow bad() -> Unit { call mk() as c; call need(c); }",
  );
  assert.ok(violated.diagnostics.some((d) => d.code === "C004"));
});
test("failed, pending, contradictory and concrete guarantees never justify a consumer", () => {
  for (const [producer, invoke] of [
    [
      "op mk(n: Int) -> Int requires n > 0 ensures result > 5;",
      "call mk(0) as c;",
    ],
    [
      "op mk(n: Int) -> Int requires n > 0 ensures result > 5;",
      "call mk(n) as c;",
    ],
    ["op mk() -> Int ensures result > 5 && result < 3;", "call mk() as c;"],
    ["flow mk() -> Int ensures result > 5 { return 0; }", "call mk() as c;"],
  ]) {
    const report = check(
      producer +
        "op need(v: Int) -> Unit requires v > 0; flow bad(n: Int) -> Unit { " +
        invoke +
        "call need(c); }",
    );
    assert.equal(calls(report, "bad").at(-1).outcome, "inconclusive", producer);
    assert.deepEqual(calls(report, "bad").at(-1).assumptions, [], producer);
  }
});
test("typed operation results can be refined by guards without inventing guarantees", () => {
  const report = check(
    "op mk() -> Int; op need(v: Int) -> Unit requires v > 0; flow guarded() -> Unit { call mk() as c; if c > 0 { call need(c); } }",
  );
  assert.equal(calls(report, "guarded").at(-1).outcome, "established");
  assert.deepEqual(calls(report, "guarded").at(-1).assumptions, []);
});
test("branch and return evidence retain assumed input dependencies even when calling with literals", () => {
  const report = check(
    "op coin() -> Bool ensures result; op need(v: Int) -> Unit requires v > 0; flow branch() -> Int ensures result > 0 { call coin() as b; if b { call need(1); return 1; } return 0; }",
  );
  assert.equal(calls(report, "branch").at(-1).outcome, "established");
  assert.match(calls(report, "branch").at(-1).assumptions[0], /#coin$/);
  const post = report.results.find((r) =>
    r.propertyId.endsWith("#branch/postconditions"),
  );
  assert.equal(post.outcome, "established");
  assert.match(post.assumptions[0], /#coin$/);
});
test("literal caller parameters, negative bounds, booleans and unsupported disjunction stay sound", () => {
  for (const [producer, invoke, expected] of [
    [
      "op mk(n: Int) -> Int ensures result > n;",
      "call mk(5) as c;",
      "established",
    ],
    ["op mk() -> Int ensures -1 < result;", "call mk() as c;", "inconclusive"],
    [
      "op mk() -> Int ensures result > 5 || result < 3;",
      "call mk() as c;",
      "inconclusive",
    ],
  ])
    assert.equal(
      calls(
        check(
          producer +
            "op need(v: Int) -> Unit requires v > 0; flow f() -> Unit { " +
            invoke +
            "call need(c); }",
        ),
        "f",
      ).at(-1).outcome,
      expected,
    );
  const boolean = check(
    "op mk() -> Bool ensures result == true; op need(v: Bool) -> Unit requires v; flow f() -> Unit { call mk() as c; call need(c); }",
  );
  assert.equal(calls(boolean, "f").at(-1).outcome, "established");
});

test("unused assumed results do not taint an independent call", () => {
  const report = check(
    base + "flow independent() -> Unit { call mk() as c; call need(1); }",
  );
  assert.deepEqual(calls(report, "independent").at(-1).assumptions, []);
});

test("conflicting Boolean guarantees never justify a consumer, including input-dependent contradictions", () => {
  for (const [operation, call] of [
    [
      "op coin() -> Bool ensures result == true && result == false;",
      "call coin() as b;",
    ],
    [
      "op coin(a: Bool) -> Bool ensures result == a && result != a;",
      "call coin(true) as b;",
    ],
    [
      "op coin(a: Bool) -> Bool ensures result == a ensures result != a;",
      "call coin(false) as b;",
    ],
    [
      "op coin(a: Int) -> Int ensures result > a && result < 3;",
      "call coin(5) as b;",
    ],
  ]) {
    const bool = operation.includes("-> Bool");
    const report = check(
      operation +
        (bool
          ? "op accept(v: Bool) -> Unit requires !v;"
          : "op accept(v: Int) -> Unit requires v > 0;") +
        "flow f() -> Unit { " +
        call +
        " call accept(b); }",
    );
    assert.ok(
      report.diagnostics.some((d) => d.code === "V002"),
      operation,
    );
    const consumer = calls(report, "f").at(-1);
    assert.equal(consumer.outcome, "inconclusive", operation);
    assert.deepEqual(consumer.assumptions, [], operation);
  }
});

test("a helper rule's unmet preconditions cannot justify an operation's assumed result", () => {
  const report = check(
    "rule permitted(n: Nat) -> Bool requires n > 0 = true; op produce() -> Int requires permitted(0) ensures result > 5; op need(v: Int) -> Unit requires v > 0; flow f() -> Unit { call produce() as result; call need(result); }",
  );
  for (const call of calls(report, "f")) {
    assert.equal(call.outcome, "inconclusive");
    assert.deepEqual(call.assumptions, []);
  }
});
