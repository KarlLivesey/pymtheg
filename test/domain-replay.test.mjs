// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { lower, initial, step, replay } from "../dist/behaviour/model.js";
const file = "/tmp/pym-domain-replay.pym";
function model(
  expression = "n + 1",
  initialValue = "0",
  invariant = "invariant small = n <= 2;",
) {
  const text = `machine Counter { state n: Int in 0..2 = ${initialValue}; event inc when true { n = ${expression}; } ${invariant} }`;
  const { ir } = analyseFile(file, () => {}, { buffers: { [file]: text } });
  const result = lower(ir, "Counter");
  assert.equal(result.kind, "supported");
  return result.model;
}
function trace(m, count) {
  const values = [{ values: initial(m.machine), event: -2 }];
  const event = m.events.find((e) => e.source === "inc");
  for (let i = 0; i < count; i++)
    values.push({
      values: step(m.machine, values.at(-1).values, "inc"),
      event: event.index,
    });
  return values;
}
test("a source-replayed final range violation keeps its event trace and exact assignment", () => {
  const m = model();
  const result = replay(m, trace(m, 3));
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.violated, ["small"]);
  assert.equal(result.domainViolations[0].state, "n");
  assert.equal(result.domainViolations[0].value, "3");
  assert.equal(result.domainViolations[0].minimum, "0");
  assert.equal(result.domainViolations[0].maximum, "2");
  assert.deepEqual(
    result.events.map((e) => e.operation),
    ["inc", "inc", "inc"],
  );
  assert.equal(result.domainViolations[0].span.file, file);
  assert.ok(result.domainViolations[0].span.start > m.machine.span.start);
});
test("lower overflow and a jump are valid domain counterexamples when the explicit invariant stays true", () => {
  for (const [expression, value] of [
    ["n - 1", "-1"],
    ["n + 10", "10"],
  ]) {
    const m = model(expression, "0", "invariant always = true;");
    const result = replay(m, trace(m, 1));
    assert.equal(result.valid, true, result.reason);
    assert.deepEqual(result.violated, []);
    assert.equal(result.domainViolations[0].value, value);
  }
});
test("invented final values and continuations after overflow remain invalid witnesses", () => {
  const m = model();
  const corrupted = trace(m, 3);
  corrupted.at(-1).values.n = 20n;
  assert.equal(replay(m, corrupted).valid, false);
  assert.equal(replay(m, trace(m, 4)).valid, false);
  assert.equal(
    replay(m, trace(m, 2)).valid,
    false,
    "A legal boundary is not a violation",
  );
});
