// SPDX-License-Identifier: MIT
import type { PlanItem } from "./schema.js";
import type { SourceCatalogue } from "../shared/source-contracts.js";
import { sourceExpectationSets } from "./source-contracts.js";
/** Preserve review per linked root. Only explicit review/new links use live capture. */
export function updateSourceBaselines(
  previous: PlanItem | undefined,
  targets: string[],
  captured: SourceCatalogue | null,
  legacy: SourceCatalogue | null,
  reviewed: boolean,
) {
  const roots: NonNullable<PlanItem["sourceRoots"]> = {};
  const oldTargets = new Set(
    previous?.links
      .filter((l) => l.target.startsWith("source:"))
      .map((l) => l.target) ?? [],
  );
  const removed = new Set(
    [...oldTargets].filter((id) => !targets.includes(id)),
  );
  const currentTargets = targets.filter(
    (id) => reviewed || !oldTargets.has(id),
  );
  const capturedSets = captured
    ? sourceExpectationSets(captured, currentTargets)
    : {};
  const legacyTargets = targets.filter(
    (id) => oldTargets.has(id) && !previous?.sourceRoots?.[id],
  );
  const legacySets = legacy ? sourceExpectationSets(legacy, legacyTargets) : {};
  const available = new Map(captured?.entries.map((e) => [e.id, e]) ?? []);
  for (const root of new Set(targets)) {
    if (reviewed || !oldTargets.has(root)) {
      const expectations = capturedSets[root];
      if (!expectations?.[root])
        throw Error(
          "A new or reviewed source link requires a captured component: " +
            root,
        );
      roots[root] = {
        expectations,
        hashes: Object.fromEntries(
          Object.keys(expectations).map((id) => [
            id,
            available.get(id)!.sourceHash,
          ]),
        ),
        precise: true,
      };
    } else if (previous?.sourceRoots?.[root]) {
      roots[root] = structuredClone(previous.sourceRoots[root]);
    } else {
      const expected = previous?.sourceExpectations ?? {};
      const recovered = legacySets[root];
      const precise =
        !!recovered?.[root] &&
        Object.entries(recovered).every(
          ([id, value]) => expected[id] === value,
        );
      const expectations = precise
        ? recovered!
        : Object.fromEntries(
            Object.entries(expected).filter(([id]) => !removed.has(id)),
          );
      roots[root] = {
        expectations,
        hashes: Object.fromEntries(
          Object.entries(previous?.sourceHashes ?? {}).filter(([id]) =>
            Object.hasOwn(expectations, id),
          ),
        ),
        precise,
      };
    }
  }
  const sourceExpectations: Record<string, string> = {},
    sourceHashes: Record<string, string> = {};
  for (const root of Object.values(roots)) {
    for (const [id, value] of Object.entries(root.expectations))
      sourceExpectations[id] ??= value;
    for (const [id, value] of Object.entries(root.hashes))
      sourceHashes[id] ??= value;
  }
  return { sourceRoots: roots, sourceExpectations, sourceHashes };
}
