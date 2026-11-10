import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { lower, initial, step, replay } from "../dist/behaviour/model.js";

test("the authoring self-model distinguishes parsed previews, unknown rules and stale check results", () => {
  const { ir, report } = analyseFile("examples/self/contract-authoring.pym");
  assert.deepEqual(report.diagnostics, []);
  const bad = lower(ir, "PrematureRulePublication");
  const good = lower(ir, "CheckedRulePublication");
  assert.equal(bad.kind, "supported");
  assert.equal(good.kind, "supported");
  const trace = [{ values: initial(bad.model.machine), event: -2 }];
  for (const name of ["parseField", "preview", "publish"]) {
    trace.push({
      values: step(bad.model.machine, trace.at(-1).values, name),
      event: bad.model.events.find((e) => e.source === name).index,
    });
  }
  assert.equal(trace.at(-1).values.hasUnknown, true);
  const witness = replay(bad.model, trace);
  assert.equal(witness.valid, true);
  assert.deepEqual(witness.violated, ["checkedCurrentDesign"]);

  let current = initial(good.model.machine);
  for (const name of [
    "parseField",
    "preview",
    "apply",
    "startCheck",
    "finishCheck",
  ])
    current = step(good.model.machine, current, name);
  assert.throws(() => step(good.model.machine, current, "publish"), /Disabled/);
  current = initial(good.model.machine);
  for (const name of [
    "answerRule",
    "parseField",
    "preview",
    "apply",
    "startCheck",
    "edit",
    "parseField",
    "preview",
    "apply",
    "finishCheck",
  ])
    current = step(good.model.machine, current, name);
  assert.equal(current.checkedComplete, true);
  assert.notEqual(current.checkedVersion, current.version);
  assert.throws(() => step(good.model.machine, current, "publish"), /Disabled/);
  for (const name of ["startCheck", "finishCheck", "publish"])
    current = step(good.model.machine, current, name);
  assert.equal(current.published, true);
  assert.equal(current.checkedVersion, current.version);
});
