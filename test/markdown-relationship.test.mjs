// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { relationshipText } from "../dist/architecture/relationship-text.js";
import { architectureHeadings } from "../dist/architecture/headings.js";
const source =
  "# Ops\n\n## Backups\nKeep `pg_dump` output\nfor thirty days.\n\n```yaml\nbackup:\n  enabled: true\n```\n\n## Restore\nCheck a saved copy.\n";
test("line-ending-only copies of mixed Markdown sections compare equally", () => {
  const before = architectureHeadings(source),
    after = architectureHeadings(source.replaceAll("\n", "\r\n"));
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++)
    assert.equal(
      relationshipText(before[i].text),
      relationshipText(after[i].text),
      before[i].title,
    );
});
test("prose around fenced code can be rewrapped without hiding code or list changes", () => {
  assert.equal(
    relationshipText(source),
    relationshipText(
      source.replace("output\nfor", "output for").replace("days.", "days. \n"),
    ),
  );
  assert.equal(
    relationshipText(source),
    relationshipText(source.replace("days.", "days.   ")),
  );
  assert.notEqual(
    relationshipText(source),
    relationshipText(source.replace("  enabled: true", "enabled: true")),
  );
  assert.notEqual(
    relationshipText("Keep backups\n1. Test restore"),
    relationshipText("Keep backups 1. Test restore"),
  );
  assert.notEqual(
    relationshipText("Keep `a  b`."),
    relationshipText("Keep `a b`."),
  );
});
