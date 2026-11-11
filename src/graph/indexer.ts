import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { contentHash, validateResult } from "./identity.js";
import type {
  GraphFile,
  GraphStorage,
  LanguageModule,
  LinkResolution,
  ParseResult,
} from "./types.js";
import type { LanguageRegistry } from "./registry.js";

export interface IndexReport {
  discovered: number;
  claimed: number;
  indexed: number;
  unchanged: number;
  removed: number;
  symbols: number;
  links: number;
  unresolved: number;
  unclaimedCount: number;
  failedCount: number;
  partialCount: number;
  unclaimed: string[];
  failed: string[];
  partial: string[];
  ignoredSymlinks: string[];
  errors: { path: string; message: string }[];
  resolutionErrors: { module: string; message: string }[];
}
export interface IndexOptions {
  /** Directory basenames skipped anywhere; defaults are merged, never read .codegraph. */
  excludeDirectories?: readonly string[];
  /** Exact project-relative paths (e.g. a caller-selected database inside root). */
  excludeFiles?: readonly string[];
}
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export async function indexProject(
  root: string,
  registry: LanguageRegistry,
  store: GraphStorage,
  options: IndexOptions = {},
): Promise<IndexReport> {
  const report: IndexReport = {
    discovered: 0,
    claimed: 0,
    indexed: 0,
    unchanged: 0,
    removed: 0,
    symbols: 0,
    links: 0,
    unresolved: 0,
    unclaimedCount: 0,
    failedCount: 0,
    partialCount: 0,
    unclaimed: [],
    failed: [],
    partial: [],
    ignoredSymlinks: [],
    errors: [],
    resolutionErrors: [],
  };
  const paths: string[] = [];
  const excluded = new Set([
    ".git",
    "node_modules",
    ".codegraph",
    ...(options.excludeDirectories ?? []),
  ]);
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(join(root, directory), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) report.ignoredSymlinks.push(path);
      else if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) await walk(path);
      } else if (entry.isFile() && !options.excludeFiles?.includes(path))
        paths.push(path);
    }
  }
  // Complete inventory before replacing anything: traversal errors must not delete unseen files.
  await walk("");
  const retained = new Set<string>();
  for (const path of paths) {
    report.discovered++;
    let module: LanguageModule | undefined;
    try {
      module = registry.claim(path);
    } catch (error) {
      report.failed.push(path);
      report.errors.push({ path, message: message(error) });
      continue;
    }
    if (!module) {
      report.unclaimed.push(path);
      continue;
    }
    retained.add(path);
    report.claimed++;
    let text = "";
    let result: ParseResult;
    try {
      text = await readFile(join(root, path), "utf8");
      const previous = await store.getFile(path);
      if (
        previous?.hash === contentHash(text) &&
        previous.result.status !== "failed" &&
        previous.module === module.id &&
        previous.version === module.version
      ) {
        report.unchanged++;
        if (previous.result.status !== "clean")
          report[previous.result.status].push(path);
        continue;
      }
      result = await module.parse({ path, text });
      validateResult(text, result);
    } catch (error) {
      const detail = message(error);
      report.errors.push({ path, message: detail });
      result = {
        status: "failed",
        diagnostics: [{ message: detail }],
        symbols: [],
        links: [],
      };
    }
    if (result.status !== "clean") report[result.status].push(path);
    const file: GraphFile = {
      path,
      text,
      hash: contentHash(text),
      module: module.id,
      version: module.version,
      result,
    };
    await store.replaceFile(file);
    report.indexed++;
  }
  for (const file of await store.files())
    if (!retained.has(file.path)) {
      await store.removeFile(file.path);
      report.removed++;
    }
  {
    // Resolution is retried even after a prior resolver failure; unchanged targets cause no writes.
    const files = await store.files();
    const symbols = await store.findSymbols();
    const links = (await store.links()).map((link) => ({
      ...link,
      targetId: null,
      resolution: "unresolved" as const,
    }));
    const resolutions: LinkResolution[] = [];
    const cleanTargets = new Set(
      symbols
        .filter((symbol) =>
          files.some(
            (file) =>
              file.path === symbol.file && file.result.status === "clean",
          ),
        )
        .map((symbol) => symbol.id),
    );
    for (const module of registry.modules) {
      const own = links.filter((link) => link.module === module.id);
      const ownIds = new Set(own.map((link) => link.id));
      const seen = new Set<string>();
      try {
        const resolved = await module.resolve({ files, symbols, links: own });
        for (const item of resolved) {
          if (
            !ownIds.has(item.linkId) ||
            !cleanTargets.has(item.targetId) ||
            seen.has(item.linkId)
          )
            throw Error(
              "Resolver returned an invalid, duplicate or incomplete target",
            );
          seen.add(item.linkId);
        }
        resolutions.push(...resolved);
      } catch (error) {
        report.resolutionErrors.push({
          module: module.id,
          message: message(error),
        });
      }
    }
    await store.resolveLinks(resolutions);
  }
  report.unclaimedCount = report.unclaimed.length;
  report.failedCount = report.failed.length;
  report.partialCount = report.partial.length;
  report.symbols = (await store.findSymbols()).length;
  report.links = (await store.links()).length;
  report.unresolved = (await store.unresolved()).length;
  return report;
}
