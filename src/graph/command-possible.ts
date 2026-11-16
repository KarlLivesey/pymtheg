// SPDX-License-Identifier: MIT
import type { GraphLink, GraphSymbol } from "./types.js";
import type { SqliteGraphStore } from "./store.js";

export type PossibleMatch = "target-hint" | "receiver-qualified" | "name-only";
export interface PossibleCall {
  link: GraphLink;
  matchKind: PossibleMatch;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
// Remove generic argument suffixes before splitting a recorded call spelling.
const segments = (value: string) =>
  value.replace(/<[^<>]*>|\[[^\[\]]*\]/g, "").split(/::|\./);
const normalized = (value: string) =>
  value.replace(/[()*&\s]/g, "").replace(/::/g, ".");

/** Suggestions only: these facts deliberately remain unresolved in the store.
 * Rust records symbol IDs; TS records {file,key}; Go records selector expressions.
 * A qualified mismatch may still be name-only noise, never type evidence. */
export function possibleMatch(
  link: GraphLink,
  target: GraphSymbol,
): PossibleMatch | null {
  if (
    link.kind !== "calls" ||
    link.resolution !== "unresolved" ||
    link.module !== target.module
  )
    return null;
  const data = object(link.data);
  const hints = Array.isArray(data.targets) ? data.targets : [];
  if (
    hints.some(
      (hint) =>
        hint === target.id ||
        (object(hint).file === target.file && object(hint).key === target.key),
    )
  )
    return "target-hint";
  let expr = object(data.expr);
  while (expr.k === "inst") expr = object(expr.x);
  const name =
    expr.k === "sel" ? text(expr.n) : (segments(link.targetName).at(-1) ?? "");
  if (name !== target.name) return null;
  let x = object(expr.x);
  // Go stores syntactically known static types and generic constraints, not
  // resolved target IDs. Follow only these recorded descriptors.
  while (x.k === "var") x = object(x.d);
  const type = object(x.k === "tval" ? x.c : x.t);
  const receiver =
    expr.k === "sel" && (x.k === "val" || x.k === "tval")
      ? [text(type.q), text(type.n)].filter(Boolean).join(".")
      : text(data.receiverType);
  const identities = [
    link.targetName,
    ...(receiver ? [`${receiver}.${name}`] : []),
  ].map(normalized);
  if (
    target.identity !== target.name &&
    identities.includes(normalized(target.identity))
  )
    return "receiver-qualified";
  return "name-only";
}
export function possibleCalls(
  store: SqliteGraphStore,
  target: GraphSymbol,
  limit: number,
): PossibleCall[] {
  const found: PossibleCall[] = [];
  for (const link of store.unresolvedCallHints(target)) {
    const matchKind = possibleMatch(link, target);
    if (matchKind) found.push({ link, matchKind });
    if (found.length >= limit) break;
  }
  return found;
}
