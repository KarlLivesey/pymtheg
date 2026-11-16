// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import { sourceCatalogue } from "../dist/architecture/source-contracts.js";
import { updateSourceBaselines } from "../dist/architecture/source-baselines.js";
import { sourcePlanningIssues } from "../dist/architecture/source-work.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const file = "/tmp/shared-plan/main.pym";
const capture = (type) =>
  sourceCatalogue(
    typecheck(
      loadProject(file, {
        buffers: {
          [file]: `type Shared = { n: ${type} }; flow a(x: Shared) -> Unit { return unit; } flow b(x: Shared) -> Unit { return unit; }`,
        },
      }),
    ),
    "/tmp/shared-plan",
  );
test("a new link cannot acknowledge an older link sharing a changed dependency", () => {
  const before = capture("Nat"),
    after = capture("String");
  const a = "source:main.pym#a",
    b = "source:main.pym#b";
  const original = {
    ...newPlanItem("P"),
    links: [{ kind: "supports", target: a }],
    ...updateSourceBaselines(undefined, [a], before, null, false),
  };
  const updated = {
    ...original,
    links: [
      { kind: "supports", target: b },
      { kind: "supports", target: a },
    ],
    ...updateSourceBaselines(original, [b, a], after, null, false),
  };
  const issues = sourcePlanningIssues(
    [{ entity: { id: "plan:P" }, record: updated, origin: "authored" }],
    after,
  );
  assert.ok(
    issues.some(
      (i) =>
        i.kind === "changed-target" && i.target === "source:main.pym#Shared",
    ),
  );
  const scoped = sourcePlanningIssues(
    [{ entity: { id: "plan:P" }, record: updated, origin: "authored" }],
    after,
    { inspectedFiles: new Set(["outside.pym"]) },
  );
  assert.equal(scoped.length, 0);
});

test("legacy attribution is recovered only from matching retained contracts; otherwise uncertainty stays visible", () => {
  const before = capture("Nat");
  const a = "source:main.pym#a",
    b = "source:main.pym#b";
  const initial = {
    ...newPlanItem("P"),
    links: [
      { kind: "supports", target: a },
      { kind: "supports", target: b },
    ],
    ...updateSourceBaselines(undefined, [a, b], before, null, false),
  };
  const { sourceRoots, ...legacy } = initial;
  const recovered = updateSourceBaselines(legacy, [a], null, before, false);
  assert.equal(recovered.sourceRoots[a].precise, true);
  assert.equal(recovered.sourceExpectations[b], undefined);
  const uncertain = updateSourceBaselines(legacy, [a], null, null, false);
  assert.equal(uncertain.sourceRoots[a].precise, false);
  assert.equal(uncertain.sourceExpectations[a], legacy.sourceExpectations[a]);
  const record = {
    ...legacy,
    links: [{ kind: "supports", target: a }],
    ...uncertain,
  };
  assert.ok(
    sourcePlanningIssues(
      [{ entity: { id: "plan:P" }, record, origin: "authored" }],
      before,
    ).some(
      (i) =>
        i.kind === "unknown-link-review" &&
        i.message.includes("conservative dependency attribution"),
    ),
  );
});
