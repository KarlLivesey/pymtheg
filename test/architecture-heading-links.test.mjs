import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const signal = new AbortController().signal,
  source = { id: "requirements", label: "Requirements", kind: "upload" },
  doc = (text) => ({ path: "REQ.md", text }),
  plan = (target) => ({
    ...newPlanItem("D1"),
    kind: "decision",
    title: "Follow this section",
    owner: "design",
    links: [{ kind: "depends-on", target }],
  });
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-stable-headings-")),
    app = new StudioService(root);
  try {
    await run(app);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}
test("an earlier same-title insertion cannot retarget an existing planning link", () =>
  fixture(async (app) => {
    const initial = await app.importArchitecture(
        "Initial",
        [doc("## Notes\nExisting meaning\n")],
        signal,
        { source, mode: "add" },
      ),
      id = initial.entities.find((e) => e.kind === "heading").id;
    await app.savePlanItem(initial.id, plan(id), "Link", signal);
    const changed = await app.importArchitecture(
      "Insert earlier section",
      [doc("## Notes\nNEW unrelated notes\n## Notes\nExisting meaning\n")],
      signal,
      { source, mode: "refresh" },
    );
    assert.match(
      (await app.architectureRecord(changed.id, id)).data,
      /Existing meaning/,
    );
    assert.doesNotMatch(
      (await app.architectureRecord(changed.id, id)).data,
      /NEW unrelated/,
    );
    assert.ok(
      changed.edges.some(
        (e) => e.from === "plan:D1" && e.to === id && !e.unresolved,
      ),
    );
  }));
test("renaming a requirement or a uniquely matched section preserves its planning link", () =>
  fixture(async (app) => {
    const initial = await app.importArchitecture(
        "Initial",
        [doc("## R03 Keep writes\nOriginal rule\n")],
        signal,
        { source, mode: "add" },
      ),
      id = initial.entities.find((e) => e.kind === "heading").id;
    await app.savePlanItem(initial.id, plan(id), "Link", signal);
    const changed = await app.importArchitecture(
      "Rename requirement",
      [doc("## R03 Keep accepted writes\nA clearer rule\n")],
      signal,
      { source, mode: "refresh" },
    );
    assert.equal(changed.entities.find((e) => e.key === "R03").id, id);
    assert.ok(changed.edges.some((e) => e.from === "plan:D1" && !e.unresolved));
  }));
test("ambiguous replacements and removed-then-readded sections cannot steal old links", () =>
  fixture(async (app) => {
    const initial = await app.importArchitecture(
        "Initial",
        [doc("## Notes\nOriginal\n"), { path: "keep.md", text: "Keep" }],
        signal,
        { source, mode: "add" },
      ),
      id = initial.entities.find((e) => e.kind === "heading").id;
    await app.savePlanItem(initial.id, plan(id), "Link", signal);
    await app.importArchitecture(
      "Remove section",
      [{ path: "keep.md", text: "Keep" }],
      signal,
      { source, mode: "refresh" },
    );
    const changed = await app.importArchitecture(
      "Unrelated later section",
      [doc("## Notes\nDifferent meaning\n"), { path: "keep.md", text: "Keep" }],
      signal,
      { source, mode: "refresh" },
    );
    assert.ok(
      changed.edges.some(
        (e) => e.from === "plan:D1" && e.to === id && e.unresolved,
      ),
    );
    assert.notEqual(changed.entities.find((e) => e.kind === "heading").id, id);
  }));

test("a linked placeholder can acquire an explicit anchor before a combined rename and body edit", () =>
  fixture(async (app) => {
    const initial = await app.importArchitecture(
      "Initial",
      [doc("## Notes\nTBD\n")],
      signal,
      { source, mode: "add" },
    );
    const id = initial.entities.find((e) => e.kind === "heading").id;
    const planned = await app.savePlanItem(
      initial.id,
      plan(id),
      "Link",
      signal,
    );
    await assert.rejects(
      app.editArchitectureDocument(
        planned.id,
        "REQ.md",
        "## New notes\nDifferent meaning\n",
        "Unsafe rename",
        signal,
      ),
      /first add an explicit/,
    );
    const anchored = await app.editArchitectureDocument(
      planned.id,
      "REQ.md",
      "## Notes {#stable-notes}\nTBD\n",
      "Anchor",
      signal,
    );
    assert.ok(anchored.entities.some((e) => e.id === id));
    const changed = await app.editArchitectureDocument(
      anchored.id,
      "REQ.md",
      "## Notes and caveats {#stable-notes}\nDocumented decision.\n",
      "Rename and edit",
      signal,
    );
    assert.ok(changed.edges.some((e) => e.to === id && !e.unresolved));
    assert.equal(
      changed.entities.find((e) => e.id === id).name,
      "Notes and caveats",
    );
  }));
