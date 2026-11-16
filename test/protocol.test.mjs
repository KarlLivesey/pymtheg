// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { compileFlow, flowGraph } from "../dist/behaviour/flow.js";
import { resolve } from "node:path";
const { ir } = analyseFile(resolve("examples/mvp/task-protocol.pym"));
test("a linked provider makes lost acknowledgement and retry duplicate real work", () => {
  assert.deepEqual(
    ir.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  const graph = flowGraph(compileFlow(ir, "retryJob"));
  assert.ok(graph.states.some((s) => s.error?.code === "environment"));
  for (const operation of [
    "send submit",
    "Queue.perform",
    "Queue.loseAck",
    "send response",
  ])
    assert.ok(
      graph.edges.some((e) => e.operation === operation),
      operation,
    );
  const safe = flowGraph(compileFlow(ir, "cautiousJob"));
  assert.ok(safe.states.some((s) => s.status === "returned"));
  assert.equal(
    safe.states.some((s) => s.error),
    false,
  );
});
test("cancellation retains in-flight provider work instead of undoing it", () => {
  const graph = flowGraph(compileFlow(ir, "cautiousJob"));
  const edges = graph.edges.filter((e) => e.operation === "Queue.perform");
  assert.ok(edges.some((e) => graph.states[e.from].status === "cancelled"));
  assert.throws(
    () =>
      compileFlow(ir, "retryJob", {
        results: { send: [{ tag: "Ok", value: null }] },
      }),
    /cannot be replaced/,
  );
});
