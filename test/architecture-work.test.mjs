import test from "node:test";
import assert from "node:assert/strict";
import { indexArchitecture } from "../dist/architecture/model.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { openArchitectureWork } from "../dist/architecture/work.js";
test("open work distinguishes absent criteria, evidence without scope, and an actual changed reviewed contract", () => {
  const contract = (value) => ({
    path: "api.json",
    text: JSON.stringify({
      types: {},
      functions: [{ id: "f", name: "f", owner: "a", args: {}, returns: value }],
    }),
  });
  const prior = indexArchitecture([contract("Unit")]);
  const reviewed = {
    ...newPlanItem("Review"),
    title: "Review API",
    owner: "a",
    status: "reviewed",
    acceptance: "Expected result",
    evidence: "Review report",
    evidenceRevision: prior.id,
    links: [{ kind: "supports", target: "function:f" }],
  };
  const plans = (items) => ({
    path: "plan.json",
    text: JSON.stringify({ schema: "pymtheg.plan/v1", items }),
  });
  const stable = indexArchitecture([contract("Unit"), plans([reviewed])]);
  assert.deepEqual(
    openArchitectureWork(stable, new Map([[prior.id, prior]])),
    [],
  );
  const changed = indexArchitecture([
    contract("String"),
    plans([
      reviewed,
      { ...newPlanItem("R2"), title: "Incomplete", owner: "a" },
      { ...reviewed, id: "unscoped", links: [] },
    ]),
  ]);
  const issues = openArchitectureWork(changed, new Map([[prior.id, prior]]));
  assert.ok(
    issues.some((i) => i.id === "plan:Review" && i.kind === "stale-evidence"),
  );
  assert.ok(
    issues.some((i) => i.id === "plan:R2" && i.kind === "missing-criteria"),
  );
  assert.ok(
    issues.some(
      (i) => i.id === "plan:unscoped" && i.kind === "unscoped-evidence",
    ),
  );
});

test("repeated relations to one changed target produce one evidence reminder", () => {
  const doc = (value) => ({
    path: "api.json",
    text: JSON.stringify({
      types: {},
      functions: [{ id: "f", name: "f", owner: "a", args: {}, returns: value }],
    }),
  });
  const prior = indexArchitecture([doc("Unit")]);
  const item = {
    ...newPlanItem("Review"),
    title: "Review API",
    owner: "a",
    status: "reviewed",
    acceptance: "Expected result",
    evidence: "Review report",
    evidenceRevision: prior.id,
    links: [
      { kind: "supports", target: "function:f" },
      { kind: "tests", target: "function:f" },
    ],
  };
  const now = indexArchitecture([
    doc("Nat"),
    {
      path: "plan.json",
      text: JSON.stringify({ schema: "pymtheg.plan/v1", items: [item] }),
    },
  ]);
  const issues = openArchitectureWork(now, new Map([[prior.id, prior]]));
  assert.equal(issues.filter((i) => i.kind === "stale-evidence").length, 1);
  assert.match(issues.find((i) => i.kind === "stale-evidence").message, /f/);
});
