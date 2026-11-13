import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { indexArchitecture } from "../dist/architecture/model.js";
import { hash } from "../dist/shared/identity.js";
test("different checkpoint names survive unchanged content without duplicating snapshots or payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-checkpoints-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const docs = [{ path: "design.md", text: "Accepted design" }],
      first = store.save("Initial baseline", "source", docs),
      second = store.save("Release review complete", "source", docs);
    assert.notEqual(first.id, second.id);
    assert.equal(first.snapshotHash, second.snapshotHash);
    assert.equal(store.storageStats().snapshots, 1);
    assert.equal(store.storageStats().uniqueDocuments, 1);
    assert.equal(store.storageStats().revisions, 2);
    store.saveDraft(0, {
      kind: "document",
      baseRevision: first.id,
      label: "Unfinished",
      document: { path: "todo.md", text: "Keep this" },
    });
    const archive = store.exportHistory();
    assert.equal(archive.schema, "pymtheg.architecture-history/v3");
    assert.equal(archive.snapshots.length, 1);
    assert.equal(archive.revisions.length, 2);
    store.close();
    store = await ArchitectureStore.open(root);
    assert.equal(store.read().id, second.id);
    assert.equal(store.read(first.id).snapshotHash, second.snapshotHash);
    assert.deepEqual(
      new Set(store.revisions().map((r) => r.label)),
      new Set(["Initial baseline", "Release review complete"]),
    );
    assert.equal(store.readDraft().draft.baseRevision, first.id);
    const db = new DatabaseSync(
      join(root, ".pymtheg/shared", "architecture.sqlite"),
    );
    db.exec(
      "CREATE TRIGGER reject_active BEFORE UPDATE ON meta WHEN new.key='active' BEGIN SELECT RAISE(FAIL, 'controlled failure'); END",
    );
    assert.throws(
      () => store.save("Must roll back", "source", docs),
      /controlled failure/,
    );
    assert.equal(store.read().id, second.id);
    assert.equal(store.revisions().length, 2);
    db.exec("DROP TRIGGER reject_active");
    db.close();
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("v2 migration preserves legacy revision IDs, document bytes and draft references", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-checkpoint-legacy-")),
    dir = join(root, ".pymtheg/shared");
  let store;
  try {
    await mkdir(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, "architecture.sqlite")),
      doc = { path: "design.md", text: "Legacy design" },
      index = indexArchitecture([doc]);
    db.exec(
      "CREATE TABLE revisions(id TEXT PRIMARY KEY,label TEXT,created TEXT,source TEXT,index_json TEXT);CREATE TABLE blobs(hash TEXT PRIMARY KEY,text TEXT);CREATE TABLE documents(revision TEXT,path TEXT,hash TEXT,PRIMARY KEY(revision,path));CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE authoring_draft(key TEXT PRIMARY KEY,version INTEGER,json TEXT);PRAGMA user_version=2;",
    );
    db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?)").run(
      index.id,
      "Legacy baseline",
      "2026-11-08T00:00:00.000Z",
      "legacy",
      JSON.stringify(index),
    );
    db.prepare("INSERT INTO blobs VALUES(?,?)").run(hash(doc.text), doc.text);
    db.prepare("INSERT INTO documents VALUES(?,?,?)").run(
      index.id,
      doc.path,
      hash(doc.text),
    );
    db.prepare("INSERT INTO meta VALUES('active',?)").run(index.id);
    db.prepare("INSERT INTO authoring_draft VALUES('active',1,?)").run(
      JSON.stringify({
        kind: "document",
        baseRevision: index.id,
        label: "Draft",
        document: { path: "new.md", text: "Draft" },
      }),
    );
    db.close();
    store = await ArchitectureStore.open(root, { readOnly: true });
    assert.equal(store.read().id, index.id);
    store.close();
    store = await ArchitectureStore.open(root);
    assert.equal(store.read().id, index.id);
    assert.equal(store.readDraft().draft.baseRevision, index.id);
    assert.equal(store.document(index.id, "design.md").text, "Legacy design");
    const newer = store.save("New checkpoint", "legacy", [doc]);
    assert.notEqual(newer.id, index.id);
    assert.equal(newer.snapshotHash, index.id);
    assert.equal(store.storageStats().snapshots, 1);
    assert.equal(store.revisions().length, 2);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("A to B to A retains the chronological reopening action independently of content deduplication", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-reopen-history-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const a = store.save("Initial", "local", [
      { path: "decision.md", text: "Proposed" },
    ]);
    const b = store.save("Accept WAL", "local", [
      { path: "decision.md", text: "Accepted" },
    ]);
    const reopened = store.save("Reopen after review finding", "local", [
      { path: "decision.md", text: "Proposed" },
    ]);
    assert.notEqual(reopened.id, a.id);
    assert.equal(reopened.snapshotHash, a.snapshotHash);
    assert.equal(store.read().id, reopened.id);
    assert.equal(store.revisions()[0].label, "Reopen after review finding");
    const archive = store.exportHistory();
    assert.deepEqual(
      new Set(archive.revisions.map((r) => r.label)),
      new Set(["Initial", "Accept WAL", "Reopen after review finding"]),
    );
    assert.equal(store.document(b.id, "decision.md").text, "Accepted");
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
