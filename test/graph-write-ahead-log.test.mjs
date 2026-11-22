// SPDX-License-Identifier: MIT
// C-6: graph writes on a local disk use a write-ahead log. Readers are never
// locked out by a writer, a second writer waits as before, a store at rest
// keeps the rollback-journal format, and an index cut short at any point
// (process kill, or power loss: only synced data survives) reports
// incomplete and the next run repairs it to exactly a clean index.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  readlink,
  truncate,
  stat,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry } from "../dist/graph/registry.js";

/**
 * The storage directory's files. C-37: besides the store, a writer leaves its
 * turnstile, a lock-only database that stays empty (it is never written,
 * only locked), so it is listed here and checked to be empty.
 */
async function stored(directory) {
  const names = await readdir(directory);
  if (names.includes("graph.sqlite-turnstile"))
    assert.equal(
      (await stat(join(directory, "graph.sqlite-turnstile"))).size,
      0,
    );
  return names;
}
import { indexProject } from "../dist/graph/indexer.js";
import { readdirSync } from "node:fs";
import { SqliteGraphStore } from "../dist/graph/store.js";
import {
  openWriteAheadLog,
  sqliteWalResetFixed,
  writeAheadLogSafe,
} from "../dist/storage/local.js";
import { fixtureFiles, fixtureModule } from "./graph-kill-fixture.mjs";

const child = new URL("graph-kill-child.mjs", import.meta.url).pathname;
const wal = writeAheadLogSafe(tmpdir());
const graphPath = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");
const run = (root, command = "status") =>
  executeGraph(
    { command, root },
    { registry: new LanguageRegistry([fixtureModule()]) },
  );

async function project(files = fixtureFiles()) {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-c6-"));
  for (const [path, text] of Object.entries(files))
    await writeFile(join(root, path), text);
  return root;
}
/** Every row of every table, in a total order. */
function rows(root) {
  const db = new DatabaseSync(graphPath(root), { readOnly: true });
  try {
    const out = {};
    for (const { name } of db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all())
      out[name] = db
        .prepare(`SELECT * FROM ${name}`)
        .all()
        .map((row) => JSON.stringify(Object.values(row)))
        .sort();
    return out;
  } finally {
    db.close();
  }
}
const projectId = (root) => {
  const db = new DatabaseSync(graphPath(root), { readOnly: true });
  try {
    return db.prepare("SELECT value FROM graph_meta WHERE key='project'").get()
      .value;
  } finally {
    db.close();
  }
};
/** A clean index of the same files under the same project identity. */
async function cleanRows(files, id) {
  const root = await project(files);
  try {
    await mkdir(join(root, ".pymtheg/rebuildable"), { recursive: true });
    new SqliteGraphStore(graphPath(root), id).close();
    const response = await run(root, "index");
    assert.equal(response.sync.complete, true);
    return rows(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
/** SQLite file format bytes 18-19: 1 rollback journal, 2 write-ahead log. */
const format = async (root) => {
  const header = await readFile(graphPath(root));
  return [header[18], header[19]];
};
/**
 * Leave the file in write-ahead-log mode with an empty log, as a run cut short
 * after its last checkpoint does, and return its bytes. The next run then
 * writes nothing to the database file before its first checkpoint.
 */
async function walAtRest(root) {
  const db = new DatabaseSync(graphPath(root));
  assert.equal(db.prepare("PRAGMA journal_mode=WAL").get().journal_mode, "wal");
  db.close();
  return readFile(graphPath(root));
}
function killAt(root, point) {
  const process_ = spawn(process.execPath, [child, root, point], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  process_.stdout.on("data", (d) => (out += d));
  return new Promise((resolve) =>
    process_.on("exit", (code, signal) => resolve({ code, signal, out })),
  );
}

for (const point of ["open", "file", "resolved", "complete"])
  test(`an index killed at "${point}" is repaired by the next run to exactly a clean index`, async () => {
    const files = fixtureFiles();
    const root = await project(files);
    try {
      const killed = await killAt(root, point);
      assert.equal(killed.signal, "SIGKILL", killed.out);
      const status = await run(root);
      // Only a run that committed its completion record is trusted.
      assert.equal(status.sync.complete, point === "complete");
      const repaired = await run(root, "index");
      assert.equal(repaired.sync.complete, true);
      assert.equal(repaired.exitCode, 0);
      assert.deepEqual(rows(root), await cleanRows(files, projectId(root)));
      assert.deepEqual(await format(root), [1, 1]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test(
  "power loss: a cold index loses its unsynced log tail mid-frame, reports incomplete and is repaired",
  {
    skip: !wal && "no write-ahead log here (filesystem or SQLite version)",
  },
  async () => {
    const files = fixtureFiles();
    const root = await project(files);
    try {
      await mkdir(join(root, ".pymtheg/rebuildable"), { recursive: true });
      new SqliteGraphStore(graphPath(root)).close();
      const before = await walAtRest(root);
      assert.equal((await killAt(root, "resolved")).signal, "SIGKILL");
      // Nothing of this run reached the database file: every commit is still
      // in the unsynced log, so any cut of the log is a state power loss can leave.
      assert.deepEqual(await readFile(graphPath(root)), before);
      const log = graphPath(root) + "-wal";
      const size = (await stat(log)).size;
      assert.ok(size > 32 + 4096 * 3);
      await truncate(log, Math.floor(size / 2) + 7);
      await rm(graphPath(root) + "-shm", { force: true });
      assert.equal((await run(root)).sync.complete, false);
      const repaired = await run(root, "index");
      assert.equal(repaired.sync.complete, true);
      assert.deepEqual(rows(root), await cleanRows(files, projectId(root)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "power loss: an edit's re-index that loses its whole log returns to the previous complete index, which is reported stale and repaired",
  {
    skip: !wal && "no write-ahead log here (filesystem or SQLite version)",
  },
  async () => {
    const files = fixtureFiles();
    const root = await project(files);
    try {
      assert.equal((await run(root, "index")).sync.complete, true);
      const previous = rows(root);
      files["f0.x"] += "def h\ncall g1\n";
      await writeFile(join(root, "f0.x"), files["f0.x"]);
      const before = await walAtRest(root);
      assert.equal((await killAt(root, "resolved")).signal, "SIGKILL");
      assert.deepEqual(await readFile(graphPath(root)), before);
      await rm(graphPath(root) + "-wal");
      await rm(graphPath(root) + "-shm", { force: true });
      assert.deepEqual(rows(root), previous);
      const status = await run(root);
      assert.equal(status.sync.complete, false);
      assert.deepEqual(
        status.staleFiles.map((file) => file.path),
        ["f0.x"],
      );
      assert.equal((await run(root, "index")).sync.complete, true);
      assert.deepEqual(rows(root), await cleanRows(files, projectId(root)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("while a writer holds the write lock, readers keep reading and a second index waits, then succeeds", async () => {
  const root = await project();
  try {
    assert.equal((await run(root, "index")).sync.complete, true);
    // An open store that has written: on a local disk the file is in
    // write-ahead-log mode until its last writer closes.
    const store = new SqliteGraphStore(graphPath(root));
    try {
      assert.deepEqual(await format(root), [1, 1]);
      store.removeFile("absent.x");
      if (wal) assert.deepEqual(await format(root), [2, 2]);
      const holder = spawn(
        process.execPath,
        [
          "-e",
          `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("BEGIN EXCLUSIVE");process.stdout.write("ready\\n");process.stdin.once("data",()=>{d.exec("COMMIT");d.close();process.exit(0)});`,
          graphPath(root),
        ],
        { stdio: ["pipe", "pipe", "inherit"] },
      );
      await new Promise((done) => holder.stdout.once("data", done));
      if (wal) {
        // With a rollback journal this lock shuts readers out (main's behaviour).
        const read = await run(root);
        assert.equal(read.sync.complete, true);
        assert.equal(read.counts.symbols, 12);
      }
      await writeFile(join(root, "f0.x"), "def f0\ncall g1\n");
      const writer = killAt(root, "none");
      const writerPid = () =>
        readdir("/proc").then(async (entries) => {
          for (const pid of entries)
            if (
              /^\d+$/.test(pid) &&
              (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => ""))
                .split("\0")
                .includes(child)
            )
              return pid;
        });
      // Readiness: the second writer has the locked database open.
      const opened = async () => {
        const pid = await writerPid();
        if (!pid) return false;
        for (const fd of await readdir(`/proc/${pid}/fd`).catch(() => []))
          if (
            (await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "")) ===
            graphPath(root)
          )
            return true;
        return false;
      };
      while (!(await opened())) await new Promise((next) => setImmediate(next));
      holder.stdin.write("go\n");
      const result = await writer;
      assert.equal(result.code, 0, result.out);
      assert.equal(result.out, "not killed\n");
    } finally {
      store.close();
    }
    const status = await run(root);
    assert.equal(status.sync.complete, true);
    assert.equal(status.counts.symbols, 11);
    // The last writer closed: at rest the store has the rollback-journal format.
    assert.deepEqual(await format(root), [1, 1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a completed index is readable from a storage directory the reader cannot write", async () => {
  const root = await project();
  const directory = join(root, ".pymtheg/rebuildable");
  try {
    assert.equal((await run(root, "index")).sync.complete, true);
    assert.deepEqual(await stored(directory), [
      ".gitignore",
      "graph.sqlite",
      "graph.sqlite-turnstile",
    ]);
    await chmod(directory, 0o555);
    const status = await executeGraph(
      { command: "symbol", args: ["f1"], root, noSync: true },
      { registry: new LanguageRegistry([fixtureModule()]) },
    );
    assert.equal(status.sync.complete, true);
    assert.equal(status.data.symbol.name, "f1");
  } finally {
    await chmod(directory, 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

test("the write-ahead-log reset fix is recognised by SQLite version", () => {
  const cases = {
    // Affected: 3.7.0 through 3.51.2, and the withdrawn 3.52.0.
    "3.7.0": false,
    "3.44.5": false,
    "3.49.1": false,
    "3.50.4": false,
    "3.51.2": false,
    "3.52.0": false,
    // Fixed: 3.51.3, 3.53.0 and later, backports 3.50.7 and 3.44.6.
    "3.44.6": true,
    "3.50.7": true,
    "3.51.3": true,
    "3.53.0": true,
    "3.54.1": true,
    "3.100.0": true,
    // Unknown or unparsable: not fixed.
    "": false,
    3.51: false,
    "3.51.3-beta": false,
    next: false,
  };
  for (const [version, fixed] of Object.entries(cases))
    assert.equal(sqliteWalResetFixed(version), fixed, version);
  assert.equal(sqliteWalResetFixed(undefined), false);
  assert.equal(writeAheadLogSafe(tmpdir(), "3.51.2"), false);
});

test("with an affected SQLite a writer keeps the rollback journal and first removes a log a killed run left", async () => {
  const files = fixtureFiles();
  const root = await project(files);
  try {
    assert.equal((await killAt(root, "resolved")).signal, "SIGKILL");
    const left = await readdir(join(root, ".pymtheg/rebuildable"));
    const before = rows(root);
    // Another connection is open: the log cannot be removed, so nothing is written.
    const other = new DatabaseSync(graphPath(root));
    other.prepare("SELECT count(*) FROM graph_files").get();
    const db = new DatabaseSync(graphPath(root), { timeout: 100 });
    try {
      db.prepare("SELECT count(*) FROM graph_files").get();
      if (left.includes("graph.sqlite-wal"))
        assert.throws(
          () => openWriteAheadLog(db, graphPath(root), "3.51.2"),
          /database is locked/,
        );
      other.close();
      assert.equal(openWriteAheadLog(db, graphPath(root), "3.51.2"), false);
      assert.equal(
        db.prepare("PRAGMA journal_mode").get().journal_mode,
        "delete",
      );
    } finally {
      db.close();
    }
    assert.deepEqual(await format(root), [1, 1]);
    assert.deepEqual(await stored(join(root, ".pymtheg/rebuildable")), [
      ".gitignore",
      "graph.sqlite",
      "graph.sqlite-turnstile",
    ]);
    // The killed run's committed rows survive the switch unchanged.
    assert.deepEqual(rows(root), before);
    assert.equal((await run(root)).sync.complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "with a fixed SQLite a writer on a local disk uses the write-ahead log",
  {
    skip:
      !writeAheadLogSafe(tmpdir(), "3.53.0") && "not a local Linux filesystem",
  },
  async () => {
    const root = await project();
    try {
      await mkdir(join(root, ".pymtheg/rebuildable"), { recursive: true });
      new SqliteGraphStore(graphPath(root)).close();
      const db = new DatabaseSync(graphPath(root));
      try {
        assert.equal(openWriteAheadLog(db, graphPath(root), "3.53.0"), true);
        assert.deepEqual(await format(root), [2, 2]);
      } finally {
        db.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("a reader still open when the last writer closes keeps the log; every later open reads the same rows and the next writer restores the rollback journal", async () => {
  const root = await project();
  const directory = join(root, ".pymtheg/rebuildable");
  try {
    assert.equal((await run(root, "index")).sync.complete, true);
    const reader = new SqliteGraphStore(graphPath(root), undefined, {
      readOnly: true,
    });
    try {
      assert.equal(reader.counts().files, 6);
      const writer = new SqliteGraphStore(graphPath(root));
      writer.removeFile("f0.x");
      // The open reader sees the committed write, reading through the log.
      assert.equal(reader.counts().files, 5);
      writer.close();
      if (wal) {
        // A connection that has read through the log keeps it in use, and the
        // switch back needs every other connection closed: the log stays.
        assert.deepEqual(await format(root), [2, 2]);
        assert.deepEqual(await stored(directory), [
          ".gitignore",
          "graph.sqlite",
          "graph.sqlite-shm",
          "graph.sqlite-turnstile",
          "graph.sqlite-wal",
        ]);
      }
      assert.equal(reader.counts().files, 5);
    } finally {
      reader.close();
    }
    // A read-only connection cannot checkpoint: the log is still there, and
    // every later open reads it.
    const status = await run(root);
    assert.equal(status.counts.files, 5);
    assert.equal(status.sync.complete, false);
    // An open as main makes it (no journal-mode change) reads the same rows.
    const plain = new DatabaseSync(graphPath(root));
    assert.equal(
      plain.prepare("SELECT count(*) AS n FROM graph_files").get().n,
      5,
    );
    plain.close();
    // The next writer of this build that closes alone restores the format.
    assert.equal((await run(root, "index")).sync.complete, true);
    assert.deepEqual(await format(root), [1, 1]);
    assert.deepEqual(await stored(directory), [
      ".gitignore",
      "graph.sqlite",
      "graph.sqlite-turnstile",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a cold index with an affected SQLite stays in the rollback journal throughout and stores the fast path's rows", async () => {
  const files = fixtureFiles(8);
  /** Cold index with the given SQLite version; records any -wal seen. */
  async function coldIndex(sqliteVersion) {
    const root = await project(files);
    try {
      await mkdir(join(root, ".pymtheg/rebuildable"), { recursive: true });
      const path = graphPath(root);
      const logs = [];
      // Looked at right after every store write and during resolution.
      const look = (when) => {
        if (
          readdirSync(join(root, ".pymtheg/rebuildable")).includes(
            "graph.sqlite-wal",
          )
        )
          logs.push(when);
      };
      const store = new SqliteGraphStore(path, "c6-e2e", { sqliteVersion });
      for (const name of [
        "replaceContexts",
        "replaceFile",
        "replaceAnalysis",
      ]) {
        const original = store[name].bind(store);
        store[name] = (...args) => {
          const result = original(...args);
          look(`after ${name}`);
          return result;
        };
      }
      const module = fixtureModule();
      const resolve = module.resolve;
      module.resolve = (context) => {
        look("during resolution");
        return resolve(context);
      };
      try {
        const report = await indexProject(
          root,
          new LanguageRegistry([module]),
          store,
          { excludeDirectories: [".pymtheg"] },
        );
        assert.deepEqual(report.errors, []);
        assert.deepEqual(report.resolutionErrors, []);
        look("after the index");
      } finally {
        store.close();
      }
      return { logs, rows: rows(root), format: await format(root) };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const fallback = await coldIndex("3.51.2");
  assert.deepEqual(fallback.logs, []);
  assert.deepEqual(fallback.format, [1, 1]);
  const fast = await coldIndex("3.53.0");
  if (writeAheadLogSafe(tmpdir(), "3.53.0"))
    assert.ok(fast.logs.includes("during resolution"));
  assert.deepEqual(fallback.rows, fast.rows);
  assert.equal(fallback.rows.graph_files.length, 8);
});

test("write-ahead logs only on local Linux filesystems", () => {
  // procfs is not a filesystem a database can share memory on.
  assert.equal(writeAheadLogSafe("/proc"), false);
  assert.equal(writeAheadLogSafe(join(tmpdir(), "missing-directory")), false);
  if (process.platform !== "linux")
    assert.equal(writeAheadLogSafe(tmpdir()), false);
});
