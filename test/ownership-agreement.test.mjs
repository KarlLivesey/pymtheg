import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyseFile } from "../dist/analysis/index.js";
import { compileFlow, flowGraph } from "../dist/behaviour/flow.js";

// The static ownership analysis and flow exploration must reach the same
// verdict on the same flow. Cancellation handler transitions are conditional
// on acquisition and caller ownership (docs/support.md).
const path = (relative) =>
  fileURLToPath(new URL(relative, import.meta.url).href);
const fixture = (name) => path(`fixtures/ownership-agreement/${name}`);

function verdicts(file, flow) {
  const { ir, report } = analyseFile(file);
  assert.deepEqual(
    ir.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  const ownership = report.results.find(
    (r) =>
      r.analysisKind === "ownership-lifecycle" &&
      r.propertyId.endsWith(`#${flow}/ownership`),
  );
  assert.ok(ownership, `ownership result for ${flow}`);
  assert.equal(ownership.completion, "complete");
  const graph = flowGraph(compileFlow(ir, flow));
  const violations = graph.states.filter((s) => s.status === "violated");
  return {
    ownership: ownership.outcome,
    codes: ownership.diagnostics.map((d) => d.code),
    behaviour: violations.length ? "violated" : "safe",
    errors: violations.map((s) => s.error.code),
    graph,
  };
}
function assertAgree(v, expected) {
  assert.equal(
    v.ownership,
    expected === "safe" ? "established" : "counterexample",
  );
  assert.equal(v.behaviour, expected);
}
// Resource states seen in states where cancellation finished.
const cancelledResources = (graph) =>
  graph.states
    .filter((s) => s.status === "cancelled")
    .flatMap((s) => Object.values(s.resources));

test("fulfilment example: cleanup after a settling transfer is not a violation", () => {
  const v = verdicts(path("../examples/workbench/fulfilment.pym"), "prepare");
  assertAgree(v, "safe");
  const cancelled = cancelledResources(v.graph);
  // Cancelled before commit: the handler still releases the owned reservation.
  assert.ok(
    cancelled.some((r) => !r.settled && r.state === "Released"),
    "handler cleanup runs while the reservation is owned",
  );
  // Cancelled after commit: commit settled it and the handler leaves it alone.
  assert.ok(
    cancelled.some((r) => r.settled && r.state === "Active"),
    "handler skips the transferred reservation",
  );
});

test("lock handed to unlock on every exit (restic trial shape) agrees", () => {
  const v = verdicts(fixture("repo-lock.pym"), "job");
  assertAgree(v, "safe");
  const cancelled = cancelledResources(v.graph);
  assert.ok(cancelled.some((r) => !r.settled && r.state === "Released"));
  assert.ok(cancelled.some((r) => r.settled));
});

test("minimal reproductions agree: transferred and borrowed resources", () => {
  assertAgree(verdicts(fixture("take-then-cancel.pym"), "main"), "safe");
  assertAgree(verdicts(fixture("borrow-then-cancel.pym"), "main"), "safe");
});

test("transferred and still-owned resources at one cancellation boundary agree", () => {
  const v = verdicts(fixture("mixed-cancel.pym"), "main");
  assertAgree(v, "safe");
  assert.ok(!v.codes.includes("O003"));
});

test("cleanup of a still-owned resource is still checked by both", () => {
  const v = verdicts(fixture("owned-cleanup-violation.pym"), "main");
  assertAgree(v, "violated");
  assert.ok(v.codes.includes("R002"));
  assert.ok(v.errors.includes("resource"));
});
