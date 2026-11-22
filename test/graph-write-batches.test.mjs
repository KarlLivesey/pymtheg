// SPDX-License-Identifier: MIT
// C-37: a run's file writes commit in batches bounded by rows. Each batch is
// one commit with the run's ownership checks at its start, so a run that
// another run overtook between two batches writes nothing more; readers are
// not blocked by an open batch and see the last commit; a write that fails
// inside a batch leaves the earlier writes, as their own commits did.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SqliteGraphStore } from "../dist/graph/index.js";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";

const taken = /Another graph index run started on this store and took it over/;
/** A stored file record for `path`: 10 symbols and 10 links (21 rows). */
const record = (path, text = `source of ${path}`) => ({
  path,
  text,
  hash: `hash:${path}:${text.length}`,
  module: "synthetic",
  version: "1",
  result: synthetic.parse({ path, text }),
});
const paths = (path) => {
  const store = new SqliteGraphStore(path, undefined, { readOnly: true });
  try {
    return store
      .fileInventory()
      .map((file) => file.path)
      .sort();
  } finally {
    store.close();
  }
};
function withBudget(rows, run) {
  const previous = SqliteGraphStore.writeBatchRows;
  SqliteGraphStore.writeBatchRows = rows;
  return Promise.resolve()
    .then(run)
    .finally(() => (SqliteGraphStore.writeBatchRows = previous));
}

test("an open batch does not block readers, who see the last commit", async () => {
  const base = mkdtempSync(join(tmpdir(), "c37-batch-"));
  const path = join(base, "graph.sqlite");
  const store = new SqliteGraphStore(path, "c37");
  try {
    await withBudget(1000, () =>
      store.writeBatch(async () => {
        store.replaceFile(record("a.syn"));
        store.replaceFile(record("b.syn"));
        // 42 rows, under the budget: not committed yet.
        assert.deepEqual(paths(path), []);
      }),
    );
    assert.deepEqual(paths(path), ["a.syn", "b.syn"]);
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a batch commits once it reaches its row budget", async () => {
  const base = mkdtempSync(join(tmpdir(), "c37-batch-"));
  const path = join(base, "graph.sqlite");
  const store = new SqliteGraphStore(path, "c37");
  try {
    await withBudget(30, () =>
      store.writeBatch(async () => {
        store.replaceFile(record("a.syn"));
        assert.deepEqual(paths(path), []);
        // 42 rows reach the budget of 30: committed.
        store.replaceFile(record("b.syn"));
        assert.deepEqual(paths(path), ["a.syn", "b.syn"]);
        store.replaceFile(record("c.syn"));
        assert.deepEqual(paths(path), ["a.syn", "b.syn"]);
      }),
    );
    assert.deepEqual(paths(path), ["a.syn", "b.syn", "c.syn"]);
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a run overtaken between two batches writes nothing more", async () => {
  const base = mkdtempSync(join(tmpdir(), "c37-batch-"));
  const path = join(base, "graph.sqlite");
  const first = new SqliteGraphStore(path, "c37");
  const second = new SqliteGraphStore(path, "c37");
  try {
    first.beginIndexRun();
    await withBudget(30, () =>
      assert.rejects(
        first.writeBatch(async () => {
          first.replaceFile(record("a.syn"));
          first.replaceFile(record("b.syn"));
          // The first batch committed; another run takes the store over.
          assert.equal(second.beginIndexRun(), true);
          second.replaceFile(record("z.syn"));
          first.replaceFile(record("c.syn"));
        }),
        taken,
      ),
    );
    assert.deepEqual(paths(path), ["a.syn", "b.syn", "z.syn"]);
    assert.equal(second.unfinishedIndexRun(), true);
  } finally {
    first.close();
    second.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a write that fails inside a batch leaves the earlier writes; a failed first write leaves nothing", async () => {
  const base = mkdtempSync(join(tmpdir(), "c37-batch-"));
  const path = join(base, "graph.sqlite");
  const store = new SqliteGraphStore(path, "c37");
  // A write of bad.syn fails inside its transaction, after it began writing.
  const db = new DatabaseSync(path);
  db.exec(`CREATE TRIGGER c37_refuse BEFORE INSERT ON graph_symbols
    WHEN NEW.file='bad.syn' BEGIN SELECT RAISE(ABORT,'refused'); END`);
  db.close();
  const invalid = record("bad.syn");
  try {
    store.beginIndexRun();
    await withBudget(1000, () =>
      assert.rejects(
        store.writeBatch(async () => {
          store.replaceFile(invalid);
        }),
        /refused/,
      ),
    );
    // Nothing was committed, not even the run's mark.
    assert.deepEqual(paths(path), []);
    assert.equal(store.unfinishedIndexRun(), false);
    await withBudget(1000, () =>
      store.writeBatch(async () => {
        store.replaceFile(record("a.syn"));
        assert.throws(() => store.replaceFile(invalid), /refused/);
        store.replaceFile(record("b.syn"));
      }),
    );
    assert.deepEqual(paths(path), ["a.syn", "b.syn"]);
    assert.equal(store.unfinishedIndexRun(), true);
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});
