import test from "node:test";
import assert from "node:assert/strict";
import { indexArchitecture } from "../dist/architecture/model.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import {
  openArchitectureWork,
  newlyBrokenAuthoredLinks,
} from "../dist/architecture/work.js";
import {
  withNativeDocuments,
  mergeArchitectureImport,
} from "../dist/architecture/import-merge.js";
const catalogue = (functions, types = {}) => ({
  path: "catalogue.json",
  text: JSON.stringify({
    functions: functions.map((f) => ({ owner: "api", ...f })),
    types,
  }),
});
const plans = (path, items) => ({
  path,
  text: JSON.stringify({ schema: "pymtheg.plan/v1", items }),
});
test("error alternatives are preserved data, not invented type references", () => {
  const doc = catalogue(
    [
      {
        id: "send",
        name: "send",
        args: { input: "Digest" },
        returns: "Receipt",
        errors: ["QuotaExceeded"],
        allowedErrors: ["Unavailable"],
      },
    ],
    { Digest: { fields: { value: "String" } } },
  );
  const index = indexArchitecture([doc]);
  assert.ok(
    index.edges.some((e) => e.targetName === "Digest" && !e.unresolved),
  );
  assert.ok(
    index.edges.some((e) => e.targetName === "Receipt" && e.unresolved),
  );
  assert.ok(
    !index.edges.some((e) =>
      ["QuotaExceeded", "Unavailable"].includes(e.targetName),
    ),
  );
  assert.match(doc.text, /QuotaExceeded/);
  assert.ok(index.warnings.some((w) => /coverage is incomplete/.test(w)));
});
test("one genuine native link leads a large imported mapping backlog", () => {
  const imported = mergeArchitectureImport(
    [],
    [
      catalogue(
        Array.from({ length: 2000 }, (_, i) => ({
          id: `f${i}`,
          name: `f${i}`,
          args: {},
          returns: `Missing${i}`,
        })),
      ),
    ],
    { id: "source", label: "API", kind: "upload" },
    "add",
  ).documents;
  const documents = withNativeDocuments(
    [
      ...imported,
      plans("architecture/plan.json", [
        {
          ...newPlanItem("R1"),
          title: "Native requirement",
          acceptance: "observable",
          links: [{ kind: "depends-on", target: "missing-target" }],
        },
      ]),
    ],
    ["architecture/plan.json"],
  );
  const index = indexArchitecture(documents);
  const issues = openArchitectureWork(index, new Map(), documents);
  assert.equal(issues.length, 2001);
  assert.equal(issues[0].id, "plan:R1");
  assert.equal(issues[0].origin, "authored");
  assert.equal(issues[0].kind, "broken-link");
  assert.ok(
    issues
      .slice(1)
      .every((i) => i.origin === "imported" && i.kind === "unresolved-type"),
  );
});
test("import preview separates newly broken native links from existing or imported gaps", () => {
  const native = plans("architecture/plan.json", [
    {
      ...newPlanItem("R1"),
      title: "Retain capture",
      links: [{ kind: "depends-on", target: "function:capture" }],
    },
    {
      ...newPlanItem("R2"),
      title: "Old gap",
      links: [{ kind: "depends-on", target: "already-missing" }],
    },
  ]);
  const beforeDocs = withNativeDocuments(
    [native, catalogue([{ id: "capture", name: "capture", returns: "Unit" }])],
    ["architecture/plan.json"],
  );
  const afterDocs = withNativeDocuments(
    [
      native,
      catalogue([{ id: "other", name: "other", returns: "UnknownType" }]),
    ],
    ["architecture/plan.json"],
  );
  const before = indexArchitecture(beforeDocs),
    after = indexArchitecture(afterDocs);
  assert.deepEqual(newlyBrokenAuthoredLinks(before, after, afterDocs), [
    { id: "plan:R1", name: "Retain capture", target: "function:capture" },
  ]);
});
