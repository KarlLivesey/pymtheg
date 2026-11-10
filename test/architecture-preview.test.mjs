import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const signal = new AbortController().signal;
test("import review commits only the reviewed head and retains native planning across source refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-preview-")),
    app = new StudioService(root);
  const source = { id: "test", label: "Existing design", kind: "upload" };
  try {
    const initial = await app.previewArchitectureImport(
      "Initial",
      {
        documents: [
          { path: "one.md", text: "one" },
          { path: "two.md", text: "two" },
        ],
        source,
      },
      signal,
    );
    assert.deepEqual(
      await readdir(root),
      [],
      "preview must not create persistent storage",
    );
    assert.equal((await app.architectureOverview()).index, null);
    let current = await app.commitPreparedArchitectureImport(
      initial.token,
      signal,
    );
    current = await app.savePlanItem(
      current.id,
      { ...newPlanItem("R1"), title: "Keep me", owner: "design" },
      "Native plan",
      signal,
    );
    let preview = await app.previewArchitectureImport(
      "Refresh",
      { documents: [{ path: "one.md", text: "new" }], source, mode: "refresh" },
      signal,
    );
    assert.deepEqual(preview.summary.changed, ["one.md"]);
    assert.deepEqual(preview.summary.removed, ["two.md"]);
    assert.ok(preview.summary.keptNative.includes("architecture/plan.json"));
    assert.equal((await app.architectureOverview()).index.id, current.id);
    current = await app.editArchitectureDocument(
      current.id,
      "meeting.md",
      "Later meeting",
      "Meeting",
      signal,
    );
    await assert.rejects(
      app.commitPreparedArchitectureImport(preview.token, signal),
      /current architecture changed/,
    );
    assert.equal((await app.architectureOverview()).index.id, current.id);
    preview = await app.previewArchitectureImport(
      "Refresh",
      { documents: [{ path: "one.md", text: "new" }], source, mode: "refresh" },
      signal,
    );
    current = await app.commitPreparedArchitectureImport(preview.token, signal);
    assert.ok(current.entities.some((e) => e.id === "plan:R1"));
    assert.ok(current.documents.some((d) => d.path === "meeting.md"));
    assert.ok(!current.documents.some((d) => d.path === "two.md"));
    await assert.rejects(
      app.commitPreparedArchitectureImport(preview.token, signal),
      /no longer available/,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
