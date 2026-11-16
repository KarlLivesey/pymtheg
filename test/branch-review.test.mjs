// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { branchReview } from "../dist/architecture/branches.js";
test("current ancestry is distinct from other branch tips and unknown legacy history", () => {
  const rows = [
    { id: "a", label: "Base", parentId: null },
    { id: "b", label: "Local", parentId: "a" },
    { id: "c", label: "Other machine", parentId: "a" },
    { id: "d", label: "Current", parentId: "b" },
    { id: "e", label: "Legacy" },
  ];
  assert.deepEqual(branchReview(rows, "d"), [
    { id: "c", label: "Other machine", lineage: "recorded", reviewed: false },
    { id: "e", label: "Legacy", lineage: "unknown", reviewed: false },
  ]);
  assert.deepEqual(branchReview(rows.slice(0, 2), "b"), []);
});
