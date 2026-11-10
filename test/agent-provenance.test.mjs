import test from "node:test";
import assert from "node:assert/strict";
import { propertyOutput } from "../dist/mcp/identities.js";

test("agent provenance becomes relative without changing modelled path values", () => {
  const root = "/project";
  const values = {
    file: "/project/customer-data.txt",
    symbolId: "/project/user-value",
  };
  const witness = {
    states: [{ values }],
    events: [
      {
        operation: "step",
        span: { file: "/project/model.pym", start: 0, end: 5 },
      },
    ],
  };
  const result = {
    propertyId: "/project/model.pym#Test/safety",
    analysisKind: "behaviour",
    diagnostics: [],
    witnessOrDerivation: witness,
  };
  const view = propertyOutput(root, result);
  assert.equal(view.propertyId, "model.pym#Test/safety");
  assert.equal(view.witnessOrDerivation.events[0].span.file, "model.pym");
  assert.deepEqual(view.witnessOrDerivation.states[0].values, values);
  assert.equal(
    result.witnessOrDerivation.events[0].span.file,
    "/project/model.pym",
  );
  const copies = propertyOutput(root, {
    ...result,
    analysisKind: "rule-copies",
    witnessOrDerivation: {
      definitions: ["/project/model.pym#a", "/project/model.pym#b"],
    },
  });
  assert.deepEqual(copies.witnessOrDerivation.definitions, [
    "model.pym#a",
    "model.pym#b",
  ]);
});
