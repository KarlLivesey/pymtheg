// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mergeInterfaceEdits } from "../dist/studio/interface-merge.js";
const base = {
  name: "quote",
  inputs: [{ name: "quantity", type: "Nat" }],
  output: "Bool",
  effects: [],
};
test("continued form preserves concurrent parameter edits and saved additions", () => {
  const saved = {
    ...base,
    inputs: [...base.inputs, { name: "urgent", type: "String" }],
  };
  const current = {
    ...base,
    name: "price",
    inputs: [{ name: "quantity", type: "Int" }],
  };
  const merged = mergeInterfaceEdits(base, saved, current);
  assert.deepEqual(merged.unresolved, []);
  assert.equal(merged.edit.name, "price");
  assert.deepEqual(merged.edit.inputs, [
    { name: "quantity", type: "Int" },
    { name: "urgent", type: "String" },
  ]);
});
test("conflicting fields require an explicit choice and never silently prefer saved data", () => {
  const saved = { ...base, inputs: [{ name: "quantity", type: "String" }] },
    current = { ...base, inputs: [{ name: "quantity", type: "Int" }] };
  const pending = mergeInterfaceEdits(base, saved, current);
  assert.equal(pending.unresolved[0].key, "input:quantity");
  assert.equal(pending.edit.inputs[0].type, "Int");
  assert.equal(
    mergeInterfaceEdits(base, saved, current, { "input:quantity": "saved" })
      .edit.inputs[0].type,
    "String",
  );
  assert.equal(
    mergeInterfaceEdits(base, saved, current, { "input:quantity": "current" })
      .unresolved.length,
    0,
  );
});
test("concurrent deletion and saved edits conflict; absent baselines never authorize overwrites", () => {
  const saved = { ...base, inputs: [{ name: "quantity", type: "String" }] },
    current = { ...base, inputs: [] };
  assert.equal(mergeInterfaceEdits(base, saved, current).unresolved.length, 1);
  assert.ok(mergeInterfaceEdits(undefined, saved, current).unresolved.length);
});

test("saved parameter order is semantic and cannot disappear during resume", () => {
  const baseline = {
    ...base,
    inputs: [
      { name: "first", type: "Nat" },
      { name: "second", type: "Bool" },
    ],
  };
  const saved = {
    ...baseline,
    inputs: [baseline.inputs[1], baseline.inputs[0]],
  };
  const current = { ...baseline, name: "price" };
  const merged = mergeInterfaceEdits(baseline, saved, current);
  assert.deepEqual(
    merged.edit.inputs.map((p) => p.name),
    ["second", "first"],
  );
  assert.equal(merged.edit.name, "price");
});
