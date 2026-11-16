// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { architectureHeadings } from "../dist/architecture/headings.js";
test("heading scopes include descendants and fences close only with a sufficient matching marker", () => {
  const text =
    "## Parent\n### Child\nContent\n````md\n# Fake\n```\n# Still fake\n````\n## Sibling\nOther";
  const headings = architectureHeadings(text);
  assert.deepEqual(
    headings.map((h) => h.title),
    ["Parent", "Child", "Sibling"],
  );
  assert.match(headings[0].text, /Content/);
  assert.doesNotMatch(headings[0].text, /Other/);
});
test("explicit anchors and stable requirement keys are extracted independently of display titles", () => {
  const headings = architectureHeadings(
    '<a id="api-contract"></a>\n## API result\nText\n## R03 Keep writes {#durability}\nText',
  );
  assert.equal(headings[0].anchor, "api-contract");
  assert.equal(headings[1].title, "R03 Keep writes");
  assert.equal(headings[1].key, "R03");
  assert.equal(headings[1].anchor, "durability");
});

test("heading identifiers preserve complete child suffixes and custom prefixes", () => {
  const headings = architectureHeadings(
    "## R03 Parent\n### R03-NORMAL Normal\n### R03-SESSION-ATTEMPT Session\n## NFR-7 Latency\n",
  );
  assert.deepEqual(
    headings.map((h) => h.key),
    ["R03", "R03-NORMAL", "R03-SESSION-ATTEMPT", "NFR-7"],
  );
});
