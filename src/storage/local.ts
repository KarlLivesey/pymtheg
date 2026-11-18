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
/** Whether a database file in `directory` may use a write-ahead log: Linux
 * local filesystems only. Elsewhere (other systems, network filesystems, an
 * unreadable filesystem type) the rollback journal is kept. */
export function writeAheadLogSafe(directory: string): boolean {
  if (process.platform !== "linux") return false;
  try {
    return sharedMemoryFilesystems.has(statfsSync(directory).type);
  } catch {
    return false;
  }
}
/**
 * Journal mode for one writable connection to a rebuildable database whose
 * trust comes from a completion record (the graph). A write-ahead log with
 * synchronous=NORMAL commits without a sync; after a crash or power loss the
 * database is the state after some prefix of its commits, never a mixture.
 * Where a write-ahead log is not safe, or another connection prevents the
 * switch, the connection keeps the rollback journal with full syncs. The
 * switch never waits: the bounded writer wait is for writes, not for this.
 */
export function openWriteAheadLog(db: DatabaseSync, file: string): boolean {
  const safe =
    file !== ":memory:" &&
    !file.startsWith("file:") &&
    writeAheadLogSafe(dirname(file));
  const mode = switchJournal(db, safe ? "WAL" : "DELETE");
  if (mode === "wal") db.exec("PRAGMA synchronous=NORMAL");
  return mode === "wal";
}
/**
 * Back to the rollback journal before closing the last connection, so a store
 * at rest has the same format as one written with a rollback journal: readers
 * in a directory they cannot write, and older builds, open it as before.
 * Another open connection keeps the log until the last writer closes.
 */
export function closeWriteAheadLog(db: DatabaseSync): void {
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
