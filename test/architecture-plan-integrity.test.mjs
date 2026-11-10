import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const signal = new AbortController().signal,
  item = (id, title) => ({ ...newPlanItem(id), title, owner: "team" }),
  target = (id) => ({ document: "architecture/plan.json", originalId: id });
test("adding an existing ID never overwrites it; uniqueness spans all planning documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-unique-")),
    app = new StudioService(root);
  try {
    let state = await app.savePlanItem(
      "",
      { ...item("R1", "Original"), detail: "Important reasoning" },
      "First",
      signal,
    );
    await assert.rejects(
      app.savePlanItem(
        state.id,
        item("R1", "Unrelated new idea"),
        "New",
        signal,
      ),
      /already exists/,
    );
    assert.equal(
      (await app.architectureRecord(state.id, "plan:R1")).data.detail,
      "Important reasoning",
    );
    state = await app.importArchitecture(
      "Other plan",
      [
        {
          path: "notes/other.json",
          text: JSON.stringify({
            schema: "pymtheg.plan/v1",
            items: [item("OTHER", "Other")],
          }),
        },
      ],
      signal,
    );
    await assert.rejects(
      app.savePlanItem(
        state.id,
        item("OTHER", "Rename"),
        "Rename",
        signal,
        target("R1"),
      ),
      /already used/,
    );
    assert.equal((await app.architectureOverview()).index.id, state.id);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("native renames and raw edits cannot silently break inbound links or add duplicate IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-refs-")),
    app = new StudioService(root);
  try {
    let state = await app.savePlanItem(
      "",
      item("R1", "Referenced"),
      "First",
      signal,
    );
    state = await app.savePlanItem(
      state.id,
      {
        ...item("R2", "Consumer"),
        links: [{ kind: "depends-on", target: "plan:R1" }],
      },
      "Link",
      signal,
    );
    await assert.rejects(
      app.savePlanItem(
        state.id,
        item("RENAMED", "Referenced"),
        "Rename ID",
        signal,
        target("R1"),
      ),
      /incoming link/,
    );
    const plan = JSON.parse(
      (await app.architectureDocument(state.id, "architecture/plan.json")).text,
    );
    plan.items[0].id = "RENAMED";
    await assert.rejects(
      app.editArchitectureDocument(
        state.id,
        "architecture/plan.json",
        JSON.stringify(plan),
        "Raw rename",
        signal,
      ),
      /without a target/,
    );
    plan.items[0].id = "R2";
    await assert.rejects(
      app.editArchitectureDocument(
        state.id,
        "architecture/plan.json",
        JSON.stringify(plan),
        "Duplicate",
        signal,
      ),
      /already used/,
    );
    const changed = await app.savePlanItem(
      state.id,
      item("R1", "Safe new title"),
      "Rename title",
      signal,
      target("R1"),
    );
    assert.ok(changed.edges.some((e) => e.to === "plan:R1" && !e.unresolved));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
