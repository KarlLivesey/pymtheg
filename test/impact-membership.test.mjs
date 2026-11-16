// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  indexArchitecture,
  architectureImpact,
} from "../dist/architecture/model.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("planning-heavy impact preserves every consumer without quadratic membership scans", () => {
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
  let lookupSlots = 0;
  const positions = new WeakMap(),
    original = Array.prototype.includes;
  Array.prototype.includes = function (value, ...rest) {
    if (
      this.length === count &&
      typeof this[0] === "string" &&
      this[0].startsWith("plan:")
    ) {
      let map = positions.get(this);
      if (!map) {
        map = new Map(this.map((v, i) => [v, i]));
        positions.set(this, map);
      }
      lookupSlots += map.has(value) ? map.get(value) + 1 : this.length;
    }
    return original.call(this, value, ...rest);
  };
  let impact;
  try {
    impact = architectureImpact(index, "type:12");
  } finally {
    Array.prototype.includes = original;
  }
  assert.deepEqual(
    new Set(impact.planning),
    new Set(Array.from({ length: count }, (_, i) => "plan:R" + i)),
  );
  assert.deepEqual(impact.direct, []);
  assert.deepEqual(impact.transitive, []);
  assert.ok(
    lookupSlots <= 10 * count,
    `Planning membership requested ${lookupSlots} sequential lookup slots for ${count} consumers`,
  );
});
