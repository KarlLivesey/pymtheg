// SPDX-License-Identifier: MIT
/** Local storage boundary. Feature stores own schemas, transactions and queries;
 * only this module chooses project locations and opens SQLite connections. */
import { lstatSync, mkdirSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync, DatabaseSyncOptions } from "node:sqlite";
/** Loaded at first use, after the CLI has filtered node:sqlite's ExperimentalWarning
 * (src/cli/quiet-warnings.ts); a static import would load it before any code runs. */
const sqlite = (): typeof import("node:sqlite") =>
  process.getBuiltinModule("node:sqlite");

import { layout, type StorageItem } from "./layout.js";
export { layout, type StorageItem } from "./layout.js";
/** Discover a project without interpreting unrelated ancestors' legacy state. */
export function findProjectRoot(start: string): string {
  const initial = resolve(start);
  for (let root = initial; ; root = dirname(root)) {
    for (const marker of [".pymtheg", ".git"])
      try {
        lstatSync(join(root, marker));
        return root;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    if (dirname(root) === root) return initial;
  }
}
/** Read paths never create directories. Every existing component must be real. */
export function storagePath(
  root: string,
  item: StorageItem,
  create = false,
): string {
  let directory = resolve(root);
  const parts = layout[item].split("/");
  for (const part of parts.slice(0, -1)) {
    directory = join(directory, part);
    if (create) {
      try {
        mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    try {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw Error(
          "Project storage must be a real directory, not a symbolic link",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (create && directory === resolve(root, ".pymtheg/rebuildable"))
      try {
        writeFileSync(join(directory, ".gitignore"), "*\n", {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
  }
  const file = resolve(root, layout[item]);
  validateDatabaseFiles(file);
  return file;
}
function validateDatabaseFiles(file: string): void {
  for (const path of [file, file + "-wal", file + "-shm", file + "-journal"])
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw Error(
          "Project storage must contain regular files, not symbolic links",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}
/** Bounded wait for another connection's lock (SQLite busy timeout), applied to
 * every project database unless a caller sets its own. Concurrent CLI, MCP and
 * Studio writers wait for each other; a lock held longer is reported as
 * "database is locked", never waited on forever. */
export const writerWaitMs = 30_000;
/** Explicit paths support temporary immutable snapshots and the graph's existing
 * public constructor. Production project callers obtain paths via storagePath. */
export function openDatabase(
  file: string,
  options?: DatabaseSyncOptions,
): DatabaseSync {
  if (file !== ":memory:" && !file.startsWith("file:"))
    validateDatabaseFiles(file);
  return new (sqlite().DatabaseSync)(file, {
    timeout: writerWaitMs,
    ...options,
  });
}
/**
 * Local Linux filesystems (statfs magic numbers) on which every process that
 * can open a file shares one kernel's page cache, so SQLite's write-ahead-log
 * index (a memory-mapped `-shm` file) is shared memory: ext2/3/4, XFS, Btrfs,
 * tmpfs, ramfs, ZFS, F2FS, bcachefs, overlayfs (container layers), JFS,
 * ReiserFS. Not listed, so never given a write-ahead log: network and
 * host-shared filesystems (NFS, SMB/CIFS, 9p, virtiofs, FUSE, Ceph, ...),
 * where shared memory does not reach every process using the file.
 */
const sharedMemoryFilesystems = new Set([
  0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x858458f6, 0x2fc12fc1,
  0xf2f52010, 0xca451a4e, 0x794c7630, 0x3153464a, 0x52654973,
]);
/**
 * Whether this SQLite has the fix for the write-ahead-log reset bug (database
 * corruption when two connections write or checkpoint at the same instant;
 * SQLite 3.7.0 through 3.51.2, and the withdrawn 3.52.0). Fixed in 3.51.3 and
 * 3.53.0 and later, with backports 3.50.7 and 3.44.6. An unknown or
 * unparsable version counts as not fixed.
 */
export function sqliteWalResetFixed(version: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(version ?? "");
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  if (major !== 3) return major > 3;
  if (minor >= 53) return true;
  const firstFixed: Record<number, number> = { 51: 3, 50: 7, 44: 6 };
  return firstFixed[minor] !== undefined && patch >= firstFixed[minor];
}
/** Whether a database file in `directory` may use a write-ahead log: Linux
 * local filesystems only, with a SQLite that has the write-ahead-log reset
 * fix. Elsewhere (other systems, network filesystems, an unreadable
 * filesystem type, an older SQLite) the rollback journal is kept. */
export function writeAheadLogSafe(
  directory: string,
  sqliteVersion: string | undefined = process.versions.sqlite,
): boolean {
  if (process.platform !== "linux" || !sqliteWalResetFixed(sqliteVersion))
    return false;
  try {
    return sharedMemoryFilesystems.has(statfsSync(directory).type);
  } catch {
    return false;
  }
}
/**
 * Journal mode for one writable connection to a rebuildable database whose
 * trust comes from a completion record (the graph), chosen before its first
 * write. A write-ahead log with synchronous=NORMAL commits without a sync;
 * after a crash or power loss the database is the state after some prefix of
 * its commits, never a mixture. The switch into the log never waits: if
 * another connection prevents it, the connection keeps the rollback journal
 * with full syncs. Where a write-ahead log is not safe, this connection never
 * writes in one: a log left by a killed run is checkpointed and removed first,
 * waiting for other connections up to the writer wait, and otherwise the write
 * fails as "database is locked". The SQLite version is the connection's own
 * engine (`sqlite_version()`), unless a test supplies one.
 */
export function openWriteAheadLog(
  db: DatabaseSync,
  file: string,
  sqliteVersion: string | undefined = String(
    db.prepare("SELECT sqlite_version() AS version").get()!.version,
  ),
): boolean {
  const safe =
    file !== ":memory:" &&
    !file.startsWith("file:") &&
    writeAheadLogSafe(dirname(file), sqliteVersion);
  if (!safe) {
    leaveWriteAheadLog(db);
    return false;
  }
  const mode = switchJournal(db, "WAL");
  // A checkpoint syncs the log and the database. Every 10,000 pages (40 MB
  // of log) instead of SQLite's 1,000 took a cold restic index from 73 s to
  // 52 s, the same as with no sync at all (evidence/c-6). C-37 measured
  // 25,000 to 100,000 pages with batched commits: no faster, and the log
  // grew by the interval (to 499 MiB on Vector at 100,000).
  if (mode === "wal")
    db.exec("PRAGMA synchronous=NORMAL; PRAGMA wal_autocheckpoint=10000");
  return mode === "wal";
}
/**
 * Leave a write-ahead log (SQLite does not apply its busy wait to this), so
 * that a connection that must not use one never writes in it. Retries while
 * another connection is open, up to this connection's writer wait.
 */
function leaveWriteAheadLog(db: DatabaseSync): void {
  if (switchJournal(db, "DELETE") !== "wal") return;
  const wait = Number(db.prepare("PRAGMA busy_timeout").get()!.timeout);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; waited < wait; waited += 50) {
    Atomics.wait(pause, 0, 0, 50);
    if (switchJournal(db, "DELETE") !== "wal") return;
  }
  throw Error(
    "database is locked: another connection holds the graph's write-ahead log, which this SQLite must not write in",
  );
}
/**
 * Back to the rollback journal before closing the last connection, so a store
 * at rest has the same format as one written with a rollback journal: readers
 * in a directory they cannot write, and older builds, open it as before.
 * Another open connection keeps the log until the last writer closes. The
 * switch's own transaction runs with a full sync, as every rollback-journal
 * commit does.
 */
export function closeWriteAheadLog(db: DatabaseSync): void {
  db.exec("PRAGMA synchronous=FULL");
  switchJournal(db, "DELETE");
}
function switchJournal(db: DatabaseSync, mode: "WAL" | "DELETE"): string {
  const wait = db.prepare("PRAGMA busy_timeout").get()!.timeout as number;
  db.exec("PRAGMA busy_timeout=0");
  try {
    return db.prepare(`PRAGMA journal_mode=${mode}`).get()!
      .journal_mode as string;
  } catch {
    // "database is locked": another connection is open; keep the current mode.
    return db.prepare("PRAGMA journal_mode").get()!.journal_mode as string;
  } finally {
    db.exec(`PRAGMA busy_timeout=${Number(wait)}`);
  }
}
export function storageDirectory(
  root: string,
  item: StorageItem,
  create = false,
): string {
  return dirname(storagePath(root, item, create));
}
