import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { lower, initial, step, replay } from "../dist/behaviour/model.js";

test("the discovery self-model exposes false completeness and preserves honest exact-cap and overflow paths", () => {
  const { ir, report } = analyseFile("examples/self/type-discovery.pym");
  assert.deepEqual(report.diagnostics, []);
  const bad = lower(ir, "PrematureLimitStop"),
    good = lower(ir, "InspectBeyondLimit");
  assert.equal(bad.kind, "supported");
  assert.equal(good.kind, "supported");
  const trace = [{ values: initial(bad.model.machine), event: -2 }];
  for (const name of ["keepType", "keepType", "stopAtLimit"]) {
    const event = bad.model.events.find((e) => e.source === name);
    trace.push({
      values: step(bad.model.machine, trace.at(-1).values, name),
      event: event.index,
    });
  }
  assert.equal(trace.at(-1).values.examined, 2n);
  assert.equal(trace.at(-1).values.complete, true);
  const witness = replay(bad.model, trace);
  assert.equal(witness.valid, true);
  assert.deepEqual(witness.violated, ["completeMeansCovered"]);
  for (const tail of ["emptyTail", "overflowingTail"]) {
    let current = initial(good.model.machine);
    for (const name of ["keepType", "keepType", tail, "finishScan"])
      current = step(good.model.machine, current, name);
    assert.equal(current.examined, 3n);
    assert.equal(current.finished, true);
    assert.equal(current.complete, tail === "emptyTail");
    assert.equal(current.omitted, tail === "overflowingTail");
  }
});
