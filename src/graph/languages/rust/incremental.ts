// SPDX-License-Identifier: MIT
import { contentHash } from "../../identity.js";
import type { Json, ParseResult } from "../../types.js";

/**
 * C-36: link kinds the Rust resolver only decides. No other file's lookup,
 * index or annotation reads them: cross-file reads go through symbols, file
 * data and the `imports`, `contains`, `macros` and `modules` links. Any other
 * kind, including one added later, counts as part of the surface.
 */
const FILE_LOCAL_LINKS = new Set([
  "calls",
  "values",
  "types",
  "patterns",
  "implements",
]);

const itemOffset = (key: unknown): number | undefined => {
  const match = typeof key === "string" ? /^item:(\d+)$/.exec(key) : null;
  return match ? Number(match[1]) : undefined;
};
type Record_ = Record<string, Json>;
const record = (value: unknown): Record_ =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record_)
    : {};

/**
 * The facts another file's resolution can read from this file, as one hash.
 * Source offsets appear only as their rank among this file's surface
 * offsets: the resolver orders and matches a file's positions, and never
 * measures or compares them with another file's. Only fields known to hold
 * offsets are ranked; any other value is hashed as written, so an unlisted
 * offset can only make the surface differ. Each surface link keeps its index
 * in the file's link list, which fixes its store id and so the order in which
 * the resolver meets it. Undefined for a file that is not clean.
 */
export function rustSurface(result: ParseResult): string | undefined {
  if (result.status !== "clean") return undefined;
  const links = result.links
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => !FILE_LOCAL_LINKS.has(link.kind));
  const data = record(result.data);
  const offsets = new Set<number>();
  const keep = (value: unknown) => {
    if (typeof value === "number") offsets.add(value);
  };
  for (const symbol of result.symbols) {
    keep(symbol.range.start);
    keep(symbol.range.end);
    keep(itemOffset(symbol.key));
  }
  for (const { link } of links) {
    const facts = record(link.data);
    keep(link.range.start);
    keep(link.range.end);
    keep(itemOffset(link.sourceKey));
    keep(itemOffset(facts.key));
    keep(facts.libraryAttributeStart);
  }
  const starts = (name: string) =>
    Array.isArray(data[name])
      ? (data[name] as Json[]).map((entry) => record(entry).start)
      : [];
  for (const start of [
    ...starts("opaqueAttributes"),
    ...starts("standardMacroScopes"),
  ])
    keep(start);
  const ranks = new Map(
    [...offsets].sort((a, b) => a - b).map((offset, rank) => [offset, rank]),
  );
  const rank = (value: unknown) =>
    typeof value === "number" ? ["@", ranks.get(value)!] : value;
  const rankKey = (key: unknown) => {
    const offset = itemOffset(key);
    return offset === undefined ? key : ["item@", ranks.get(offset)!];
  };
  const rankStarts = (name: string) =>
    Array.isArray(data[name])
      ? (data[name] as Json[]).map((entry) => {
          const fields = record(entry);
          return "start" in fields
            ? { ...fields, start: rank(fields.start) }
            : entry;
        })
      : data[name];
  return contentHash(
    JSON.stringify([
      result.status,
      result.failureKind ?? null,
      result.diagnostics,
      {
        ...data,
        opaqueAttributes: rankStarts("opaqueAttributes"),
        standardMacroScopes: rankStarts("standardMacroScopes"),
      },
      result.symbols.map((symbol) => [
        rankKey(symbol.key),
        symbol.name,
        symbol.kind,
        symbol.identity,
        rank(symbol.range.start),
        rank(symbol.range.end),
        symbol.data ?? null,
      ]),
      links.map(({ link, index }) => {
        const facts = record(link.data);
        return [
          index,
          link.kind,
          link.targetName,
          rankKey(link.sourceKey),
          rank(link.range.start),
          rank(link.range.end),
          link.data === undefined
            ? null
            : {
                ...facts,
                ...("key" in facts ? { key: rankKey(facts.key) } : {}),
                ...("libraryAttributeStart" in facts
                  ? {
                      libraryAttributeStart: rank(facts.libraryAttributeStart),
                    }
                  : {}),
              },
        ];
      }),
    ]),
  );
}
