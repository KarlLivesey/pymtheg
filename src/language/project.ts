// SPDX-License-Identifier: MIT
import { sourceIncluded } from "./source-selection.js";
import {
  sourceDirectoryExcluded,
  directoryMayContainSource,
  type SourcePolicy,
} from "../shared/source-policy.js";
import { compareText } from "../shared/order.js";
import { statSync, realpathSync, readdirSync } from "node:fs";
import { readSourceBytes, readSourceBytesSync } from "../shared/source-read.js";
import { sourceFileByteLimit } from "../shared/source-limits.js";
import { resolve, dirname, extname, relative, isAbsolute } from "node:path";
import { hash, finding, identity, type Finding } from "../shared/identity.js";
import { parse } from "./parser.js";
import { decodeUtf8 } from "../shared/text.js";
import type { Parsed } from "./ast.js";
export { sourceFileByteLimit } from "../shared/source-limits.js";
export interface Source {
  file: string;
  text: string;
  hash: string;
  lines: number[];
  parsed: Parsed;
  imports: string[];
  recovered: boolean;
}
export interface Snapshot {
  id: string;
  root?: string;
  selectedFiles?: string[];
  sources: Source[];
  diagnostics: Finding[];
  measurements: {
    bytes: number;
    files: number;
    tokens: number;
    parses: number;
    discoveryParses?: number;
    discoveryEntries?: number;
    discoveryDirectories?: number;
  };
}
export interface SourceOptions {
  additionalEntries?: string[];
  buffers?: Record<string, string>;
  root?: string;
  projectWide?: boolean;
  related?: boolean;
  sourcePolicy?: SourcePolicy;
}
export function loadProject(
  entry: string,
  options: SourceOptions = {},
): Snapshot {
  const sources = new Map<string, Source>(),
    diagnostics: Finding[] = [],
    active = new Set<string>();
  const parsedCache = new Map<
    string,
    { text: string; result: ReturnType<typeof parse> }
  >();
  let bytes = 0,
    tokens = 0,
    discoveryEntries = 0,
    discoveryDirectories = 0;
  function visit(input: string): string {
    const absolute = resolve(input);
    let file: string;
    try {
      file = realpathSync(absolute);
    } catch (e) {
      if (options.buffers && Object.hasOwn(options.buffers, absolute))
        file = absolute;
      else if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw Error(
          "Source file was not found: " +
            (relative(options.root ?? dirname(resolve(entry)), absolute) ||
              ".") +
            ". Check the import path or provide the missing file in buffers.",
        );
      else throw e;
    }
    if (options.root) {
      const child = relative(realpathSync(options.root), file);
      if (
        child === ".." ||
        child.startsWith("../") ||
        child.startsWith("..\\") ||
        isAbsolute(child)
      )
        throw Error("Source is outside the project root");
    }

    if (active.has(file)) {
      const existing = sources.get(file);
      if (existing) existing.recovered = true;
      diagnostics.push(
        finding("L002", "Import cycles are unsupported", {
          file,
          start: 0,
          end: 0,
        }),
      );
      return file;
    }
    if (sources.has(file)) return file;
    if (sources.size >= 2048)
      throw Error(
        "Selected analysis exceeds 2,048 source files; narrow sources.include/exclude or use entry scope",
      );
    if (extname(file) !== identity.extension)
      throw Error(`Expected ${identity.extension} source: ${file}`);
    let text = "",
      stable = false;
    const cached = parsedCache.get(file);
    if (cached) {
      text = cached.text;
      stable = true;
    }
    if (options.buffers && Object.hasOwn(options.buffers, file)) {
      text = options.buffers[file]!;
      stable = true;
      if (Buffer.byteLength(text) > sourceFileByteLimit)
        throw Error("File size limit (2 MiB) exceeded");
    }
    for (let attempt = 0; !stable && attempt < 2; attempt++) {
      const before = statSync(file);
      if (before.size > sourceFileByteLimit)
        throw Error("File size limit (2 MiB) exceeded");
      text = decodeUtf8(readSourceBytesSync(file), file);
      const after = statSync(file);
      if (
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ino === after.ino
      ) {
        stable = true;
        break;
      }
    }
    if (!stable) throw Error(`Unstable source while reading: ${file}`);
    bytes += Buffer.byteLength(text);
    if (bytes > 8 * 1024 * 1024)
      throw Error("Project size limit (8 MiB) exceeded");
    const result = cached?.text === text ? cached.result : parse(file, text);
    parsedCache.set(file, { text, result });
    tokens += result.tokenCount;
    diagnostics.push(...result.diagnostics);
    const lines = [0];
    for (let p = 0; p < text.length; p++)
      if (text[p] === "\n") lines.push(p + 1);
    const source: Source = {
      file,
      text,
      hash: hash(text),
      lines,
      parsed: result,
      imports: [],
      recovered: result.diagnostics.length > 0,
    };
    sources.set(file, source);
    active.add(file);
    for (const imp of result.imports) {
      try {
        source.imports.push(visit(resolve(dirname(file), imp.path)));
      } catch (e) {
        diagnostics.push(finding("L001", String(e), imp.span));
        source.recovered = true;
      }
    }
    active.delete(file);
    return file;
  }
  visit(entry);
  for (const file of options.additionalEntries ?? []) {
    try {
      visit(file);
    } catch (error) {
      diagnostics.push(
        finding("L001", String(error), { file, start: 0, end: 0 }),
      );
    }
  }
  const selectedFiles = [...sources.keys()];
  const selectedPaths = new Set(selectedFiles);
  if (options.related) {
    if (!options.root) throw Error("Caller discovery requires a project root");
    const root = realpathSync(options.root),
      entries = new Set<string>(Object.keys(options.buffers ?? {}));
    let scannedBytes = 0,
      limited = false;
    const warn = (file: string, reason: string) =>
      diagnostics.push(
        finding(
          "L003",
          `Skipped from caller discovery: ${reason}`,
          { file, start: 0, end: 0 },
          "warning",
        ),
      );
    const directories = [root];
    for (let index = 0; index < directories.length && !limited; index++) {
      const dir = directories[index]!;
      discoveryDirectories++;
      let items: import("node:fs").Dirent[];
      try {
        items = readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        warn(dir, error instanceof Error ? error.message : String(error));
        continue;
      }
      for (const item of items.sort((a, b) => compareText(a.name, b.name))) {
        discoveryEntries++;
        if (sourceDirectoryExcluded(item.name, options.sourcePolicy)) continue;
        const path = resolve(dir, item.name);
        if (item.isDirectory()) {
          if (
            directoryMayContainSource(
              relative(root, path),
              options.sourcePolicy,
            )
          )
            directories.push(path);
        } else if (
          item.isFile() &&
          extname(path) === identity.extension &&
          sourceIncluded(relative(root, path), options.sourcePolicy)
        )
          entries.add(path);
        if (entries.size > 10000) {
          limited = true;
          break;
        }
      }
    }
    const reverse = new Map<string, Set<string>>();
    for (const file of [...entries].sort()) {
      if (
        !sourceIncluded(relative(root, file), options.sourcePolicy) &&
        !sources.has(file)
      )
        continue;
      try {
        let cached = parsedCache.get(file);
        if (!cached) {
          const buffer = options.buffers?.[file];
          if (buffer === undefined && statSync(file).size > sourceFileByteLimit)
            throw Error("file exceeds 2 MiB");
          const text = buffer ?? decodeUtf8(readSourceBytesSync(file), file);
          scannedBytes += Buffer.byteLength(text);
          if (scannedBytes > 32 * 1024 * 1024) {
            limited = true;
            break;
          }
          cached = { text, result: parse(file, text) };
          parsedCache.set(file, cached);
        }
        for (const imported of cached.result.imports) {
          let target = resolve(dirname(file), imported.path);
          try {
            target = realpathSync(target);
          } catch {
            /* virtual or missing imports retain their path */
          }
          const users = reverse.get(target) ?? new Set<string>();
          users.add(file);
          reverse.set(target, users);
        }
      } catch (error) {
        warn(file, error instanceof Error ? error.message : String(error));
      }
    }
    if (limited)
      warn(
        root,
        "inventory limit reached; configure sources.include/exclude to narrow discovery",
      );
    const queue = [...sources.keys()],
      seen = new Set(queue);
    for (let i = 0; i < queue.length; i++)
      for (const caller of reverse.get(queue[i]!) ?? [])
        if (!seen.has(caller)) {
          seen.add(caller);
          queue.push(caller);
          visit(caller);
        }
    for (const [file, cached] of parsedCache)
      if (!selectedPaths.has(file) && cached.result.diagnostics.length)
        warn(
          file,
          "syntax errors may hide declarations or dependencies; repair this file for complete caller discovery",
        );
  }
  if (options.projectWide) {
    if (!options.root)
      throw Error("Project-wide checking requires a project root");
    const entries = new Set<string>(Object.keys(options.buffers ?? {}));
    const discover = (dir: string): void => {
      discoveryDirectories++;
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        discoveryEntries++;
        if (sourceDirectoryExcluded(item.name, options.sourcePolicy)) continue;
        const path = resolve(dir, item.name);
        if (item.isDirectory()) {
          if (
            directoryMayContainSource(
              relative(options.root!, path),
              options.sourcePolicy,
            )
          )
            discover(path);
        } else if (
          item.isFile() &&
          extname(path) === identity.extension &&
          sourceIncluded(relative(options.root!, path), options.sourcePolicy)
        )
          entries.add(path);
        if (entries.size > 2048)
          throw Error(
            "Selected analysis exceeds 2,048 source files; narrow sources.include/exclude",
          );
      }
    };
    discover(options.root);
    for (const file of [...entries].sort()) visit(file);
  }
  const ordered = [...sources.values()].sort((a, b) =>
    compareText(a.file, b.file),
  );
  return {
    ...(options.related ? { selectedFiles } : {}),
    ...(options.root ? { root: realpathSync(options.root) } : {}),
    id: hash(ordered.map((s) => s.file + "\0" + s.hash).join("\n")),
    sources: ordered,
    diagnostics,
    measurements: {
      bytes,
      files: ordered.length,
      tokens,
      parses: ordered.length,
      discoveryParses: Math.max(0, parsedCache.size - ordered.length),
      ...(options.related || options.projectWide
        ? { discoveryEntries, discoveryDirectories }
        : {}),
    },
  };
}
export function staleFiles(snapshot: Snapshot): string[] {
  return staleSources(snapshot.sources);
}
export function staleSources(
  sources: ReadonlyArray<{ file: string; hash: string }>,
): string[] {
  return sources
    .filter((s) => {
      try {
        return hash(decodeUtf8(readSourceBytesSync(s.file), s.file)) !== s.hash;
      } catch {
        return true;
      }
    })
    .map((s) => s.file);
}

/** Coordinator-safe freshness checks: bounded regular files, no blocking FIFO open. */
export async function staleSourcesAsync(
  sources: ReadonlyArray<{ file: string; hash: string }>,
  signal: AbortSignal,
): Promise<string[]> {
  const stale: string[] = [];
  for (const source of sources) {
    signal.throwIfAborted();
    try {
      const bytes = await readSourceBytes(source.file, signal);
      signal.throwIfAborted();
      if (hash(decodeUtf8(bytes, source.file)) !== source.hash)
        stale.push(source.file);
    } catch {
      signal.throwIfAborted();
      stale.push(source.file);
    }
  }
  return stale;
}
