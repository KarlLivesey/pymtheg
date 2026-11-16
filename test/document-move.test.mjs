// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareHeadingIdentities,
  identifiedHeadings,
} from "../dist/architecture/heading-identities.js";
const doc = (path, text) => ({ path, text });
test("a unique unchanged document move keeps its heading target; copies and ambiguous moves do not", () => {
  const text = "## R01 Durable acknowledgement\nSync before reply.\n";
  const original = prepareHeadingIdentities([], [doc("old.md", text)]);
  const before = identifiedHeadings(original).headings.get("old.md")[0].id;
  const moved = prepareHeadingIdentities(original, [
    doc("folder/new.md", text),
  ]);
  assert.equal(
    identifiedHeadings(moved).headings.get("folder/new.md")[0].id,
    before,
  );
  const copied = prepareHeadingIdentities(original, [
    doc("old.md", text),
    doc("copy.md", text),
  ]);
  assert.notEqual(
    identifiedHeadings(copied).headings.get("copy.md")[0].id,
    before,
  );
  const ambiguous = prepareHeadingIdentities(original, [
    doc("one.md", text),
    doc("two.md", text),
  ]);
  for (const path of ["one.md", "two.md"])
    assert.notEqual(
      identifiedHeadings(ambiguous).headings.get(path)[0].id,
      before,
    );
  const edited = prepareHeadingIdentities(original, [
    doc("folder/new.md", text + "Changed.\n"),
  ]);
  assert.notEqual(
    identifiedHeadings(edited).headings.get("folder/new.md")[0].id,
    before,
  );
});

test("reusing a moved file's old path keeps the old target and gives the new target a readable distinct ID", () => {
  const text = "## R01 Durable acknowledgement\nSync before reply.\n";
  const original = prepareHeadingIdentities([], [doc("old.md", text)]);
  const prior = identifiedHeadings(original).headings.get("old.md")[0].id;
  const moved = prepareHeadingIdentities(original, [
    doc("folder/new.md", text),
  ]);
  const reused = prepareHeadingIdentities(moved, [
    doc("folder/new.md", text),
    doc("old.md", "## R01 Durable acknowledgement\nNew unrelated decision.\n"),
  ]);
  const headings = identifiedHeadings(reused).headings;
  assert.equal(headings.get("folder/new.md")[0].id, prior);
  const fresh = headings.get("old.md")[0].id;
  assert.notEqual(fresh, prior);
  assert.match(fresh, /^heading:old\.md#r01-durable-acknowledgement~/);
});
