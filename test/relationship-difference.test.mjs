import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
import { relationshipDifference } from "../dist/implementation/relationship-difference.js";
const graph = (text) =>
  observeTypescript([{ path: "main.ts", text, hash: hash(text) }], {
    label: "test",
    gitCommit: null,
    dirty: true,
  });
test("actual parser edges count static sites, including a single site inside a loop", () => {
  const a = graph("function send() {} export function run() { send(); }");
  const b = graph(
    "function send() {} export function run() { for(let i=0;i<100;i++) send(); send(); }",
  );
  const id = a.nodes.find((n) => n.name === "run").id;
  const delta = relationshipDifference(a, b, id);
  assert.equal(delta.items.length, 1);
  assert.equal(delta.items[0].target, "send");
  assert.equal(delta.items[0].beforeCount, 1);
  assert.equal(delta.items[0].afterCount, 2);
  assert.equal(delta.coverageComplete, true);
  assert.match(delta.meaning, /not the number of times/);
});
test("relationship changes page deterministically and report unresolved coverage", () => {
  const a = graph("export function run() {}");
  const b = graph("export function run() { zebra(); alpha(); middle(); }");
  const id = a.nodes.find((n) => n.name === "run").id;
  const first = relationshipDifference(a, b, id, 0, 2);
  assert.deepEqual(
    first.items.map((i) => i.target),
    ["alpha", "middle"],
  );
  assert.equal(first.total, 3);
  assert.equal(first.nextOffset, 2);
  const last = relationshipDifference(a, b, id, first.nextOffset, 2);
  assert.deepEqual(
    last.items.map((i) => i.target),
    ["zebra"],
  );
  assert.equal(last.nextOffset, null);
  assert.equal(first.coverageComplete, false);
  assert.throws(() => relationshipDifference(a, b, id, 0, 101));
});
test("pathological relationship names stay within display budget without splitting Unicode", () => {
  const a = graph("export function run() {}"),
    id = a.nodes.find((n) => n.name === "run").id;
  const b = {
    ...a,
    edges: Array.from({ length: 100 }, (_, i) => ({
      from: id,
      to: "id:" + i + "😀".repeat(10000),
      targetName: "😀".repeat(10000) + i,
      kind: "calls",
      resolution: "resolved",
    })),
  };
  const delta = relationshipDifference(a, b, id, 0, 100);
  assert.ok(
    delta.items.reduce(
      (sum, i) => sum + i.target.length + i.targetId.length,
      0,
    ) <= 24000,
  );
  assert.ok(delta.nextOffset > 0);
  assert.ok(delta.nextOffset < 100);
  assert.ok(delta.items.every((i) => i.displayTruncated));
  for (const item of delta.items) {
    assert.doesNotMatch(item.target, /[\uD800-\uDBFF]$/);
    assert.doesNotMatch(item.targetId, /[\uD800-\uDBFF]$/);
  }
});
