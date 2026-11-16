// SPDX-License-Identifier: MIT
import type { ObservedGraph } from "./schema.js";

export function relationshipDifference(
  before: ObservedGraph,
  after: ObservedGraph,
  nodeId: string,
  offset = 0,
  limit = 20,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw Error("Use a nonnegative offset and a page of 1–100 relationships.");
  type Item = {
    kind: string;
    target: string;
    targetId: string | null;
    resolution: string;
    count: number;
  };
  const counts = (graph: ObservedGraph) => {
    const result = new Map<string, Item>();
    for (const edge of graph.edges)
      if (edge.from === nodeId) {
        const key = JSON.stringify([
          edge.kind,
          edge.to,
          edge.targetName,
          edge.resolution,
        ]);
        const prior = result.get(key);
        if (prior) prior.count++;
        else
          result.set(key, {
            kind: edge.kind,
            target: edge.targetName,
            targetId: edge.to,
            resolution: edge.resolution,
            count: 1,
          });
      }
    return result;
  };
  const old = counts(before),
    current = counts(after);
  const changes: (Item & { beforeCount: number; afterCount: number })[] = [];
  for (const key of new Set([...old.keys(), ...current.keys()])) {
    const a = old.get(key),
      b = current.get(key);
    if (a?.count === b?.count) continue;
    changes.push({
      ...(b ?? a)!,
      beforeCount: a?.count ?? 0,
      afterCount: b?.count ?? 0,
    });
  }
  const key = (item: Item) =>
    JSON.stringify([item.kind, item.target, item.targetId, item.resolution]);
  changes.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  let characters = 0;
  const items = [];
  for (const item of changes.slice(offset, offset + limit)) {
    const remaining = Math.max(0, 24000 - characters);
    if (remaining === 0) break;
    const clip = (text: string, limit: number) => {
      let result = text.slice(0, limit);
      if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
      return result;
    };
    const target = clip(item.target, Math.min(2000, remaining));
    const targetId =
      item.targetId === null
        ? null
        : clip(item.targetId, Math.min(8192, remaining - target.length));
    characters += target.length + (targetId?.length ?? 0);
    items.push({
      ...item,
      target,
      targetId,
      displayTruncated: target !== item.target || targetId !== item.targetId,
    });
  }
  return {
    items,
    total: changes.length,
    offset,
    nextOffset:
      offset + items.length < changes.length ? offset + items.length : null,
    coverageComplete:
      before.coverage.relationships === "complete" &&
      after.coverage.relationships === "complete" &&
      !before.staleFiles.length &&
      !after.staleFiles.length,
    meaning:
      "Counts are observed source sites, not the number of times a loop or retry executes. Lexical references count dependency pairs once, retaining the first site. Unresolved calls remain unresolved.",
  };
}
