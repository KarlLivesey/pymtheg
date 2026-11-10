import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { guidedShapeLimits } from "../dist/studio/shapes.js";
test("the authoring self-model exposes repeated work and matches the configured shape/chunk budgets", () => {
  const { report } = analyseFile("examples/self/authoring.pym");
  assert.deepEqual(
    report.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  const cost = (owner, metric) =>
    report.results.find((r) =>
      r.propertyId.endsWith(`#${owner}/cost/${metric}`),
    );
  assert.equal(
    cost("repeatedShapes", "form_nodes").witnessOrDerivation.maximum,
    "512000",
  );
  const shared = cost("sharedShapes", "form_nodes");
  assert.equal(shared.completion, "complete");
  assert.equal(
    shared.witnessOrDerivation.maximum,
    String(guidedShapeLimits.perRun),
  );
  assert.equal(
    shared.witnessOrDerivation.bounds.nodes,
    BigInt(guidedShapeLimits.perShape),
  );
  assert.equal(
    cost("metadataChunk", "symbol_records").witnessOrDerivation.maximum,
    String(guidedShapeLimits.metadataChunk),
  );
  assert.ok(
    shared.assumptions.length,
    "Abstract work summaries stay visible assumptions",
  );
});
