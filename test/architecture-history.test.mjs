import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("portable history preserves named revisions, deduplicated content and a recovery draft; corrupted imports are atomic", async () => {
  const first = await mkdtemp(join(tmpdir(), "pym-history-a-")),
    second = await mkdtemp(join(tmpdir(), "pym-history-b-"));
  let a, b;
  try {
    a = await ArchitectureStore.open(first);
    const v1 = a.save("First", "origin", [
        { path: "note.md", text: "Original" },
      ]),
      v2 = a.save("Second", "origin", [
        { path: "note.md", text: "Original" },
        { path: "new.md", text: "New decision" },
      ]);
    a.saveDraft(0, {
      kind: "plan",
      baseRevision: v1.id,
      item: { ...newPlanItem("Draft"), title: "Unfinished", owner: "design" },
    });
    const archive = a.exportHistory();
    assert.equal(archive.revisions.length, 2);
    assert.equal(archive.blobs.length, 2);
    b = await ArchitectureStore.open(second);
    const corrupt = structuredClone(archive);
    corrupt.blobs[0].text += "corrupt";
    assert.throws(() => b.importHistory(corrupt), /hash/);
    assert.equal(b.revisions().length, 0);
    b.importHistory(archive);
    assert.deepEqual(b.revisions(), a.revisions());
    assert.equal((await b.readAsync()).id, v2.id);
    assert.equal(b.document(v1.id, "note.md").text, "Original");
    assert.equal(b.readDraft().draft.item.title, "Unfinished");
    assert.deepEqual(b.exportHistory(), archive);
    const native = b.save("Local newer work", "local", [
      { path: "local.md", text: "Keep current" },
    ]);
    b.importHistory(archive);
    assert.equal(b.read().id, native.id);
  } finally {
    a?.close();
    b?.close();
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
test("history validation runs in an owned cancellable worker", async () => {
  const { historyInWorker } = await import("../dist/architecture/runner.js");
  const { indexArchitecture } = await import("../dist/architecture/model.js");
  const { hash } = await import("../dist/shared/identity.js");
  const document = { path: "notes.md", text: "Keep data" },
    index = indexArchitecture([document]);
  const archive = {
    schema: "pymtheg.architecture-history/v1",
    active: index.id,
    revisions: [
      {
        id: index.id,
        label: "First",
        created: "2026-11-08T00:00:00.000Z",
        source: "test",
        documents: [{ path: document.path, hash: hash(document.text) }],
      },
    ],
    blobs: [{ hash: hash(document.text), text: document.text }],
    draft: null,
  };
  const cancel = new AbortController(),
    pending = historyInWorker(archive, cancel.signal),
    rejected = assert.rejects(pending, /cancelled/);
  cancel.abort();
  await rejected;
});
