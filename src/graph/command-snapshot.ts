// SPDX-License-Identifier: MIT
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compare } from "./identity.js";
import { count, stage } from "./work.js";
import { matchesPattern, type LanguageRegistry } from "./registry.js";
import type { CommandMetadata } from "./command-checkpoint.js";

export interface CapturedPath {
  path: string;
  hash: string;
  module: string | null;
  context: boolean;
  reason: string | null;
}
export interface StaleFile {
  path: string;
  change:
    | "added"
    | "changed"
    | "removed"
    | "module-version"
    | "context"
    | "unreadable";
}
export interface InventoryListing {
  discovered: number;
  unclaimed: string[];
  ignoredSymlinks: string[];
}
export const needsContext = (registry: LanguageRegistry, path: string) =>
  registry.modules.some((m) =>
    m.contextFiles?.some((pattern) => matchesPattern(path, pattern)),
  );
/** Hash original bytes, never rely on mtimes. Stream files and refuse symlinks/FIFOs. */
export async function captureInventory(
  root: string,
  registry: LanguageRegistry,
  signal: AbortSignal,
  listing?: InventoryListing,
): Promise<CapturedPath[]> {
  const output: CapturedPath[] = [];
  // One reusable read buffer for the inventory. Each file is still opened
  // without following symlinks, checked, and read to EOF.
  const buffer = Buffer.allocUnsafe(64 * 1024);
  async function walk(relative: string) {
    signal.throwIfAborted();
    count("inventory.directories");
    const entries = await stage("inventory.readdir", () =>
      readdir(join(root, relative), { withFileTypes: true }),
    );
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        listing?.ignoredSymlinks.push(path);
        continue;
      }
      if (entry.isDirectory()) {
        if (
          ![".git", "node_modules", ".codegraph", ".pymtheg"].includes(
            entry.name,
          )
        )
          await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (listing) listing.discovered++;
      let module: string | null = null;
      let reason: string | null = null;
      try {
        module = registry.claim(path)?.id ?? null;
      } catch (error) {
        reason = String(error);
      }
      const context = needsContext(registry, path);
      if (!module && !context && !reason) {
        listing?.unclaimed.push(path);
        continue;
      }
      let hash = "";
      try {
        const file = await open(
          join(root, path),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          count("inventory.stats");
          if (!(await stage("inventory.stat", () => file.stat())).isFile())
            throw Error("Expected a regular source file");
          const digest = createHash("sha256");
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let valid = true;
          for (;;) {
            signal.throwIfAborted();
            const { bytesRead } = await file.read(buffer);
            signal.throwIfAborted();
            if (bytesRead === 0) break;
            const chunk = buffer.subarray(0, bytesRead);
            digest.update(chunk);
            count("inventory.bytesHashed", chunk.length);
            if (valid)
              try {
                decoder.decode(chunk, { stream: true });
              } catch {
                valid = false;
              }
          }
          if (valid)
            try {
              decoder.decode();
            } catch {
              valid = false;
            }
          hash = digest.digest("hex");
          if (!valid)
            reason = "Unsupported source encoding: expected valid UTF-8";
        } finally {
          await file.close();
        }
      } catch (error) {
        signal.throwIfAborted();
        reason = error instanceof Error ? error.message : String(error);
      }
      count("inventory.filesHashed");
      output.push({ path, hash, module, context, reason });
    }
  }
  await walk("");
  return output.sort((a, b) => compare(a.path, b.path));
}
export function changedFiles(
  current: CapturedPath[],
  metadata: CommandMetadata,
  registry: LanguageRegistry,
): StaleFile[] {
  const sources = new Map(metadata.files.map((f) => [f.path, f]));
  const contexts = new Map(
    metadata.contexts.filter((f) => !f.dependency).map((f) => [f.path, f]),
  );
  const changes = new Map<string, StaleFile>();
  const versions = new Map(registry.modules.map((m) => [m.id, m.version]));
  for (const file of current) {
    if (file.module || (file.reason && !file.context)) {
      const old = sources.get(file.path);
      const change: StaleFile["change"] | null = !old
        ? "added"
        : old.module !== file.module ||
            old.version !== versions.get(file.module!)
          ? "module-version"
          : file.reason && !file.hash
            ? "unreadable"
            : old.hash !== file.hash
              ? "changed"
              : file.reason &&
                  (old.status !== "failed" ||
                    old.diagnostic?.message !== file.reason)
                ? "unreadable"
                : null;
      if (change) changes.set(file.path, { path: file.path, change });
      sources.delete(file.path);
    }
    if (file.context) {
      const old = contexts.get(file.path);
      if (file.reason && !file.hash)
        changes.set(file.path, { path: file.path, change: "unreadable" });
      else if (!old || old.hash !== file.hash)
        changes.set(file.path, { path: file.path, change: "context" });
      else if (
        file.reason &&
        (old.status !== "failed" || old.diagnostic?.message !== file.reason)
      )
        changes.set(file.path, { path: file.path, change: "unreadable" });
      contexts.delete(file.path);
    }
  }
  for (const path of sources.keys())
    changes.set(path, { path, change: "removed" });
  for (const path of contexts.keys())
    changes.set(path, { path, change: "context" });
  return [...changes.values()].sort((a, b) => compare(a.path, b.path));
}
