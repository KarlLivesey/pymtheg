// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { headingIdentifier } from "../dist/architecture/headings.js";
import { prepareHeadingIdentities } from "../dist/architecture/heading-identities.js";
import { indexArchitecture } from "../dist/architecture/model.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("numbered prose is not a declared stable identity, while compact IDs remain supported", () => {
  for (const title of ["Option 1 — WAL", "Step 1 Install", "Chapter 12 Review"])
    assert.equal(headingIdentifier(title), undefined, title);
  for (const [title, id] of [
    ["R03 Identity", "R03"],
    ["R03-NORMAL Normal", "R03-NORMAL"],
    ["NFR-7 Latency", "NFR-7"],
    ["REQ-1 Login", "REQ-1"],
  ])
    assert.equal(headingIdentifier(title), id);
});
test("reordering numbered choices never silently sends an existing link to the other choice", () => {
  for (const anchored of [false, true]) {
    const oldText = `## Option 1 — WAL${anchored ? " {#wal}" : ""}\nfast writes\n## Option 2 — Journal${anchored ? " {#journal}" : ""}\nsimple\n`;
    const document = { path: "options.md", text: oldText };
    const old = indexArchitecture([document]);
    const wal = old.entities.find((e) => e.name === "Option 1 — WAL");
    const plan = {
      path: "plan.json",
      text: JSON.stringify({
        schema: "pymtheg.plan/v1",
        items: [
          {
            ...newPlanItem("D-1"),
            title: "Choose WAL",
            links: [{ kind: "supports", target: wal.id }],
          },
        ],
      }),
    };
    const nextText = `## Option 1 — Journal${anchored ? " {#journal}" : ""}\nsimple\n## Option 2 — WAL${anchored ? " {#wal}" : ""}\nfast writes\n`;
    const next = prepareHeadingIdentities(
      [document, plan],
      [{ path: "options.md", text: nextText }, plan],
    );
    const after = indexArchitecture(next),
      target = after.entities.find((e) => e.id === wal.id),
      link = after.edges.find((e) => e.from === "plan:D-1");
    if (anchored) {
      assert.equal(target.name, "Option 2 — WAL");
      assert.equal(link.unresolved, false);
    } else {
      assert.equal(target, undefined);
      assert.equal(link.unresolved, true);
    }
  }
});
