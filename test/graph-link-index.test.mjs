// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";
import { writeAheadLogSafe } from "../dist/storage/local.js";

// Analysis rewrites every file, so both write phases are exercised.
const analysed = {
  ...toy,
  analyze: ({ files }) =>
    files.map((file) => ({
      path: file.path,
      result: { ...file.result, data: { analysed: true } },
    })),
};
const names = ["a0", "a1", "a2", "a3"];

async function project(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-locks-"));
  const root = join(scratch, "project");
  await mkdir(root);
  await Promise.all(
    names.map((name, i) =>
      writeFile(
        join(root, `${name}.toy`),
        `def ${name}\ncall ${names[(i + 1) % names.length]}\n`,
      ),
    ),
  );
  try {
    await run({ root, database: join(scratch, "graph.sqlite") });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** After each file write: whether a no-wait writer could take the lock, then
 * the files `graph status` reads, and a writable open once the lock is free. */
function probing(store, database, probes) {
  const original = store.replaceFile;
  // The handshake is this hook (after each write returns), not a clock.
  store.replaceFile = function (...args) {
    original.apply(this, args);
    // Fail-fast connection: BEGIN IMMEDIATE succeeds only if no write lock is held.
    const raw = new DatabaseSync(database, { timeout: 0 });
    let free = true;
    try {
      raw.exec("BEGIN IMMEDIATE");
      raw.exec("ROLLBACK");
    } catch (error) {
      if (!/locked|busy/i.test(error.message)) throw error;
      free = false;
    } finally {
      raw.close();
    }
    // The reads `graph status` makes: never blocked.
    const reader = new SqliteGraphStore(database, undefined, {
      readOnly: true,
    });
    probes.push([reader.fileInventory().length, free]);
    reader.graphCommandState();
    reader.close();
    if (free) new SqliteGraphStore(database).close();
  };
}

test("with one-row batches, after every file write another connection can read status and open the store for writing", async () => {
  await project(async ({ root, database }) => {
    const previous = SqliteGraphStore.writeBatchRows;
    SqliteGraphStore.writeBatchRows = 1;
    const store = new SqliteGraphStore(database, "lock-project");
    const probes = [];
    probing(store, database, probes);
    try {
      await indexProject(root, new LanguageRegistry([analysed]), store);
    } finally {
      store.close();
      SqliteGraphStore.writeBatchRows = previous;
    }
    // Four file writes, at analysis (C-53: each file is written once);
    // each one already committed.
    assert.deepEqual(
      probes,
      [1, 2, 3, 4].map((files) => [files, true]),
    );
  });
});

// C-37: under the write-ahead log a batch holds the write lock across its
// writes, so another writer waits for the batch (here each phase is one
// batch, and the files are written in the analysis batch, C-53); readers
// are never blocked and read the last commit.
test("within a write batch readers read the last commit; another writer gets the lock after it", async () => {
  await project(async ({ root, database }) => {
    const batched = writeAheadLogSafe(dirname(database));
    const store = new SqliteGraphStore(database, "lock-project");
    const probes = [];
    probing(store, database, probes);
    try {
      await indexProject(root, new LanguageRegistry([analysed]), store);
    } finally {
      store.close();
    }
    assert.deepEqual(
      probes,
      batched
        ? [0, 0, 0, 0].map((files) => [files, false])
        : [1, 2, 3, 4].map((files) => [files, true]),
    );
    const raw = new DatabaseSync(database, { timeout: 0 });
    raw.exec("BEGIN IMMEDIATE");
    raw.exec("ROLLBACK");
    raw.close();
  });
});

test("read-only stores without the file-status index read identical links", async () => {
  await project(async ({ root, database }) => {
    const store = new SqliteGraphStore(database, "lock-project");
    await indexProject(root, new LanguageRegistry([analysed]), store);
    const indexed = JSON.stringify(store.links());
    store.close();
    const raw = new DatabaseSync(database);
    raw.exec("DROP INDEX graph_file_status");
    raw.close();
    const reader = new SqliteGraphStore(database, undefined, {
      readOnly: true,
    });
    assert.equal(JSON.stringify(reader.links()), indexed);
    reader.close();
    // A writable open recreates the index; the rows stay identical.
    const writer = new SqliteGraphStore(database);
    assert.equal(JSON.stringify(writer.links()), indexed);
    writer.close();
  });
});
