// SPDX-License-Identifier: MIT
import { sourceFileByteLimit } from "../shared/source-limits.js";
import { opendir, realpath, lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { setImmediate as yieldToCoordinator } from "node:timers/promises";
import { sourceDirectoryExcluded } from "../shared/source-policy.js";
import { hash } from "../shared/identity.js";
import { implementationFilesQuerySchema } from "./protocol.js";

export const implementationSourcePath = (path: string) =>
  /\.(?:[cm]?[tj]s|[tj]sx)$/i.test(path);
export const implementationFileLimits = {
  maxFiles: 10000,
  maxDirectories: 5000,
  maxEntries: 100000,
} as const;
export interface ImplementationFileInventory {
  id: string;
  directory: string;
  files: string[];
  complete: boolean;
  warnings: string[];
  visitedEntries: number;
  visitedDirectories: number;
  ignoredSymlinks: number;
  warningCount: number;
}
type DiscoveryOptions = Partial<
  Record<keyof typeof implementationFileLimits, number>
> & {
  onDirectory?: (progress: {
    visitedEntries: number;
    visitedDirectories: number;
  }) => void;
};
/** Read-only metadata discovery; source bytes remain the capture worker's concern. */
export async function discoverImplementationFiles(
  root: string,
  directory: string,
  signal: AbortSignal,
  options: DiscoveryOptions = {},
): Promise<ImplementationFileInventory> {
  signal.throwIfAborted();
  if (
    isAbsolute(directory) ||
    directory.includes("\\") ||
    directory.split("/").includes("..")
  )
    throw Error("Choose a directory inside the project.");
  try {
    root = await realpath(root);
  } catch {
    signal.throwIfAborted();
    throw Error(
      "The project folder could not be opened. Check its path and read permission.",
    );
  }
  signal.throwIfAborted();
  let start: string;
  try {
    start = await realpath(resolve(root, directory));
  } catch {
    signal.throwIfAborted();
    throw Error(
      `Folder ${JSON.stringify(directory)} could not be opened. Choose an existing folder inside the project.`,
    );
  }
  const scope = relative(root, start).replaceAll("\\", "/") || ".";
  if (isAbsolute(scope) || scope === ".." || scope.startsWith("../"))
    throw Error("Choose a directory inside the project.");
  const limits = { ...implementationFileLimits, ...options };
  for (const key of ["maxFiles", "maxDirectories", "maxEntries"] as const)
    if (
      !Number.isInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > implementationFileLimits[key]
    )
      throw Error("Invalid implementation discovery limit");
  const directories = [start],
    files: string[] = [],
    warnings: string[] = [];
  let visitedEntries = 0,
    visitedDirectories = 0,
    ignoredSymlinks = 0,
    omittedDirectories = 0,
    warningCount = 0,
    complete = true,
    stop = false;
  const portable = (path: string) =>
    relative(root, path).replaceAll("\\", "/") || ".";
  const warn = (message: string) => {
    complete = false;
    warningCount++;
    if (warnings.length < 100) warnings.push(message);
  };
  for (let index = 0; index < directories.length && !stop; index++) {
    signal.throwIfAborted();
    const path = directories[index]!,
      children: string[] = [],
      candidates: string[] = [];
    visitedDirectories++;
    try {
      const handle = await opendir(path);
      for await (const entry of handle) {
        signal.throwIfAborted();
        if (visitedEntries >= limits.maxEntries) {
          warn("Directory-entry limit reached; discovery is incomplete.");
          stop = true;
          break;
        }
        visitedEntries++;
        if (visitedEntries % 256 === 0) {
          await yieldToCoordinator();
          signal.throwIfAborted();
        }
        if (entry.isSymbolicLink()) {
          ignoredSymlinks++;
          continue;
        }
        const child = resolve(path, entry.name);
        if (entry.name.includes("\uFFFD")) {
          warn("A filename could not be represented reliably; it was omitted.");
          continue;
        }
        if (entry.isDirectory() && !sourceDirectoryExcluded(entry.name)) {
          if (directories.length + children.length < limits.maxDirectories)
            children.push(child);
          else omittedDirectories++;
        } else if (entry.isFile() && implementationSourcePath(entry.name)) {
          if (files.length + candidates.length >= limits.maxFiles) {
            warn("Implementation file limit reached; discovery is incomplete.");
            stop = true;
            break;
          }
          const metadata = await lstat(child);
          if (metadata.size > sourceFileByteLimit) {
            warningCount++;
            if (warnings.length < 100)
              warnings.push(
                `${portable(child)} (${metadata.size} bytes) exceeds the 2 MiB code capture limit and will be omitted with partial coverage. Exclude generated/vendor bundles or split the file.`,
              );
          }
          candidates.push(portable(child));
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
      if (index === 0)
        throw Error(`Could not list the selected project directory (${code}).`);
      warn(`Could not list ${portable(path)} (${code}).`);
    }
    const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    files.push(...candidates.sort(order));
    directories.push(...children.sort(order));
    options.onDirectory?.({ visitedEntries, visitedDirectories });
    signal.throwIfAborted();
  }
  if (omittedDirectories)
    warn(
      `Directory limit reached; ${omittedDirectories} additional directories were not followed.`,
    );
  if (ignoredSymlinks)
    warn(
      `${ignoredSymlinks} symbolic link${ignoredSymlinks === 1 ? " was" : "s were"} not followed. Select regular source files explicitly if needed.`,
    );
  const result = {
    directory: scope,
    files,
    complete,
    warnings,
    warningCount,
    visitedEntries,
    visitedDirectories,
    ignoredSymlinks,
  };
  return { id: hash(JSON.stringify(result)), ...result };
}

/** Session-scoped metadata pages; a page never performs another directory scan. */
export class ImplementationFileCatalog {
  private readonly inventories = new Map<string, ImplementationFileInventory>();
  constructor(private readonly root: string) {}
  async page(value: unknown, signal: AbortSignal) {
    const query = implementationFilesQuerySchema.parse(value);
    signal.throwIfAborted();
    const inventory = query.inventoryId
      ? this.inventories.get(query.inventoryId)
      : await discoverImplementationFiles(
          this.root,
          query.directory ?? ".",
          signal,
        );
    if (!inventory)
      throw Error(
        "This code-file inventory expired. Refresh the file list and use its new inventoryId.",
      );
    if (
      query.inventoryId &&
      query.directory !== undefined &&
      query.directory !== inventory.directory
    )
      throw Error(
        "This inventory belongs to another directory. Refresh before changing its scope.",
      );
    if (!query.inventoryId) {
      this.inventories.delete(inventory.id);
      this.inventories.set(inventory.id, inventory);
      while (this.inventories.size > 3)
        this.inventories.delete(this.inventories.keys().next().value!);
    }
    const match = query.query.toLowerCase(),
      files: string[] = [];
    for (let i = 0; i < inventory.files.length; i++) {
      if (i % 256 === 0) {
        await yieldToCoordinator();
        signal.throwIfAborted();
      }
      if (inventory.files[i]!.toLowerCase().includes(match))
        files.push(inventory.files[i]!);
    }
    const page = files.slice(query.offset, query.offset + query.limit);
    return {
      inventoryId: inventory.id,
      directory: inventory.directory,
      query: query.query,
      files: page,
      total: files.length,
      inventoryTotal: inventory.files.length,
      offset: query.offset,
      nextOffset:
        query.offset + page.length < files.length
          ? query.offset + page.length
          : null,
      complete: inventory.complete,
      warnings: inventory.warnings,
      warningCount: inventory.warningCount,
      visitedEntries: inventory.visitedEntries,
      visitedDirectories: inventory.visitedDirectories,
      ignoredSymlinks: inventory.ignoredSymlinks,
      meaning:
        "Candidate regular TS/JS paths only. Contents were not read or checked. Hidden, dependency and generated directories are excluded; capture revalidates selected files.",
    };
  }
  clear() {
    this.inventories.clear();
  }
}
