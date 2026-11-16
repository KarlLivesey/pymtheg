// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectureStore } from "../dist/architecture/store.js";
test("checkpoint sequence survives equal/backward clocks, reopen and portable history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-clock-history-"));
  const savedISO = Date.prototype.toISOString;
  let source, destination;
  try {
    await mkdir(join(root, "source"));
    await mkdir(join(root, "destination"));
    source = await ArchitectureStore.open(join(root, "source"));
    const ids = [];
    for (const [i, time] of [
      "2030-01-01T00:00:00.000Z",
      "2030-01-01T00:00:00.000Z",
      "2029-01-01T00:00:00.000Z",
    ].entries()) {
      Date.prototype.toISOString = () => time;
      ids.push(
        source.save("save " + i, "clock-test", [
          { path: "design.md", text: String(i % 2) },
        ]).id,
      );
    }
    Date.prototype.toISOString = savedISO;
    assert.deepEqual(
      source.revisions().map((r) => r.id),
      ids.toReversed(),
    );
    source.close();
    source = await ArchitectureStore.open(join(root, "source"));
    assert.deepEqual(
      source.revisions().map((r) => r.id),
      ids.toReversed(),
    );
    destination = await ArchitectureStore.open(join(root, "destination"));
    destination.importHistory(source.exportHistory());
    assert.deepEqual(
      destination.revisions().map((r) => r.id),
      ids.toReversed(),
    );
    assert.equal(destination.read().id, ids.at(-1));
    destination.save("next local save", "local", [
      { path: "design.md", text: "C" },
    ]);
    assert.equal(destination.revisions()[0].label, "next local save");
  } finally {
    Date.prototype.toISOString = savedISO;
    source?.close();
    destination?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("merged histories retain parent branches, while legacy lineage stays unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-branch-history-"));
  const stores = [];
  try {
    for (const name of ["left", "right", "legacy"]) {
      await mkdir(join(root, name));
      stores.push(await ArchitectureStore.open(join(root, name)));
    }
    const [left, right, legacy] = stores;
    const base = left.save("base", "local", [
      { path: "design.md", text: "base" },
    ]);
    right.importHistory(left.exportHistory());
    const l = left.save("left branch", "local", [
      { path: "design.md", text: "left" },
    ]);
    const r = right.save("right branch", "local", [
      { path: "design.md", text: "right" },
    ]);
    left.importHistory(right.exportHistory());
    assert.equal(left.read().id, l.id);
    const revisions = new Map(left.revisions().map((rev) => [rev.id, rev]));
    assert.equal(revisions.get(base.id).parentId, null);
    assert.equal(revisions.get(l.id).parentId, base.id);
    assert.equal(revisions.get(r.id).parentId, base.id);
    const archive = left.exportHistory();
    const corrupt = structuredClone(archive);
    corrupt.revisions.find((rev) => rev.id === base.id).parentId = l.id;
    assert.throws(() => legacy.importHistory(corrupt), /cycle/);
    assert.equal(legacy.read(), null);
    const missing = structuredClone(archive);
    missing.revisions[0].parentId = "f".repeat(64);
    assert.throws(() => legacy.importHistory(missing), /missing parent/);
    for (const rev of archive.revisions) delete rev.parentId;
    legacy.importHistory(archive);
    assert.ok(legacy.revisions().every((rev) => rev.parentId === undefined));
    const next = legacy.save("after legacy", "local", [
      { path: "design.md", text: "new" },
    ]);
    assert.equal(
      legacy.revisions().find((rev) => rev.id === next.id).parentId,
      l.id,
    );
    // Re-importing old metadata does not erase locally known parentage.
    legacy.importHistory(archive);
    assert.equal(
      legacy.revisions().find((rev) => rev.id === next.id).parentId,
      l.id,
    );
  } finally {
    for (const store of stores) store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("partial legacy lineage cannot introduce a cycle into an existing history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-merged-cycle-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const a = store.save("A", "local", [{ path: "design.md", text: "A" }]);
    const legacy = store.exportHistory();
    delete legacy.revisions[0].parentId;
    store.close();
    await rm(join(root, ".pymtheg/shared"), {
      recursive: true,
      force: true,
    });
    store = await ArchitectureStore.open(root);
    store.importHistory(legacy);
    const b = store.save("B", "local", [{ path: "design.md", text: "B" }]);
    const attempted = store.exportHistory();
    attempted.revisions.find((r) => r.id === a.id).parentId = b.id;
    delete attempted.revisions.find((r) => r.id === b.id).parentId;
    assert.throws(() => store.importHistory(attempted), /cycle/);
    assert.equal(store.read().id, b.id);
    assert.equal(
      store.revisions().find((r) => r.id === a.id).parentId,
      undefined,
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
