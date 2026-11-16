/** Local storage boundary. Feature stores own schemas, transactions and queries;
 * only this module chooses project locations and opens SQLite connections. */
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
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
export function storageDirectory(
  root: string,
  item: StorageItem,
  create = false,
): string {
  return dirname(storagePath(root, item, create));
}
