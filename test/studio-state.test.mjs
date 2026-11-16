// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mergeRun } from "../dist/studio/state.js";
test("out-of-order run events cannot overwrite newer completion or exceed history limit", () => {
  const completed = { id: "r", sequence: 5, status: "completed" },
    old = { id: "r", sequence: 2, status: "running" };
  assert.deepEqual(mergeRun([completed], old), [completed]);
  let list = [];
  for (let i = 0; i < 20; i++)
    list = mergeRun(list, { id: String(i), sequence: 1, status: "completed" });
  assert.equal(list.length, 10);
  assert.equal(list[0].id, "19");
});
