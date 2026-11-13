/** Local storage boundary. Feature stores own schemas, transactions and queries;
 * only this module chooses project locations and opens SQLite connections. */
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";

import { layout, type StorageItem } from "./layout.js";
export { layout, type StorageItem } from "./layout.js";
const legacy = [
  ".pymtheg.json",
  ".pymtheg-architecture",
  ".pymtheg-studio",
  ".pymtheg-implementation-links.json",
  ".pymtheg-observed-code.json",
  ".pymtheg-heading-identities.json",
  ".pymtheg-source-contracts.json",
];
export function assertCurrentLayout(root: string): void {
  const found = legacy.filter((name) => {
    try {
      lstatSync(resolve(root, name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });
  if (found.length)
    throw Error(
      `Old Pymtheg storage layout at ${root}: ${found.join(", ")}. No migration is provided. Preserve/export this data with the old version before creating a new project; nothing was changed.`,
    );
}
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
  assertCurrentLayout(root);
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
/** Explicit paths support temporary immutable snapshots and the graph's existing
 * public constructor. Production project callers obtain paths via storagePath. */
export function openDatabase(
  file: string,
  options?: DatabaseSyncOptions,
): DatabaseSync {
  if (file !== ":memory:" && !file.startsWith("file:"))
    validateDatabaseFiles(file);
  return new DatabaseSync(file, options ?? {});
}
export function storageDirectory(
  root: string,
  item: StorageItem,
  create = false,
): string {
  return dirname(storagePath(root, item, create));
}
