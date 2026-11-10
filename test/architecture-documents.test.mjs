import test from "node:test";
import assert from "node:assert/strict";
import {
  indexArchitecture,
  architectureDetail,
} from "../dist/architecture/model.js";
import { resolveArchitectureTarget } from "../dist/architecture/planning.js";
test("Markdown headings are linkable and fenced examples do not manufacture requirements", () => {
  const doc = {
    path: "requirements.md",
    text: "# Requirements\n\n## R03 Durable plans\nKeep accepted data.\n\n```md\n# R99 Fake\n```\n## R04 Review\nReview each change.\n",
  };
  const index = indexArchitecture([doc]);
  assert.ok(index.entities.some((e) => e.id === "document:requirements.md"));
  assert.ok(!index.entities.some((e) => e.key === "R99"));
  const target = resolveArchitectureTarget(index.entities, "R03");
  assert.equal(target.ok, true);
  const heading = index.entities.find((e) => e.id === target.id);
  assert.equal(heading.kind, "heading");
  assert.match(architectureDetail(doc, heading.pointer), /Keep accepted data/);
  assert.equal(resolveArchitectureTarget(index.entities, "nonsense").ok, false);
  assert.ok(
    index.edges.some(
      (e) => e.from === heading.id && e.to === "document:requirements.md",
    ),
  );
});
test("catalogue routes, review targets and replication command evaluators are navigable dependencies", () => {
  const catalogue = {
    functions: [
      {
        id: "service.handle",
        name: "handle",
        owner: "service",
        args: {},
        returns: "Unit",
      },
    ],
    types: {},
    publicRoutes: { Get: { callees: ["service.handle"] } },
    replicatedCommands: { "service.handle": { evaluator: "service.handle" } },
    reviewFindings: [{ id: "Audit-1", targets: ["R03"], status: "open" }],
    profiles: { pure: { signature: "sync" } },
    releaseState: "unpublished",
  };
  const index = indexArchitecture([
    { path: "catalogue.json", text: JSON.stringify(catalogue) },
    { path: "requirements.md", text: "## R03 Safe reads\nValidate the scope." },
  ]);
  assert.ok(index.entities.some((e) => e.kind === "route"));
  assert.ok(index.entities.some((e) => e.kind === "profile"));
  assert.ok(index.entities.some((e) => e.kind === "release"));
  assert.ok(
    index.edges.some(
      (e) =>
        e.from === "route:publicRoutes:Get" &&
        e.to === "function:service.handle",
    ),
  );
  assert.ok(
    index.edges.some(
      (e) =>
        e.from === "review:Audit-1" &&
        e.to === "heading:requirements.md#r03-safe-reads" &&
        !e.unresolved,
    ),
  );
});
