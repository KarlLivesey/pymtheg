// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const signal = new AbortController().signal;
const item = (id, title) => ({
  ...newPlanItem(id),
  title,
  owner: "Architecture",
});
test("recovered and historical edits merge unrelated records, but preserve both sides of a same-record conflict", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-rebase-"));
  let app = new StudioService(root);
  try {
    let initial = await app.savePlanItem(
      "",
      item("R1", "Original"),
      "Initial",
      signal,
    );
    await app.saveArchitectureDraft(0, {
      kind: "plan",
      baseRevision: initial.id,
      item: item("R1", "Recovered draft"),
      target: { document: "architecture/plan.json", originalId: "R1" },
    });
    let changed = await app.savePlanItem(
      initial.id,
      item("R2", "Unrelated"),
      "Other work",
      signal,
    );
    await app.close();
    app = new StudioService(root);
    const recovered = (await app.architectureDraft()).draft;
    let merged = await app.savePlanItem(
      recovered.baseRevision,
      recovered.item,
      "Recovered edit",
      signal,
      recovered.target,
    );
    assert.equal(
      merged.entities.find((e) => e.id === "plan:R1").name,
      "Recovered draft",
    );
    assert.equal(
      merged.entities.find((e) => e.id === "plan:R2").name,
      "Unrelated",
    );
    await assert.rejects(
      app.savePlanItem(
        initial.id,
        item("R1", "Stale conflicting edit"),
        "Conflict",
        signal,
        { document: "architecture/plan.json", originalId: "R1" },
      ),
      /planning record changed/,
    );
    assert.equal((await app.architectureOverview()).index.id, merged.id);
    assert.equal(
      (await app.architectureDraft()).draft.item.title,
      "Recovered draft",
    );
    const docBase = await app.editArchitectureDocument(
      merged.id,
      "notes.md",
      "Original note",
      "Add note",
      signal,
    );
    changed = await app.savePlanItem(
      docBase.id,
      item("R3", "Later work"),
      "Later work",
      signal,
    );
    merged = await app.editArchitectureDocument(
      docBase.id,
      "notes.md",
      "Updated note",
      "Historical edit",
      signal,
    );
    assert.ok(merged.entities.some((e) => e.id === "plan:R3"));
    assert.equal(
      (await app.architectureDocument(merged.id, "notes.md")).text,
      "Updated note",
    );
    await assert.rejects(
      app.editArchitectureDocument(
        docBase.id,
        "notes.md",
        "Conflicting note",
        "Conflict",
        signal,
      ),
      /document changed/,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("create-only documents cannot replace an existing document and invalid planning JSON cannot disable forms", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-safe-doc-")),
    app = new StudioService(root);
  try {
    let state = await app.savePlanItem(
      "",
      item("R1", "Existing"),
      "Initial",
      signal,
    );
    state = await app.editArchitectureDocument(
      state.id,
      "notes/decision.md",
      "Keep this",
      "Note",
      signal,
      true,
    );
    await assert.rejects(
      app.editArchitectureDocument(
        state.id,
        "notes/decision.md",
        "Replacement",
        "Bad",
        signal,
        true,
      ),
      /already exists/,
    );
    await assert.rejects(
      app.editArchitectureDocument(
        state.id,
        "architecture/plan.json",
        "{broken",
        "Bad JSON",
        signal,
      ),
      /Planning JSON is invalid/,
    );
    state = await app.savePlanItem(
      state.id,
      item("R2", "Forms still work"),
      "Add",
      signal,
    );
    assert.ok(state.entities.some((e) => e.id === "plan:R2"));
    assert.equal(
      (await app.architectureDocument(state.id, "notes/decision.md")).text,
      "Keep this",
    );
    await assert.rejects(
      app.savePlanItem(
        state.id,
        {
          ...item("R3", "Bad link"),
          links: [{ kind: "depends-on", target: "R03" }],
        },
        "Bad link",
        signal,
      ),
      /missing or ambiguous/,
    );
    await assert.rejects(
      app.savePlanItem(
        state.id,
        { ...item("R4", "Bad evidence"), evidenceRevision: "nonexistent" },
        "Bad evidence",
        signal,
      ),
      /evidence revision is not retained/,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("an explicitly reviewed deletion can be restored against the new base without reviving unrelated old records", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-restore-record-")),
    app = new StudioService(root);
  try {
    const original = await app.savePlanItem(
      "",
      item("R1", "Restore this"),
      "Original",
      signal,
    );
    const deleted = await app.editArchitectureDocument(
      original.id,
      "architecture/plan.json",
      JSON.stringify({ schema: "pymtheg.plan/v1", items: [] }),
      "Delete record",
      signal,
    );
    await assert.rejects(
      app.savePlanItem(original.id, item("R1", "Draft edit"), "Stale", signal, {
        document: "architecture/plan.json",
        originalId: "R1",
        itemIndex: 0,
      }),
      /record changed/,
    );
    const restored = await app.savePlanItem(
      deleted.id,
      item("R1", "Draft edit"),
      "Restore reviewed record",
      signal,
      { document: "architecture/plan.json", originalId: "R1", itemIndex: 0 },
    );
    assert.equal(
      restored.entities.find((e) => e.id === "plan:R1").name,
      "Draft edit",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
