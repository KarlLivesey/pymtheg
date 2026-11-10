import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeArchitectureImport,
  sourceRegistry,
} from "../dist/architecture/import-merge.js";
const source = { id: "requirements", label: "Requirements", kind: "upload" };
const incoming = (text) => [{ path: "design.md", text }];
test("keep-both follows the upstream copy on later refreshes without promoting local text to native planning", () => {
  const original = mergeArchitectureImport(
    [],
    incoming("v1"),
    source,
  ).documents;
  const current = original.map((d) =>
    d.path === "design.md" ? { ...d, text: "my local changes" } : d,
  );
  const conflict = mergeArchitectureImport(
    current,
    incoming("v2"),
    source,
    "refresh",
    { collectConflicts: true },
  ).conflicts[0];
  const both = mergeArchitectureImport(
    current,
    incoming("v2"),
    source,
    "refresh",
    {
      resolutions: [
        {
          path: conflict.path,
          localHash: conflict.localHash,
          incomingHash: conflict.incomingHash,
          choice: "keep-both",
        },
      ],
    },
  );
  const copy = both.documents.find((d) => d.path.startsWith("imports/"));
  assert.ok(copy);
  const same = mergeArchitectureImport(
    both.documents,
    incoming("v2"),
    source,
    "refresh",
    { collectConflicts: true },
  );
  assert.deepEqual(same.conflicts, []);
  assert.deepEqual(same.summary.removed, []);
  assert.equal(same.documents.find((d) => d.path === copy.path).text, "v2");
  const next = mergeArchitectureImport(
    same.documents,
    incoming("v3"),
    source,
    "refresh",
    { collectConflicts: true },
  );
  assert.deepEqual(next.conflicts, []);
  assert.equal(next.documents.find((d) => d.path === copy.path).text, "v3");
  assert.equal(
    next.documents.find((d) => d.path === "design.md").text,
    "my local changes",
  );
  assert.ok(
    !sourceRegistry(next.documents).nativeDocuments.includes("design.md"),
  );
  const localCopyEdit = next.documents.map((d) =>
    d.path === copy.path ? { ...d, text: "edit on tracked copy" } : d,
  );
  const latest = mergeArchitectureImport(
    localCopyEdit,
    incoming("v4"),
    source,
    "refresh",
    { collectConflicts: true },
  );
  assert.ok(latest.conflicts[0].choices.includes("take-incoming"));
});
