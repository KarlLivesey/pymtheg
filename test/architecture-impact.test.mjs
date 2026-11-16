// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  indexArchitecture,
  architectureImpact,
} from "../dist/architecture/model.js";
test("type impact resolves named/qualified references and retains direct, transitive and planning consumers separately", () => {
  const catalogue = {
    types: {
      Digest: { number: 12, rustPath: "pg::Digest", fields: "" },
      Envelope: { number: 13, fields: { digest: "Option<pg::Digest>" } },
      Unrelated: { number: 14, fields: { Digest: "String" } },
    },
    functions: [
      {
        id: "hash",
        name: "hash",
        owner: "data",
        args: { bytes: "String" },
        returns: "Digest",
      },
      {
        id: "send",
        name: "send",
        owner: "data",
        args: { box: "Envelope" },
        returns: "Unit",
      },
      {
        id: "workflow",
        name: "workflow",
        owner: "app",
        args: {},
        returns: "Unit",
        calls: ["hash"],
      },
    ],
  };
  const plan = {
    schema: "pymtheg.plan/v1",
    items: [
      {
        id: "R1",
        kind: "requirement",
        title: "Review digest",
        owner: "data",
        status: "proposed",
        detail: "",
        acceptance: "",
        evidence: "",
        evidenceRevision: "",
        links: [{ kind: "depends-on", target: "type:12" }],
      },
    ],
  };
  const index = indexArchitecture([
    { path: "catalogue.json", text: JSON.stringify(catalogue) },
    { path: "plan.json", text: JSON.stringify(plan) },
  ]);
  const impact = architectureImpact(index, "type:12");
  assert.deepEqual(
    new Set(impact.direct),
    new Set(["type:13", "function:hash"]),
  );
  assert.deepEqual(
    new Set(impact.transitive),
    new Set(["function:send", "function:workflow"]),
  );
  assert.deepEqual(impact.planning, ["plan:R1"]);
  assert.ok(
    !index.edges.some((e) => e.from === "type:14" && e.to === "type:12"),
    "field names are not type references",
  );
});
test("ambiguous and unsupported foreign type references stay incomplete rather than claiming no dependencies", () => {
  const index = indexArchitecture([
    {
      path: "api.json",
      text: JSON.stringify({
        types: { Digest: { fields: "" } },
        functions: [
          {
            id: "f",
            name: "f",
            owner: "x",
            args: { x: "Missing<Digest>" },
            returns: 42,
          },
        ],
      }),
    },
  ]);
  assert.ok(index.warnings.some((w) => w.includes("coverage is incomplete")));
  assert.ok(
    index.edges.some((e) => e.targetName === "Missing" && e.unresolved),
  );
  assert.ok(index.edges.some((e) => e.to === "type:Digest"));
});
