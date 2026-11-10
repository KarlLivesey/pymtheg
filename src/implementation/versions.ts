import { hash } from "../shared/identity.js";
import { versionCatalogQuerySchema } from "./protocol.js";
import { versionCategory } from "./version-sources.js";
export class VersionCatalogChanged extends Error {}
export interface VersionMetadata {
  id: string;
  label: string;
  created: string;
  source: string;
}
/** Inspect metadata once. No source documents or observed graphs are loaded. */
export function versionCatalog(
  revisions: readonly VersionMetadata[],
  activeRevision: string | null,
  raw: unknown = {},
) {
  const query = versionCatalogQuerySchema.parse(raw);
  const needle = query.query.toLowerCase();
  const matches: ReturnType<typeof row>[] = [];
  const codes: ReturnType<typeof row>[] = [];
  const counts = { design: 0, code: 0, links: 0 };
  let selected: ReturnType<typeof row> | null = null;
  const fingerprints: string[] = [activeRevision ?? ""];
  const labels = new Map<string, number>();
  function row(revision: VersionMetadata) {
    return {
      ...revision,
      category: versionCategory(revision.source),
      current: revision.id === activeRevision,
    };
  }
  for (const revision of revisions) {
    labels.set(revision.label, (labels.get(revision.label) ?? 0) + 1);
    fingerprints.push(
      JSON.stringify([
        revision.id,
        revision.label,
        revision.created,
        revision.source,
      ]),
    );
    const item = row(revision);
    if (item.id === query.selectedId) selected = item;
    if (
      ![item.id, item.label, item.source].some((value) =>
        value.toLowerCase().includes(needle),
      )
    )
      continue;
    counts[item.category]++;
    if (item.category === "code") codes.push(item);
    if (query.category === "all" || query.category === item.category)
      matches.push(item);
  }
  const catalogHash = hash(fingerprints.join("\n"));
  if (query.catalogHash && query.catalogHash !== catalogHash)
    throw new VersionCatalogChanged(
      "The version catalogue changed. Refresh it before continuing through pages.",
    );
  const describe = (item: ReturnType<typeof row>) => ({
    ...item,
    labelCount: labels.get(item.label) ?? 1,
  });
  const items = matches
    .slice(query.offset, query.offset + query.limit)
    .map(describe);
  return {
    activeRevision,
    catalogHash,
    category: query.category,
    query: query.query,
    counts,
    total: matches.length,
    repositoryTotal: revisions.length,
    observationTotal: codes.length,
    offset: query.offset,
    nextOffset:
      query.offset + items.length < matches.length
        ? query.offset + items.length
        : null,
    items,
    selected: selected ? describe(selected) : null,
    examined: revisions.length,
    plans: items,
    observations:
      query.category === "all" || query.category === "code"
        ? codes.slice(query.offset, query.offset + query.limit).map(describe)
        : [],
  };
}
