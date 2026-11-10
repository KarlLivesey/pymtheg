import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeArchitectureImport,
  withNativeDocuments,
  sourceRegistry,
} from "../dist/architecture/import-merge.js";
const source = { id: "folder:design", label: "Design folder", kind: "folder" };
const doc = (path, text) => ({ path, text });
test("refreshing one source carries native plans and other sources forward, and removes only owned files", () => {
  let state = mergeArchitectureImport(
    [],
    [doc("a.md", "a"), doc("old.md", "old")],
    source,
    "refresh",
  ).documents;
  state = mergeArchitectureImport(state, [doc("meeting.md", "meeting")], {
    id: "upload:meeting",
    label: "Meeting",
    kind: "upload",
  }).documents;
  state = withNativeDocuments(
    [...state, doc("architecture/plan.json", "native plan")],
    ["architecture/plan.json"],
  );
  const result = mergeArchitectureImport(
    state,
    [doc("a.md", "updated")],
    source,
    "refresh",
  );
  assert.equal(
    result.documents.find((d) => d.path === "architecture/plan.json").text,
    "native plan",
  );
  assert.equal(
    result.documents.find((d) => d.path === "meeting.md").text,
    "meeting",
  );
  assert.deepEqual(result.summary.removed, ["old.md"]);
  assert.ok(!result.documents.some((d) => d.path === "old.md"));
  assert.deepEqual(result.summary.changed, ["a.md"]);
});
test("adding documents never replaces the working architecture or conflicting native content", () => {
  const first = mergeArchitectureImport(
    [],
    [doc("a.md", "original")],
    source,
  ).documents;
  const next = mergeArchitectureImport(first, [doc("meeting.md", "notes")], {
    id: "upload",
    label: "Notes",
    kind: "upload",
  });
  assert.equal(next.documents.find((d) => d.path === "a.md").text, "original");
  assert.throws(
    () =>
      mergeArchitectureImport(
        next.documents,
        [doc("a.md", "different")],
        source,
      ),
    /already exists/,
  );
  const native = withNativeDocuments(
    [...first, doc("architecture/plan.json", "important")],
    ["architecture/plan.json"],
  );
  assert.throws(
    () =>
      mergeArchitectureImport(
        native,
        [doc("architecture/plan.json", "replace")],
        source,
        "refresh",
      ),
    /native planning/,
  );
});
test("source refresh protects local edits and retains provenance and unknown source fields", () => {
  const first = mergeArchitectureImport(
    [],
    [doc("a.md", "source")],
    source,
    "refresh",
  ).documents;
  const edited = first.map((d) =>
    d.path === "a.md" ? doc(d.path, "local edit") : d,
  );
  const unchangedSource = mergeArchitectureImport(
    edited,
    [doc("a.md", "source")],
    source,
    "refresh",
  );
  assert.equal(
    unchangedSource.documents.find((d) => d.path === "a.md").text,
    "local edit",
  );
  assert.deepEqual(unchangedSource.summary.keptLocal, ["a.md"]);
  assert.throws(
    () =>
      mergeArchitectureImport(
        edited,
        [doc("a.md", "source update")],
        source,
        "refresh",
      ),
    /changed both/,
  );
  assert.throws(
    () => mergeArchitectureImport(edited, [], source, "refresh"),
    /edited locally/,
  );
  assert.equal(
    sourceRegistry(unchangedSource.documents).sources[0].documents[0]
      .baselineHash,
    sourceRegistry(first).sources[0].documents[0].baselineHash,
  );
});
