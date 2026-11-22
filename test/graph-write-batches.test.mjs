// SPDX-License-Identifier: MIT
// C-37: a run's file writes commit in batches bounded by rows. Each batch is
// one commit with the run's ownership checks at its start, so a run that
// another run overtook between two batches writes nothing more; readers are
// not blocked by an open batch and see the last commit; a write that fails
// inside a batch undoes that batch and leaves the earlier commits.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SqliteGraphStore } from "../dist/graph/index.js";
import { writeAheadLogSafe } from "../dist/storage/local.js";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";

// Batches form only under the write-ahead log (Linux local file systems).
const skip =
  !writeAheadLogSafe(tmpdir()) && "batches need the write-ahead log here";
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

test(
  "an open batch does not block readers, who see the last commit",
  { skip },
  async () => {
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
  },
);

test("a batch commits once it reaches its row budget", { skip }, async () => {
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

test(
  "a run overtaken between two batches writes nothing more",
  { skip },
  async () => {
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
  },
);

test(
  "a write that fails inside a batch undoes the open batch; earlier batches stay",
  { skip },
  async () => {
    const base = mkdtempSync(join(tmpdir(), "c37-batch-"));
    const path = join(base, "graph.sqlite");
    const store = new SqliteGraphStore(path, "c37");
    // A write of bad.syn fails inside its transaction, after it began writing.
    const db = new DatabaseSync(path);
    db.exec(`CREATE TRIGGER c37_refuse BEFORE INSERT ON graph_symbols
    WHEN NEW.file='bad.syn' BEGIN SELECT RAISE(ABORT,'refused'); END`);
    db.close();
    try {
      store.beginIndexRun();
      // The first batch fails: nothing is committed, not even the run's mark.
      await withBudget(30, () =>
        assert.rejects(
          store.writeBatch(async () => {
            store.replaceFile(record("a.syn"));
            store.replaceFile(record("bad.syn"));
          }),
          /refused/,
        ),
      );
      assert.deepEqual(paths(path), []);
      assert.equal(store.unfinishedIndexRun(), false);
      // a and b commit as one batch; c's batch is undone with the failure.
      await withBudget(30, () =>
        assert.rejects(
          store.writeBatch(async () => {
            store.replaceFile(record("a.syn"));
            store.replaceFile(record("b.syn"));
            store.replaceFile(record("c.syn"));
            store.replaceFile(record("bad.syn"));
          }),
          /refused/,
        ),
      );
      assert.deepEqual(paths(path), ["a.syn", "b.syn"]);
      // The run's mark from its first commit stays: the next run redoes it.
      assert.equal(store.unfinishedIndexRun(), true);
    } finally {
      store.close();
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test("a writable open of a current store writes nothing and takes no write lock", async () => {
  const base = mkdtempSync(join(tmpdir(), "c37-open-"));
  const path = join(base, "graph.sqlite");
  try {
    const store = new SqliteGraphStore(path, "c37");
    store.replaceFile(record("a.syn"));
    store.close();
    const before = readFileSync(path);
    // Another connection holds the write lock and does not wait for anyone.
    const holder = new DatabaseSync(path, { timeout: 0 });
    holder.exec("BEGIN IMMEDIATE");
    try {
      const opened = new SqliteGraphStore(path);
      assert.equal(opened.projectId, "c37");
      assert.deepEqual(
        opened.fileInventory().map((file) => file.path),
        ["a.syn"],
      );
      opened.close();
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    assert.deepEqual(readFileSync(path), before);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a store in memory and pymtheg doctor leave the working directory as it was", async () => {
  const base = mkdtempSync(join(tmpdir(), "c37-cwd-"));
  try {
    const store = resolve("dist/graph/index.js");
    const script = `import { SqliteGraphStore } from ${JSON.stringify(store)};
      const s = new SqliteGraphStore(":memory:", "c37");
      s.replaceFile(${JSON.stringify(record("a.syn"))});
      await s.writeBatch(async () => s.replaceFile(${JSON.stringify(record("b.syn"))}));
      s.close();`;
    const ran = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: base,
        encoding: "utf8",
      },
    );
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(readdirSync(base), []);
    spawnSync("git", ["init", "--quiet"], { cwd: base });
    spawnSync(process.execPath, [resolve("dist/cli/main.js"), "doctor"], {
      cwd: base,
      encoding: "utf8",
    });
    assert.deepEqual(readdirSync(base), [".git"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  "with a turnstile file that cannot be written no batch forms: each write commits alone",
  { skip: skip || (process.getuid?.() === 0 && "root writes any file") },
  async () => {
    const base = mkdtempSync(join(tmpdir(), "c37-batch-"));
    const path = join(base, "graph.sqlite");
    try {
      new SqliteGraphStore(path, "c37").close();
      writeFileSync(`${path}-turnstile`, "");
      chmodSync(`${path}-turnstile`, 0o444);
      const store = new SqliteGraphStore(path, "c37");
      try {
        await withBudget(1000, () =>
          store.writeBatch(async () => {
            store.replaceFile(record("a.syn"));
            // Committed at once: no batch is open.
            assert.deepEqual(paths(path), ["a.syn"]);
            store.replaceFile(record("b.syn"));
            assert.deepEqual(paths(path), ["a.syn", "b.syn"]);
          }),
        );
      } finally {
        store.close();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);
