// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { fieldChanges, changedText } from "../dist/architecture/diff.js";
test("revision comparisons identify changed fields, additions and the actual edited text region", () => {
  assert.deepEqual(
    fieldChanges(
      { args: { input: "Nat" }, obsolete: true },
      { args: { input: "Int" }, returns: "Unit" },
    ).changes.map((x) => x.path),
    ["/args/input", "/obsolete", "/returns"],
  );
  const diff = changedText("start\nsame\nold\nend", "start\nsame\nnew\nend");
  assert.match(diff.before, /old/);
  assert.match(diff.after, /new/);
  assert.equal(diff.truncated, false);
  const big = fieldChanges(
    { value: "a".repeat(7000) },
    { value: "b".repeat(7000) },
  );
  assert.equal(big.changes[0].truncated, true);
});
