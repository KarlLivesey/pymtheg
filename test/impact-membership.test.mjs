// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  indexArchitecture,
  architectureImpact,
} from "../dist/architecture/model.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("planning-heavy impact lists every consumer exactly once", () => {
  const count = 2000;
  const index = indexArchitecture([
    {
      path: "api.json",
      text: JSON.stringify({
        functions: [],
        types: { Root: { number: 12, fields: "" } },
      }),
    },
    {
      path: "plan.json",
      text: JSON.stringify({
        schema: "pymtheg.plan/v1",
        items: Array.from({ length: count }, (_, i) => ({
          ...newPlanItem("R" + i),
          title: "Requirement " + i,
          links: [{ kind: "depends-on", target: "type:12" }],
        })),
      }),
    },
  ]);
  const impact = architectureImpact(index, "type:12");
  assert.equal(impact.planning.length, count);
  assert.deepEqual(
    new Set(impact.planning),
    new Set(Array.from({ length: count }, (_, i) => "plan:R" + i)),
  );
  assert.deepEqual(impact.direct, []);
  assert.deepEqual(impact.transitive, []);
});
