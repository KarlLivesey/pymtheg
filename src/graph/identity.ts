import { createHash } from "node:crypto";
import type { GraphFile, GraphLink, GraphSymbol } from "./types.js";
export const contentHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
const digest = (parts: unknown[]): string => contentHash(JSON.stringify(parts));
export function fileFacts(
  projectId: string,
  file: GraphFile,
): { symbols: GraphSymbol[]; links: GraphLink[] } {
  const symbols = file.result.symbols.map((symbol) => ({
    ...symbol,
    id: `symbol:${digest(["v1", projectId, file.module, file.path, symbol.kind, symbol.name, symbol.range.start])}`,
    file: file.path,
    module: file.module,
  }));
  const keys = new Map(symbols.map((symbol) => [symbol.key, symbol.id]));
  const links: GraphLink[] = file.result.links.map((link, index) => ({
    ...link,
    id: `link:${digest(["v1", projectId, file.module, file.path, index])}`,
    file: file.path,
    module: file.module,
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
  const identities = new Set<string>();
  for (const symbol of result.symbols) {
    range(symbol.range);
    const identity = JSON.stringify([
      symbol.kind,
      symbol.name,
      symbol.range.start,
    ]);
    if (
      !symbol.key ||
      !symbol.name ||
      !symbol.kind ||
      keys.has(symbol.key) ||
      identities.has(identity)
    )
      throw Error("Duplicate or empty symbol identity/key");
    keys.add(symbol.key);
    identities.add(identity);
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
