import test from "node:test";
import assert from "node:assert/strict";
import { indexArchitecture } from "../dist/architecture/model.js";
test("enum cases are not type references, while explicit payloads and record fields remain references", () => {
  const index = indexArchitecture([
    {
      path: "catalogue.json",
      text: JSON.stringify({
        functions: [],
        types: {
          Choice: { kind: "enum", fields: "Missing | Present(Receipt)" },
          Missing: { kind: "record", fields: { reason: "String" } },
          Receipt: { kind: "record", fields: { ok: "Bool" } },
          Consumer: { kind: "record", fields: { failure: "Missing" } },
        },
      }),
    },
  ]);
  const references = index.edges.filter((e) => e.kind === "uses-type");
  assert.ok(
    !references.some(
      (e) => e.from === "type:Choice" && e.targetName === "Missing",
    ),
  );
  assert.ok(!references.some((e) => e.targetName === "Present"));
  assert.ok(
    references.some(
      (e) =>
        e.from === "type:Choice" && e.to === "type:Receipt" && !e.unresolved,
    ),
  );
  assert.ok(
    references.some(
      (e) =>
        e.from === "type:Consumer" && e.to === "type:Missing" && !e.unresolved,
    ),
  );
});
test("unsupported enum payload notation is a coverage gap, not an invented missing case type", () => {
  const index = indexArchitecture([
    {
      path: "catalogue.json",
      text: JSON.stringify({
        functions: [],
        types: { Choice: { kind: "enum", fields: "Case({ x: Data })" } },
      }),
    },
  ]);
  assert.ok(
    index.warnings.some((w) => w.includes("unsupported enum payload syntax")),
  );
  assert.ok(!index.edges.some((e) => e.targetName === "Case"));
});
