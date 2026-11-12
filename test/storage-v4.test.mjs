import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { indexArchitecture } from "../dist/architecture/model.js";
import { hash } from "../dist/shared/identity.js";
import { ArchitectureStore } from "../dist/architecture/store.js";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("storage compaction keeps original bytes, checkpoint IDs, rebuilt records and recovery drafts; failed migration rolls back", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-store-v4-"));
  let store;
  try {
    const documents = [
      {
        path: "design.md",
        text: "# Exact original\nKeep café and 😀 exactly.\n",
      },
      {
        path: "api.json",
        text: JSON.stringify({
          functions: [
            { id: "run", name: "run", owner: "worker", returns: "Bool" },
          ],
          types: {},
        }),
      },
    ];
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, ".pymtheg/shared"), { recursive: true });
    const path = join(root, ".pymtheg/shared", "architecture.sqlite");
    const index = indexArchitecture(documents);
    const first = { id: "a".repeat(64) },
      second = { id: "b".repeat(64) };
    const oldEntities = index.entities;
    let legacy = new DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE revisions(id TEXT PRIMARY KEY,label TEXT,created TEXT,source TEXT,index_json TEXT); CREATE TABLE blobs(hash TEXT PRIMARY KEY,text TEXT); CREATE TABLE documents(revision TEXT,path TEXT,hash TEXT,PRIMARY KEY(revision,path)); CREATE TABLE checkpoints(id TEXT PRIMARY KEY,snapshot TEXT,label TEXT,created TEXT,source TEXT); CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE authoring_draft(key TEXT PRIMARY KEY,version INTEGER,json TEXT); PRAGMA user_version=3;",
    );
    legacy
      .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
      .run(
        index.id,
        "Baseline",
        "2030-01-01T00:00:00Z",
        "source",
        JSON.stringify(index),
      );
    for (const d of documents) {
      legacy.prepare("INSERT INTO blobs VALUES(?,?)").run(hash(d.text), d.text);
      legacy
        .prepare("INSERT INTO documents VALUES(?,?,?)")
        .run(index.id, d.path, hash(d.text));
    }
    for (const [checkpoint, label] of [
      [first, "Baseline"],
      [second, "Review"],
    ])
      legacy
        .prepare("INSERT INTO checkpoints VALUES(?,?,?,?,?)")
        .run(checkpoint.id, index.id, label, "2030-01-01T00:00:00Z", "source");
    legacy.prepare("INSERT INTO meta VALUES('active',?)").run(second.id);
    legacy.prepare("INSERT INTO authoring_draft VALUES('active',1,?)").run(
      JSON.stringify({
        kind: "document",
        baseRevision: first.id,
        label: "Unfinished",
        document: { path: "new.md", text: "unsaved text" },
      }),
    );
    legacy.close();
    const original = digest(await readFile(path));
    store = await ArchitectureStore.open(root, { readOnly: true });
    assert.equal(store.read().id, second.id);
    store.close();
    store = null;
    assert.equal(digest(await readFile(path)), original);
    let db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER fail_compaction BEFORE UPDATE ON revisions BEGIN SELECT RAISE(FAIL,'controlled migration failure'); END",
    );
    db.close();
    const beforeFailure = digest(await readFile(path));
    await assert.rejects(
      ArchitectureStore.open(root),
      /controlled migration failure/,
    );
    db = new DatabaseSync(path);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
    assert.ok(
      JSON.parse(
        db.prepare("SELECT index_json FROM revisions").get().index_json,
      ).entities,
    );
    db.exec("DROP TRIGGER fail_compaction");
    db.close();
    store = await ArchitectureStore.open(root);
    const rebuilt = await store.readAsync();
    // Projection order is normalized by the document loader. Preserve every
    // identity and complete record, not the caller's original document order.
    assert.deepEqual(
      new Map(rebuilt.entities.map((e) => [e.id, e])),
      new Map(oldEntities.map((e) => [e.id, e])),
    );
    assert.equal(rebuilt.id, second.id);
    assert.deepEqual(
      new Set(store.revisions().map((r) => r.id)),
      new Set([first.id, second.id]),
    );
    for (const d of documents)
      assert.equal(store.document(first.id, d.path).text, d.text);
    assert.equal(store.readDraft().draft.document.text, "unsaved text");
    db = new DatabaseSync(path, { readOnly: true });
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
    const marker = JSON.parse(
      db.prepare("SELECT index_json FROM revisions").get().index_json,
    );
    assert.deepEqual(Object.keys(marker).sort(), ["id", "indexVersion"]);
    assert.equal(marker.indexVersion, 0);
    db.close();
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
