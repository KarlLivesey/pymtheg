// SPDX-License-Identifier: MIT
import type { ArchitectureIndex } from "./schema.js";
/** Imported conflicts remain inspectable; native editing may not introduce new ones. */
export function planningIntegrityRegression(
  before: ArchitectureIndex,
  after: ArchitectureIndex,
): string | null {
  const count = (index: ArchitectureIndex) => {
    const result = new Map<string, number>();
    for (const entity of index.entities) {
      const id = entity.conflictOf ?? entity.id;
      if (id.startsWith("plan:")) result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
  };
  const old = count(before);
  for (const [id, total] of count(after))
    if (total > 1 && total > (old.get(id) ?? 0))
      return `The ID ${id.slice(5)} is already used by another planning record. Choose a unique ID; the saved plan was preserved.`;
  const key = (edge: ArchitectureIndex["edges"][number]) =>
    JSON.stringify([edge.from, edge.kind, edge.to]);
  const existing = new Set(
    before.edges
      .filter((e) => e.from.startsWith("plan:") && e.unresolved)
      .map(key),
  );
  const broken = after.edges.filter(
    (e) => e.from.startsWith("plan:") && e.unresolved && !existing.has(key(e)),
  );
  if (!broken.length) return null;
  const entities = new Map(before.entities.map((e) => [e.id, e]));
  const targets = [...new Set(broken.map((e) => e.targetName))];
  const consumers = [...new Set(broken.map((e) => e.from))].map(
    (id) => `${entities.get(id)?.name ?? id} (${id.replace(/^plan:/, "")})`,
  );
  return `This edit would leave ${broken.length} planning link${broken.length === 1 ? "" : "s"} without a target. Affected records: ${consumers.slice(0, 5).join(", ")}${consumers.length > 5 ? ", …" : ""}. Targets: ${targets
    .slice(0, 3)
    .map((id) => entities.get(id)?.name ?? id)
    .join(
      ", ",
    )}. Restore removed targets or update these records' links before saving. For an intended rename, first add an explicit {#stable-id} anchor to the original heading, then rename it. The saved plan was preserved.`;
}
