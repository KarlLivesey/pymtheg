import {
  sourceRegistry,
  sourceRegistryPath,
  nativePlanPath,
} from "./import-merge.js";
import type { ArchitectureDocument } from "./schema.js";
import type {
  ArchitectureIndex,
  ArchitectureEntity,
  workIssueSchema,
} from "./schema.js";
import type { z } from "zod";
export interface EvidenceSnapshot {
  id: string;
  entities: (Pick<ArchitectureEntity, "id" | "contentHash"> & {
    name?: string;
    document?: string;
    relationshipHash?: string;
  })[];
}
/** Extra retained targets needed to review links into a local import fork. */
export function forkReviewTargets(
  index: ArchitectureIndex,
  documents: readonly ArchitectureDocument[],
) {
  const registry = sourceRegistry(documents);
  const sources = new Map(registry.sources.map((s) => [s.id, s]));
  const result = new Map<string, { source: string; target: string | null }[]>();
  for (const fork of registry.divergedDocuments) {
    const source = sources.get(fork.sourceId);
    const upstream = source?.documents.find(
      (d) => (d.sourcePath ?? d.path) === fork.sourcePath,
    );
    // A document still tracked at its original path is not a separate copy.
    if (upstream?.path === fork.path) continue;
    const group = result.get(fork.path) ?? [];
    group.push({
      source: source?.label || fork.sourceId,
      target:
        upstream?.path || fork.upstreamPath
          ? "document:" + (upstream?.path ?? fork.upstreamPath)
          : null,
    });
    result.set(fork.path, group);
  }
  return new Map(
    index.entities
      .filter((e) => result.has(e.document))
      .map((e) => [e.id, result.get(e.document)!]),
  );
}
/** Retain only the old target identities/hashes required by the current evidence links. */
export function projectEvidenceSnapshot(
  index: ArchitectureIndex,
  targets: ReadonlySet<string>,
): EvidenceSnapshot {
  return {
    id: index.id,
    entities: index.entities
      .filter((e) => targets.has(e.id))
      .map(({ id, contentHash, name, document, relationshipHash }) => ({
        id,
        contentHash,
        name,
        document,
        ...(relationshipHash ? { relationshipHash } : {}),
      })),
  };
}
/** Findings about stored plans; never upgrades a recorded status into verification. */
export function openArchitectureWork(
  index: ArchitectureIndex,
  history: ReadonlyMap<string, EvidenceSnapshot>,
  documents: readonly ArchitectureDocument[] = [],
) {
  const authored = authoredDocuments(index, documents);
  const forkTargets = forkReviewTargets(index, documents);
  const issues: z.infer<typeof workIssueSchema>[] = [],
    current = new Map(index.entities.map((e) => [e.id, e]));
  const outgoing = new Map<string, typeof index.edges>(),
    previousEntities = new Map(
      [...history].map(([id, prior]) => [
        id,
        new Map(prior.entities.map((e) => [e.id, e])),
      ]),
    );
  for (const edge of index.edges) {
    const group = outgoing.get(edge.from) ?? [];
    group.push(edge);
    outgoing.set(edge.from, group);
  }
  for (const entity of index.entities) {
    const plan = entity.planning;
    if (!plan) continue;
    const add = (
      kind: z.infer<typeof workIssueSchema>["kind"],
      message: string,
      target?: string,
    ) =>
      issues.push({
        id: entity.id,
        kind,
        origin: authored.has(entity.document) ? "authored" : "imported",
        message,
        ...(target ? { target } : {}),
      });
    if (["requirement", "test"].includes(entity.kind) && !plan.hasAcceptance)
      add("missing-criteria", "Describe an observable acceptance check.");
    if (
      ["implemented", "reviewed"].includes(entity.status) &&
      !plan.hasEvidence
    )
      add(
        "missing-evidence",
        "This recorded status has no supporting evidence.",
      );
    if (
      ["decision", "risk"].includes(entity.kind) &&
      ["proposed", "in-progress"].includes(entity.status)
    )
      add("open-decision", "This decision or risk is still open.");
    const links = outgoing.get(entity.id) ?? [];
    const reviewedAt = plan.linkReviewRevision || plan.originRevision;
    const reviewed = reviewedAt ? previousEntities.get(reviewedAt) : undefined;
    const seenForks = new Set<string>();
    for (const link of links)
      for (const fork of forkTargets.get(link.to) ?? []) {
        const key = JSON.stringify(fork);
        if (seenForks.has(key)) continue;
        seenForks.add(key);
        const before = fork.target ? reviewed?.get(fork.target) : undefined;
        const after = fork.target ? current.get(fork.target) : undefined;
        if (!reviewed || before?.contentHash !== after?.contentHash)
          add(
            "diverged-target",
            `This plan links to the local copy ${current.get(link.to)?.document ?? link.to}. ` +
              (after
                ? `The separately tracked copy from ${fork.source} at ${after.document} is new or changed since this relationship was reviewed. Compare it before reviewing the link or choosing a different target.`
                : `The separately tracked copy from ${fork.source} was removed. Review whether the local copy still represents the intended design.`),
            fork.target ?? link.to,
          );
      }
    const documentLinks = links.filter(
      (link) => !link.to.startsWith("source:"),
    );
    if (reviewedAt && documentLinks.length) {
      if (!reviewed)
        add(
          "unknown-link-review",
          "The revision used to review these links is unavailable; review their current targets.",
        );
      else
        for (const link of documentLinks) {
          const before = reviewed.get(link.to),
            after = current.get(link.to);
          if (before?.document && after && before.document !== after.document)
            add(
              "moved-target",
              `Linked target “${after.name.slice(0, 240)}” moved from ${before.document} to ${after.document}. Review the retained target at its new location.`,
              link.to,
            );
          if (before?.name && after && before.name !== after.name)
            add(
              "retitled-target",
              `Linked target was renamed from “${before.name.slice(0, 240)}” to “${after.name.slice(0, 240)}”. Review whether this decision still points to the intended design.`,
              link.to,
            );
          else if (
            !plan.hasEvidence &&
            before &&
            after &&
            (before.relationshipHash && after.relationshipHash
              ? before.relationshipHash !== after.relationshipHash
              : before.contentHash !== after.contentHash)
          )
            add(
              "changed-target",
              `Linked target “${after.name.slice(0, 240)}” has changed since this plan reviewed it. Review whether the relationship still represents the intended design.`,
              link.to,
            );
        }
    }
    if (!plan.hasEvidence) continue;
    const previous = history.get(plan.evidenceRevision);
    if (!plan.evidenceRevision || !previous) {
      add("unknown-evidence", "Choose a retained revision for this evidence.");
      continue;
    }
    if (!links.length) {
      add(
        "unscoped-evidence",
        "Link the evidence to the contract or plan it reviewed.",
      );
      continue;
    }
    const before = previousEntities.get(previous.id)!;
    for (const target of new Set(links.map((link) => link.to)))
      if (before.get(target)?.contentHash !== current.get(target)?.contentHash)
        add(
          "stale-evidence",
          `Linked target “${current.get(target)?.name ?? target}” changed or disappeared since the evidence revision. Review its evidence again.`,
          target,
        );
  }
  for (const edge of index.edges)
    if (edge.unresolved)
      issues.push({
        id: edge.from,
        kind: edge.kind === "uses-type" ? "unresolved-type" : "broken-link",
        origin: authored.has(current.get(edge.from)?.document ?? "")
          ? "authored"
          : "imported",
        message: `The target ${edge.targetName} is missing or ambiguous.`,
        target: edge.to,
      });
  // Stable linear partition: native work cannot be buried by imported volume.
  return [
    ...issues.filter((i) => i.origin === "authored"),
    ...issues.filter((i) => i.origin === "imported"),
  ];
}

export function authoredDocuments(
  index: ArchitectureIndex,
  documents: readonly ArchitectureDocument[],
) {
  if (documents.some((d) => d.path === sourceRegistryPath))
    return new Set([
      ...sourceRegistry(documents).nativeDocuments,
      nativePlanPath,
    ]);
  // Legacy workspaces without provenance: don't demote their plans to imported gaps.
  return new Set(
    index.entities.filter((e) => e.planning).map((e) => e.document),
  );
}
export function newlyBrokenAuthoredLinks(
  before: ArchitectureIndex | null | undefined,
  after: ArchitectureIndex,
  documents: readonly ArchitectureDocument[],
) {
  const authored = authoredDocuments(after, documents),
    entities = new Map(after.entities.map((e) => [e.id, e])),
    key = (e: ArchitectureIndex["edges"][number]) =>
      JSON.stringify([e.from, e.kind, e.targetName]),
    alreadyBroken = new Set(before?.edges.filter((e) => e.unresolved).map(key));
  return after.edges
    .filter(
      (e) =>
        e.unresolved &&
        authored.has(entities.get(e.from)?.document ?? "") &&
        !alreadyBroken.has(key(e)),
    )
    .map((e) => ({
      id: e.from,
      name: entities.get(e.from)?.name ?? e.from,
      target: e.targetName,
    }));
}
