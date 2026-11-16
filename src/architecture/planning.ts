// SPDX-License-Identifier: MIT
import type { ArchitectureEntity, PlanItem } from "./schema.js";
export function newPlanItem(id: string): PlanItem {
  return {
    id,
    kind: "requirement",
    title: "",
    owner: "unassigned",
    status: "proposed",
    detail: "",
    acceptance: "",
    evidence: "",
    evidenceRevision: "",
    links: [],
  };
}
/** A proposal is separate from the retained contract, tied to its exact baseline. */
export function proposeContractChange(
  id: string,
  entity: ArchitectureEntity,
  revision: string,
): PlanItem {
  return {
    ...newPlanItem(id),
    kind: "decision",
    title: "Change " + entity.key,
    owner: entity.owner,
    originRevision: revision,
    links: [{ kind: "depends-on", target: entity.id }],
  };
}

/** A typed name is usable only when it selects exactly one retained record. */
export function resolveArchitectureTarget(
  entities: readonly ArchitectureEntity[],
  input: string,
) {
  const value = input.trim();
  const exact = entities.find((e) => e.id === value);
  if (exact) return { ok: true as const, id: exact.id };
  const matches = entities.filter((e) => e.key === value || e.name === value);
  if (matches.length === 1) return { ok: true as const, id: matches[0]!.id };
  return {
    ok: false as const,
    message: matches.length
      ? `“${value}” names several records. Choose a specific record ID from the list.`
      : `No record called “${value}”. Choose a retained record from the list.`,
  };
}
