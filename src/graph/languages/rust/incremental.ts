// SPDX-License-Identifier: MIT
import { contentHash } from "../../identity.js";
import type { Json, ParseResult } from "../../types.js";
import { linkOrder, symbolOrder } from "./order.js";

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
type Fields = Record<string, Json>;
const record = (value: unknown): Fields =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : {};

/**
 * One hash of a clean file's facts with source offsets replaced by their
 * rank among this file's offsets. The resolver orders and matches a file's
 * positions, and never measures them or compares them with another file's.
 * Only fields known to hold offsets are ranked; any other value is hashed as
 * written, so an unlisted offset can only make two fingerprints differ.
 *
 * `surface` keeps what another file's resolution can read: the file data,
 * every symbol, and the links of other than file-local kinds. Symbols and
 * links are listed in the order the resolver meets them (C-24's position
 * order, computed from the written values), so an edit that changes that
 * order changes the fingerprint. A link's index in the file's list fixes only
 * its store id, which no other file's decision reads. `all` keeps every
 * link, for a file whose lookups are the same before and after an edit.
 */
export function rustFingerprint(
  result: ParseResult,
  facts: "surface" | "all",
): string | undefined {
  const text = fingerprintText(result, facts);
  return text === undefined ? undefined : contentHash(text);
}

/** The text {@link rustFingerprint} hashes. */
export function fingerprintText(
  result: ParseResult,
  facts: "surface" | "all",
): string | undefined {
  if (result.status !== "clean") return undefined;
  // In the order the resolver meets them, computed from the written values.
  const links = linkOrder(
    result.links
      .filter((link) => facts === "all" || !FILE_LOCAL_LINKS.has(link.kind))
      .map((link) => ({ ...link, file: "", origin: "parse" })),
  ).map((link) => ({ link }));
  const symbols = symbolOrder(
    result.symbols.map((symbol) => ({ ...symbol, file: "" })),
  );
  const data = record(result.data);
  const offsets = new Set<number>();
  const keep = (value: unknown) => {
    if (typeof value === "number") offsets.add(value);
  };
  const keepSpan = (value: unknown) => {
    keep(record(value).start);
    keep(record(value).end);
  };
  // The file symbol always spans the whole text, from 0 to its length, and
  // serves only as the file's own scope. Ranking its range with the items
  // would tie its start to a first item at offset 0 until a leading comment
  // moves that item.
  const whole = (symbol: { key: string }) => symbol.key === "file";
  for (const symbol of symbols) {
    if (whole(symbol)) continue;
    keepSpan(symbol.range);
    keep(itemOffset(symbol.key));
  }
  for (const { link } of links) {
    const facts = record(link.data);
    keepSpan(link.range);
    keep(itemOffset(link.sourceKey));
    keep(itemOffset(facts.key));
    keep(facts.libraryAttributeStart);
    keepSpan(facts.localBinding);
    keepSpan(facts.typeParameter);
    keep(itemOffset(facts.typeParameterOwner));
    keep(itemOffset(facts.implKey));
    if (Array.isArray(facts.macroArguments))
      for (const start of facts.macroArguments) keep(start);
    let recipe: unknown = facts.receiverExpr;
    while (recipe !== undefined) {
      keep(itemOffset(record(recipe).ik));
      recipe = record(recipe).e;
    }
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
  const rankSpan = (value: Json) => {
    const fields = record(value);
    return { ...fields, start: rank(fields.start), end: rank(fields.end) };
  };
  const rankRecipe = (value: Json): unknown => {
    const fields = record(value);
    return {
      ...fields,
      ...("ik" in fields ? { ik: rankKey(fields.ik) } : {}),
      ...("e" in fields ? { e: rankRecipe(fields.e!) } : {}),
    };
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
  const rankLinkData = (value: Json | undefined) => {
    if (value === undefined) return null;
    const fields = record(value);
    const ranked: Record<string, unknown> = { ...fields };
    for (const name of ["key", "typeParameterOwner", "implKey"])
      if (name in fields) ranked[name] = rankKey(fields[name]);
    if ("libraryAttributeStart" in fields)
      ranked.libraryAttributeStart = rank(fields.libraryAttributeStart);
    for (const name of ["localBinding", "typeParameter"])
      if (name in fields) ranked[name] = rankSpan(fields[name]!);
    if (Array.isArray(fields.macroArguments))
      ranked.macroArguments = fields.macroArguments.map(rank);
    if ("receiverExpr" in fields)
      ranked.receiverExpr = rankRecipe(fields.receiverExpr!);
    return ranked;
  };
  return JSON.stringify([
    facts,
    result.status,
    result.failureKind ?? null,
    result.diagnostics,
    {
      ...data,
      opaqueAttributes: rankStarts("opaqueAttributes"),
      standardMacroScopes: rankStarts("standardMacroScopes"),
    },
    symbols.map((symbol) => [
      rankKey(symbol.key),
      symbol.name,
      symbol.kind,
      symbol.identity,
      ...(whole(symbol)
        ? ["whole-file", "whole-file"]
        : [rank(symbol.range.start), rank(symbol.range.end)]),
      symbol.data ?? null,
    ]),
    links.map(({ link }) => [
      link.kind,
      link.targetName,
      rankKey(link.sourceKey),
      rank(link.range.start),
      rank(link.range.end),
      rankLinkData(link.data),
    ]),
  ]);
}
