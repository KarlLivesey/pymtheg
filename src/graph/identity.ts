// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import type {
  GraphFile,
  GraphLibrary,
  GraphLink,
  GraphSymbol,
  LibraryEvidence,
  LibraryTarget,
  SourceRange,
} from "./types.js";
export const contentHash = (text: string | Uint8Array): string =>
  createHash("sha256").update(text).digest("hex");
const digest = (parts: unknown[]): string => contentHash(JSON.stringify(parts));
export function fileFacts(
  projectId: string,
  file: Pick<GraphFile, "path" | "module" | "result">,
): { symbols: GraphSymbol[]; links: GraphLink[] } {
  const ordinals = new Map<string, number>();
  const ordered = [...file.result.symbols].sort(
    (a, b) =>
      a.range.start - b.range.start ||
      a.range.end - b.range.end ||
      compare(a.key, b.key),
  );
  const assigned = new Map<string, number>();
  for (const symbol of ordered) {
    const group = JSON.stringify([symbol.kind, symbol.identity]);
    const ordinal = ordinals.get(group) ?? 0;
    assigned.set(symbol.key, ordinal);
    ordinals.set(group, ordinal + 1);
  }
  const symbols = file.result.symbols.map((symbol) => ({
    ...symbol,
    id: `symbol:${digest(["v2", projectId, file.module, file.path, symbol.kind, symbol.identity, assigned.get(symbol.key)])}`,
    ordinal: assigned.get(symbol.key)!,
    file: file.path,
    module: file.module,
    status: file.result.status,
  }));
  const keys = new Map(symbols.map((symbol) => [symbol.key, symbol.id]));
  const links: GraphLink[] = file.result.links.map((link, index) => ({
    ...link,
    id: `link:${digest(["v1", projectId, file.module, file.path, index])}`,
    file: file.path,
    module: file.module,
    origin: "parse" as const,
    sourceStatus: file.result.status,
    targetStatus: null,
    candidates: [],
    sourceId: link.sourceKey === null ? null : keys.get(link.sourceKey)!,
    targetId: null,
    resolution: "unresolved",
  }));
  return { symbols, links };
}
export const validSourceRange = (value: SourceRange, length: number): boolean =>
  Number.isInteger(value.start) &&
  Number.isInteger(value.end) &&
  value.start >= 0 &&
  value.end >= value.start &&
  value.end <= length;

export function validateResult(
  text: string,
  result: import("./types.js").ParseResult,
): void {
  if (!["clean", "partial", "failed"].includes(result.status))
    throw Error("Invalid parse status");
  if (
    result.failureKind !== undefined &&
    !["content", "transient"].includes(result.failureKind)
  )
    throw Error("Invalid parse failure kind");
  if (result.status !== "clean" && !result.diagnostics.length)
    throw Error("Incomplete parse needs a diagnostic");
  const range = (value: SourceRange) => {
    if (!validSourceRange(value, text.length))
      throw Error("Invalid UTF-16 range");
  };
  const keys = new Set<string>();

  for (const symbol of result.symbols) {
    range(symbol.range);
    if (
      !symbol.key ||
      !symbol.name ||
      !symbol.kind ||
      !symbol.identity ||
      keys.has(symbol.key)
    )
      throw Error("Duplicate or empty symbol identity/key");
    keys.add(symbol.key);
  }
  for (const link of result.links) {
    range(link.range);
    // Library targets are decisions (resolve or analysis), never parse facts.
    if (Object.hasOwn(link, "libraries"))
      throw Error("Parse links cannot carry library targets");
    if (
      !link.kind ||
      !link.targetName ||
      (link.sourceKey !== null && !keys.has(link.sourceKey))
    )
      throw Error("Invalid link source/kind/target name");
  }
  for (const diagnostic of result.diagnostics) {
    if (!diagnostic.message) throw Error("Empty diagnostic");
    if (diagnostic.range) range(diagnostic.range);
  }
  // Facts must survive persistence without lossy JSON conversions.
  const ancestors = new Set<object>();
  const json = (value: unknown): void => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || value === null || ancestors.has(value))
      throw Error("Non-JSON parse facts");
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype
    )
      throw Error("Non-JSON parse facts");
    ancestors.add(value);
    for (const item of Object.values(value)) json(item);
    ancestors.delete(value);
  };
  json(result);
}

/** Locale-independent UTF-16 lexicographic order. */
export const compare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export const addedLinkId = (
  project: string,
  module: string,
  file: string,
  key: string,
): string => `link:${digest(["v2", project, module, file, "analysis", key])}`;

/**
 * What each evidence kind can prove. `symbol: false`: it names the unit only;
 * `"required"`: it proves a member, so the symbol must be given.
 * `definite: false`: it only makes the target possible (candidate sets only).
 */
export const libraryEvidence: Readonly<
  Record<LibraryEvidence, { symbol: boolean | "required"; definite: boolean }>
> = {
  "import-path": { symbol: false, definite: true },
  "import-binding": { symbol: true, definite: true },
  "qualified-path": { symbol: true, definite: true },
  "explicit-trait": { symbol: true, definite: true },
  "declared-builtin": { symbol: true, definite: true },
  "reference-directive": { symbol: false, definite: true },
  "glob-import": { symbol: true, definite: false },
  "declaring-owner": { symbol: "required", definite: true },
};
/**
 * The manifests and lockfiles that can state a library version, by file name,
 * per ecosystem. A version's source must be one of its ecosystem's files (a
 * `go.mod` never states an npm version); an ecosystem not listed takes no
 * version. The single list both the indexer's and the store's checks use.
 */
export const versionFiles: Readonly<Record<string, readonly string[]>> = {
  npm: [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "deno.json",
    "deno.lock",
  ],
  node: ["package.json"],
  go: ["go.mod", "go.sum", "go.work", "go.work.sum"],
  "go-std": ["go.mod", "go.work"],
  cargo: ["Cargo.toml", "Cargo.lock"],
};
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value);
/**
 * Checks a module's library target and returns its stored form with a
 * deterministic, project-independent id. The evidence kind is required.
 */
export function libraryTarget(
  value: LibraryTarget,
  definite: boolean,
  /** Whether a path is a clean manifest/lockfile context file in the snapshot. */
  versionSource: (path: string) => boolean = () => false,
): GraphLibrary {
  const known = [
    "ecosystem",
    "unit",
    "symbol",
    "version",
    "versionSource",
    "evidence",
  ];
  const evidence =
    value &&
    typeof value === "object" &&
    Object.hasOwn(libraryEvidence, value.evidence)
      ? libraryEvidence[value.evidence]
      : undefined;
  if (
    !evidence ||
    Object.keys(value).some((key) => !known.includes(key)) ||
    typeof value.ecosystem !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.ecosystem) ||
    !text(value.unit, 1024) ||
    (value.symbol !== undefined && !text(value.symbol, 1024)) ||
    (value.version !== undefined && !text(value.version, 256))
  )
    throw Error(
      "Invalid library target: ecosystem, unit and a known evidence kind are required",
    );
  if (value.symbol !== undefined && !evidence.symbol)
    throw Error(
      `Library evidence ${value.evidence} names a unit, not a symbol`,
    );
  // A version is a fact about the checkout: it must name the manifest or
  // lockfile in the snapshot that states it.
  if ((value.version === undefined) !== (value.versionSource === undefined))
    throw Error(
      "A library version needs the manifest or lockfile that states it, and only with a version",
    );
  if (
    value.versionSource !== undefined &&
    (!text(value.versionSource, 4096) ||
      !versionFiles[value.ecosystem]?.includes(
        value.versionSource.split("/").at(-1)!,
      ))
  )
    throw Error(
      `A library version's source must be one of the ${value.ecosystem} manifests or lockfiles (${(versionFiles[value.ecosystem] ?? []).join(", ") || "none for this ecosystem"})`,
    );
  if (value.versionSource !== undefined && !versionSource(value.versionSource))
    throw Error(
      "A library version's source must be a clean manifest or lockfile in the snapshot",
    );
  if (value.symbol === undefined && evidence.symbol === "required")
    throw Error(`Library evidence ${value.evidence} needs the member's symbol`);
  if (definite && !evidence.definite)
    throw Error(
      `Library evidence ${value.evidence} only supports a candidate set`,
    );
  return {
    id: `library:${digest(["v1", value.ecosystem, value.unit, value.version ?? null, value.symbol ?? null])}`,
    ecosystem: value.ecosystem,
    unit: value.unit,
    ...(value.symbol === undefined ? {} : { symbol: value.symbol }),
    ...(value.version === undefined
      ? {}
      : { version: value.version, versionSource: value.versionSource! }),
    evidence: value.evidence,
  };
}
