// SPDX-License-Identifier: MIT
/** Saved parent links describe lineage; they do not prove two versions are compatible. */
export function branchReview<
  T extends {
    id: string;
    label: string;
    parentId?: string | null | undefined;
    reviewedAgainst?: string[] | undefined;
  },
>(revisions: readonly T[], active: string | null) {
  const byId = new Map(revisions.map((r) => [r.id, r]));
  const ancestors = new Set<string>();
  let id = active;
  while (id && !ancestors.has(id)) {
    ancestors.add(id);
    id = byId.get(id)?.parentId ?? null;
  }
  const parents = new Set(
    revisions.flatMap((r) => (r.parentId ? [r.parentId] : [])),
  );
  return revisions
    .filter((r) => !parents.has(r.id) && !ancestors.has(r.id))
    .map((r) => ({
      id: r.id,
      label: r.label,
      reviewed: !!r.reviewedAgainst?.some((id) => ancestors.has(id)),
      lineage:
        r.parentId === undefined ? ("unknown" as const) : ("recorded" as const),
    }));
}
