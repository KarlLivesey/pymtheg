// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import type {
  GraphFile,
  GraphLibrary,
  GraphLink,
  GraphSymbol,
  LibraryEvidence,
  LibraryTarget,
} from "./types.js";
export const contentHash = (text: string | Uint8Array): string =>
  createHash("sha256").update(text).digest("hex");
const digest = (parts: unknown[]): string => contentHash(JSON.stringify(parts));
export function fileFacts(
  projectId: string,
  file: GraphFile,
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
  const range = (value: import("./types.js").SourceRange) => {
    if (
      !Number.isInteger(value.start) ||
      !Number.isInteger(value.end) ||
      value.start < 0 ||
      value.end < value.start ||
      value.end > text.length
    )
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
 * What each evidence kind can prove. `symbol: false`: it names the unit only.
 * `definite: false`: it only makes the target possible (candidate sets only).
 */
export const libraryEvidence: Readonly<
  Record<LibraryEvidence, { symbol: boolean; definite: boolean }>
> = {
  "import-path": { symbol: false, definite: true },
  "import-binding": { symbol: true, definite: true },
  "qualified-path": { symbol: true, definite: true },
  "explicit-trait": { symbol: true, definite: true },
  "declared-builtin": { symbol: true, definite: true },
  "reference-directive": { symbol: false, definite: true },
  "glob-import": { symbol: true, definite: false },
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
): GraphLibrary {
  const known = ["ecosystem", "unit", "symbol", "version", "evidence"];
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
  if (definite && !evidence.definite)
    throw Error(
      `Library evidence ${value.evidence} only supports a candidate set`,
    );
  return {
    id: `library:${digest(["v1", value.ecosystem, value.unit, value.version ?? null, value.symbol ?? null])}`,
    ecosystem: value.ecosystem,
    unit: value.unit,
    ...(value.symbol === undefined ? {} : { symbol: value.symbol }),
    ...(value.version === undefined ? {} : { version: value.version }),
    evidence: value.evidence,
  };
}
