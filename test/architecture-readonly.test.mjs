import { architectureIndexVersion } from "../dist/architecture/schema.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, chmod, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { indexArchitecture } from "../dist/architecture/model.js";
import { StudioService } from "../dist/studio/service.js";
test("read-only architecture browsing preserves the database bytes and permissions while rebuilding a legacy projection", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const root = await mkdtemp(join(tmpdir(), "pym-readonly-"));
  let store, service;
  const directory = join(root, ".pymtheg/shared"),
    file = join(directory, "architecture.sqlite");
  try {
    store = await ArchitectureStore.open(root);
    const docs = [{ path: "notes.md", text: "A retained decision" }],
      index = store.save("Legacy", "test", docs);
    store.close();
    store = null;
    const db = new DatabaseSync(file);
    const old = { ...index, indexVersion: 3 };
    db.prepare("UPDATE revisions SET index_json=? WHERE id=?").run(
      JSON.stringify(old),
      index.snapshotHash,
    );
    db.close();
    await chmod(file, 0o444);
    await chmod(directory, 0o555);
    const before = await readFile(file),
      mode = (await stat(file)).mode;
    store = await ArchitectureStore.open(root, { readOnly: true });
    assert.equal(store.read().indexVersion, architectureIndexVersion);
    assert.equal(
      store.document(index.id, "notes.md").text,
      "A retained decision",
    );
    assert.equal(store.search(index.id, "retained").length, 1);
    assert.throws(() => store.save("Write", "bad", docs), /read-only/);
    store.close();
    store = null;
    service = new StudioService(root);
    assert.equal((await service.architectureOverview()).index.id, index.id);
    assert.equal(
      (await service.architectureDocument(index.id, "notes.md")).text,
      "A retained decision",
    );
    await service.close();
    service = null;
    assert.deepEqual(await readFile(file), before);
    assert.equal((await stat(file)).mode, mode);
  } finally {
    await service?.close();
    store?.close();
    await chmod(directory, 0o700).catch(() => {});
    await chmod(file, 0o600).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
test("legacy projection rebuilding uses an owned worker that can be cancelled before any worker messages are handled", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-read-cancel-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const index = store.save("Legacy", "test", [
      { path: "notes.md", text: "Retained" },
    ]);
    store.close();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(
      join(root, ".pymtheg/shared", "architecture.sqlite"),
    );
    db.prepare("UPDATE revisions SET index_json=?").run(
      JSON.stringify({ ...index, indexVersion: 3 }),
    );
    db.close();
    store = await ArchitectureStore.open(root, { readOnly: true });
    const reading = store.readAsync();
    const rejected = assert.rejects(reading, /cancelled/);
    await store.closeReadWorkers();
    await rejected;
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
