// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
import {
  compareImplementation,
  implementationPage,
} from "../dist/implementation/workspace.js";
import { graphPageSchema } from "../dist/implementation/protocol.js";

const observe = (text) =>
  observeTypescript([{ path: "code.ts", text, hash: hash(text) }], {
    label: "Code",
    gitCommit: null,
    dirty: true,
  });
const original = observe("export function perform(): number { return 1; }");
const originalNode = original.nodes.find((n) => n.name === "perform");
function state({
  changedPlan = false,
  unknownPlan = false,
  text = "export function perform(): number { return 1; }",
  covered = true,
  stale = false,
} = {}) {
  const graph = observe(text);
  if (!covered) {
    graph.coverage.declarations = "partial";
    graph.files[0].coverage.declarations = "partial";
  }
  if (stale) graph.staleFiles = ["code.ts"];
  return {
    index: {
      id: "revision",
      entities: [
        {
          id: "plan:R",
          name: "Plan",
          kind: "requirement",
          contentHash: changedPlan ? "new" : "old",
          ...(unknownPlan ? { status: "source-snapshot-incomplete" } : {}),
        },
      ],
      edges: [],
    },
    documents: [],
    graph,
    bindings: [
      {
        planId: "plan:R",
        planHash: "old",
        nodeId: originalNode.id,
        sourceFile: "code.ts",
        declarationHash: originalNode.declarationHash,
        bodyHash: originalNode.bodyHash,
      },
    ],
  };
}

for (const [name, options, expected] of [
  [
    "plan changed and function deleted",
    { changedPlan: true, text: "export const other = 1;" },
    ["missing", "plan-changed"],
  ],
  [
    "incomplete plan and function deleted",
    { unknownPlan: true, text: "export const other = 1;" },
    ["missing", "unknown"],
  ],
  [
    "plan and body both changed",
    {
      changedPlan: true,
      text: "export function perform(): number { return 2; }",
    },
    ["plan-changed", "code-changed"],
  ],
  [
    "incomplete plan and body changed",
    {
      unknownPlan: true,
      text: "export function perform(): number { return 2; }",
    },
    ["unknown", "code-changed"],
  ],
  [
    "plan changed and deletion coverage unknown",
    { changedPlan: true, covered: false, text: "export const other = 1;" },
    ["unknown", "plan-changed"],
  ],
  [
    "plan changed and body replaced with stub",
    {
      changedPlan: true,
      text: 'export function perform(): number { throw new Error("Not implemented"); }',
    },
    ["plan-changed", "code-changed", "fail-fast"],
  ],
  [
    "stale observation and body changed",
    { stale: true, text: "export function perform(): number { return 2; }" },
    ["unknown", "code-changed"],
  ],
])
  test(`simultaneous gap conditions remain visible: ${name}`, () => {
    const current = state(options);
    const row = compareImplementation(current, current)[0];
    assert.deepEqual(row.statuses, expected);
    assert.deepEqual(row.codeLinks[0].statuses, expected);
    assert.equal(row.status, expected[0]);
    const page = implementationPage(current, current, {
      mode: "gaps",
      query: "",
      offset: 0,
      limit: 20,
    });
    const validated = graphPageSchema.parse({
      ...page,
      activeRevision: "revision",
    });
    assert.deepEqual(validated.items[0].statuses, expected);
    for (const condition of expected) assert.equal(page.counts[condition], 1);
    assert.equal(page.total, 1);
    if (expected.includes("missing")) assert.match(row.reason, /absent/);
    if (expected.includes("plan-changed"))
      assert.match(row.reason, /plan changed/);
    if (expected.includes("code-changed"))
      assert.match(row.reason, /code changed/);
  });

test("each link preserves its own conditions and the record aggregates every affected link", () => {
  const current = state({ changedPlan: true, text: "export const other = 1;" });
  current.bindings.push({
    ...current.bindings[0],
    nodeId: "not-covered",
    sourceFile: "outside.ts",
  });
  const row = compareImplementation(current, current)[0];
  assert.deepEqual(row.statuses, ["missing", "unknown", "plan-changed"]);
  assert.deepEqual(row.codeLinks[0].statuses, ["missing", "plan-changed"]);
  assert.deepEqual(row.codeLinks[1].statuses, ["unknown", "plan-changed"]);
});
