// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { indexArchitecture } from "../dist/architecture/model.js";
import { prepareHeadingIdentities } from "../dist/architecture/heading-identities.js";
const doc = (text) => ({ path: "REQ.md", text }),
  headings = (docs) =>
    indexArchitecture(docs).entities.filter((e) => e.kind === "heading");
test("inserting an earlier duplicate title cannot steal an existing section identity", () => {
  const old = [doc("## Notes\nExisting meaning\n")],
    id = headings(old)[0].id;
  const next = prepareHeadingIdentities(old, [
    doc("## Notes\nUnrelated new meaning\n## Notes\nExisting meaning\n"),
  ]);
  const all = headings(next);
  assert.equal(all.find((e) => e.summary.includes("Existing meaning")).id, id);
  assert.notEqual(
    all.find((e) => e.summary.includes("Unrelated new meaning")).id,
    id,
  );
});
test("stable requirement keys and explicitly anchored renames retain IDs", () => {
  const old = [
      doc(
        "## R03 Keep writes\nOriginal rule\n## Notes {#rationale}\nUnique explanation\n",
      ),
    ],
    ids = headings(old);
  const next = prepareHeadingIdentities(old, [
    doc(
      "## R03 Keep accepted writes\nChanged rule\n## Rationale {#rationale}\nUnique explanation\n",
    ),
  ]);
  const updated = headings(next);
  assert.equal(updated[0].id, ids[0].id);
  assert.equal(updated[1].id, ids[1].id);
  assert.notEqual(updated[0].contentHash, ids[0].contentHash);
});
test("ambiguous changed duplicates do not get rebound by their ordinal positions", () => {
  const old = [doc("## Notes\nFirst\n## Notes\nSecond\n")],
    ids = new Set(headings(old).map((e) => e.id));
  const next = prepareHeadingIdentities(old, [
    doc("## Notes\nChanged one\n## Notes\nChanged two\n"),
  ]);
  assert.ok(headings(next).every((e) => !ids.has(e.id)));
});
test("removed section identities are not silently reused after a later insertion", () => {
  const first = prepareHeadingIdentities(
      [],
      [doc("## Notes\nOriginal meaning\n")],
    ),
    old = headings(first)[0].id;
  const removed = prepareHeadingIdentities(first, [
    doc("No headings remain\n"),
  ]);
  const replacement = prepareHeadingIdentities(removed, [
    doc("## Notes\nUnrelated replacement\n"),
  ]);
  assert.notEqual(headings(replacement)[0].id, old);
});

test("placeholder body text cannot transfer a link to a differently named concept", () => {
  const old = [doc("## Caching\nTBD\n")],
    id = headings(old)[0].id;
  const next = prepareHeadingIdentities(old, [doc("## Authentication\nTBD\n")]);
  assert.notEqual(headings(next)[0].id, id);
});
test("custom whole requirement identifiers preserve identity through title and body edits", () => {
  const old = [doc("## NFR-7 Latency\nOld rule\n")],
    id = headings(old)[0].id;
  const next = prepareHeadingIdentities(old, [
    doc("## NFR-7 Response budget\nNew rule\n"),
  ]);
  assert.equal(headings(next)[0].id, id);
});

test("copied long body text cannot silently retarget a heading link", () => {
  const text =
    "This detailed text is a copied template, not evidence of an unchanged decision.\n";
  const old = [doc("## Caching\n" + text)],
    id = headings(old)[0].id;
  const next = prepareHeadingIdentities(old, [
    doc("## Authentication\n" + text),
  ]);
  assert.notEqual(headings(next)[0].id, id);
});

test("one refresh moving a document and replacing its old path keeps links on original content", () => {
  for (const anchor of ["", " {#backups}"]) {
    const original = {
      path: "ops.md",
      text: `## Backups${anchor}\nKeep daily backups.\n`,
    };
    const first = prepareHeadingIdentities([], [original]);
    const id = headings(first)[0].id;
    for (const next of [
      [
        { ...original, path: "legacy/ops.md" },
        {
          path: "ops.md",
          text: `## Backups${anchor}\nNo backups; rely on replicas.\n`,
        },
      ],
      [
        {
          path: "ops.md",
          text: `## Backups${anchor}\nNo backups; rely on replicas.\n`,
        },
        { ...original, path: "legacy/ops.md" },
      ],
    ]) {
      const updated = headings(prepareHeadingIdentities(first, next));
      assert.equal(updated.find((e) => e.document === "legacy/ops.md").id, id);
      assert.notEqual(updated.find((e) => e.document === "ops.md").id, id);
      assert.equal(new Set(updated.map((e) => e.id)).size, 2);
    }
  }
});

test("edited moves and ambiguous copies cannot rebind a link to a replacement at the old path", () => {
  const original = {
    path: "ops.md",
    text: "# Ops\n## Backups\nnightly full backup kept 30 days\n",
  };
  const before = prepareHeadingIdentities([], [original]);
  const target = headings(before).find((h) => h.name === "Backups").id;
  for (const copies of [
    [
      {
        path: "legacy/ops.md",
        text: original.text.replace("# Ops", "# Ops (archived)"),
      },
    ],
    [
      { path: "legacy/ops.md", text: original.text },
      { path: "archive/ops.md", text: original.text },
    ],
  ]) {
    const next = prepareHeadingIdentities(before, [
      {
        path: "ops.md",
        text: "# Ops\n## Backups\nno backups; rely on replicas\n",
      },
      ...copies,
    ]);
    const index = indexArchitecture(next);
    assert.ok(!index.entities.some((e) => e.id === target));
    assert.ok(
      index.warnings.some(
        (w) => /possible move/i.test(w) && w.includes("legacy/ops.md"),
      ),
    );
  }
});

test("edited file moves offer candidates when the old path disappears or gets replaced", () => {
  const original = {
    path: "ops.md",
    text: "# Operations\n## Backups\nKeep backups 30 days.\n## Restore\nExercise recovery monthly.\n",
  };
  const before = prepareHeadingIdentities([], [original]);
  const target = headings(before).find((h) => h.name === "Backups").id;
  for (const replacement of [false, true]) {
    const documents = [
      {
        path: "legacy/ops.md",
        text: original.text
          .replace("# Operations", "# Archived operations")
          .replace("30 days", "31 days"),
      },
    ];
    if (replacement)
      documents.push({
        path: "ops.md",
        text: "# Operations\n## Backups\nNo backups; rely on replicas.\n",
      });
    const index = indexArchitecture(
      prepareHeadingIdentities(before, documents),
    );
    assert.ok(!index.entities.some((e) => e.id === target));
    assert.ok(
      index.warnings.some(
        (w) => /Possible move.*Backups/.test(w) && w.includes("legacy/ops.md"),
      ),
      JSON.stringify(index.warnings),
    );
  }
});

test("edited-move suggestions remain available after a later unrelated save", () => {
  const original = {
    path: "ops.md",
    text: "## Backups\nKeep backups 30 days.\n",
  };
  const before = prepareHeadingIdentities([], [original]);
  const moved = prepareHeadingIdentities(before, [
    { path: "legacy/ops.md", text: "## Backups\nKeep backups 31 days.\n" },
  ]);
  assert.ok(
    indexArchitecture(moved).warnings.some((w) =>
      /Possible move.*Backups/.test(w),
    ),
  );
  const after = prepareHeadingIdentities(moved, [
    ...moved,
    { path: "unrelated.md", text: "## Other\nUnrelated decision.\n" },
  ]);
  assert.ok(
    indexArchitecture(after).warnings.some((w) =>
      /Possible move.*Backups/.test(w),
    ),
    "Repair candidates must outlive the original import preview",
  );
});

test("explicit plan link repair clears its retained move suggestion", async () => {
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const original = {
    path: "ops.md",
    text: "## Backups\nKeep backups 30 days.\n",
  };
  const seed = prepareHeadingIdentities([], [original]);
  const id = headings(seed)[0].id;
  const plan = {
    ...newPlanItem("R1"),
    title: "Backup policy",
    links: [{ kind: "depends-on", target: id }],
  };
  const doc = (item) => ({
    path: "architecture/plan.json",
    text: JSON.stringify({ schema: "pymtheg.plan/v1", items: [item] }),
  });
  const before = prepareHeadingIdentities(seed, [...seed, doc(plan)]);
  const moved = prepareHeadingIdentities(before, [
    { path: "legacy/ops.md", text: "## Backups\nKeep backups 31 days.\n" },
    doc(plan),
  ]);
  assert.ok(
    indexArchitecture(moved).warnings.some((w) =>
      /Possible move.*Backups/.test(w),
    ),
  );
  const target = headings(moved).find((h) => h.name === "Backups").id;
  const repaired = prepareHeadingIdentities(moved, [
    ...moved.filter((d) => d.path !== "architecture/plan.json"),
    doc({ ...plan, links: [{ kind: "depends-on", target }] }),
  ]);
  assert.ok(
    !indexArchitecture(repaired).warnings.some((w) =>
      /Possible move.*Backups/.test(w),
    ),
  );
});
