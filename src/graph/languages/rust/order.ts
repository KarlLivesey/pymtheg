// SPDX-License-Identifier: MIT
import { compare } from "../../identity.js";
import type { Json } from "../../types.js";

// C-24: stores list rows by id, and every id includes the project's random
// id, so two indexes of one snapshot list the same rows in different orders.
// Lookups through glob cycles can depend on which lookup ran first, so the
// Rust phases take their inputs in an order the snapshot alone fixes: path,
// then position, then what is written there. C-36's surface fingerprint uses
// the same order, so it sees every change to the order the resolver meets.
export const pathOrder = <T extends { path: string }>(
  items: readonly T[],
): T[] => [...items].sort((a, b) => compare(a.path, b.path));
type Site = {
  file: string;
  range: { start: number; end: number };
  kind: string;
  data?: Json | undefined;
};
const bySite = <T extends Site>(
  items: readonly T[],
  written: (item: T) => string[],
  first: (item: T) => boolean = () => false,
): T[] =>
  [...items].sort(
    (a, b) =>
      compare(a.file, b.file) ||
      Number(first(b)) - Number(first(a)) ||
      a.range.start - b.range.start ||
      a.range.end - b.range.end ||
      compare(a.kind, b.kind) ||
      written(a).reduce(
        (order, part, i) => order || compare(part, written(b)[i]!),
        0,
      ) ||
      compare(JSON.stringify(a.data ?? null), JSON.stringify(b.data ?? null)),
  );
export const symbolOrder = <
  T extends Site & { key: string; identity: string; name: string },
>(
  symbols: readonly T[],
) =>
  // C-36: a file's own symbol spans the whole file and comes first, so a
  // comment before the first item does not move it after that item.
  bySite(
    symbols,
    (s) => [s.key, s.identity, s.name],
    (s) => s.key === "file",
  );
export const linkOrder = <
  T extends Site & {
    origin: string;
    targetName: string;
    sourceKey: string | null;
  },
>(
  links: readonly T[],
) => bySite(links, (l) => [l.origin, l.targetName, l.sourceKey ?? ""]);
