import test from "node:test";
import assert from "node:assert/strict";
import { traceSteps } from "../dist/reporting/trace.js";
test("stutters do not shift source event mappings and integer changes keep precision", () => {
  const span = { file: "model.pym", start: 0, end: 1 };
  const r = {
    witnessOrDerivation: {
      states: [
        { event: -2, values: { n: 9007199254740992n } },
        { event: -1, values: { n: 9007199254740992n } },
        { event: 0, values: { n: 9007199254740993n } },
      ],
      events: [{ operation: "advance", span }],
    },
  };
  const steps = traceSteps(r);
  assert.equal(steps[1].operation, "No enabled event (stutter)");
  assert.deepEqual(steps[1].changes, []);
  assert.equal(steps[2].operation, "advance");
  assert.equal(steps[2].changes[0].after, 9007199254740993n);
  assert.throws(
    () =>
      traceSteps({
        witnessOrDerivation: {
          states: r.witnessOrDerivation.states,
          events: [],
        },
      }),
    /missing a source event/,
  );
});
