// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { codeDifference } from "../dist/implementation/code-difference.js";

test("finds a late edit after ten thousand unchanged lines with bounded work", () => {
  const prefix = "unchanged\n".repeat(10000);
  const diff = codeDifference(prefix + "close();", prefix + "retry();");
  assert.deepEqual(
    diff.entries.filter((r) => r.kind !== "context"),
    [
      { kind: "removed", text: "close();", beforeLine: 10001, afterLine: null },
      { kind: "added", text: "retry();", beforeLine: null, afterLine: 10001 },
    ],
  );
  assert.equal(diff.complete, true);
  assert.ok(diff.cells <= 40000);
  assert.ok(diff.comparisons <= 10002);
});

test("line-ending normalization is explicit even alongside a real edit", () => {
  const diff = codeDifference(
    "open();\r\nretry(3);\r\nclose();",
    "open();\nretry(0);\nclose();",
  );
  assert.equal(diff.lineEndingsNormalized, true);
  assert.equal(diff.lineEndingsDiffer, false);
  assert.deepEqual(
    diff.entries.filter((r) => r.kind !== "context").map((r) => r.text),
    ["retry(3);", "retry(0);"],
  );
  assert.equal(codeDifference("a\r\n", "a\n").lineEndingsDiffer, true);
  assert.equal(codeDifference("a", "a").equal, true);
});

test("wide changes and enormous context cannot overrun display or split Unicode", () => {
  const diff = codeDifference("a\n".repeat(10000), "b\n".repeat(10000));
  assert.equal(diff.complete, false);
  assert.equal(diff.coarse, true);
  assert.equal(diff.omittedBeforeLines, 9700);
  assert.equal(diff.omittedAfterLines, 9700);
  assert.ok(diff.cells <= 40000);
  const unicode = "😀".repeat(20000);
  const wide = codeDifference(unicode + "\na", unicode + "\nb");
  assert.equal(wide.complete, false);
  assert.ok(wide.entries.reduce((n, r) => n + r.text.length, 0) <= 24000);
  for (const row of wide.entries)
    assert.doesNotMatch(row.text, /[\uD800-\uDBFF]$/);
  assert.throws(() => codeDifference("a", "b", { maxCells: 1e8 }));
});

test("giant unchanged context never hides the actual edit", () => {
  const context = "😀".repeat(25000);
  const diff = codeDifference(context + "\na", context + "\nb");
  assert.equal(diff.complete, false);
  assert.deepEqual(
    diff.entries
      .filter((row) => row.kind !== "context")
      .map((row) => [row.kind, row.text]),
    [
      ["removed", "a"],
      ["added", "b"],
    ],
  );
  assert.ok(
    diff.entries.find((row) => row.kind === "context").text.length <= 500,
  );
});
