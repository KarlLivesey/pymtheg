import { addedLinkId, compare, validateResult } from "./identity.js";
import type {
  GraphFile,
  GraphLink,
  GraphSymbol,
  LinkResolution,
  ResolutionResult,
} from "./types.js";

export function decideLink(
  link: GraphLink,
  decision: LinkResolution | undefined,
  symbols: readonly GraphSymbol[],
): GraphLink {
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const target = (id: string) => {
    const value = byId.get(id);
    if (!value || value.status === "failed")
      throw Error("Invalid or failed link target");
    return value;
  };
  const next: GraphLink = {
    ...link,
    targetId: null,
    targetStatus: null,
    candidates: [],
    resolution: "unresolved",
  };
  if (!decision) return next;
  if (decision.candidateIds !== undefined) {
    if (
      decision.targetId !== undefined ||
      decision.candidateIds.length < 2 ||
      new Set(decision.candidateIds).size !== decision.candidateIds.length
    )
      throw Error(
        "Candidates must contain at least two distinct targets, without a definite target",
      );
    next.candidates = [...decision.candidateIds]
      .sort(compare)
      .map((id) => ({ id, status: target(id).status }));
    next.resolution = "ambiguous";
  } else if (decision.targetId !== null && decision.targetId !== undefined) {
    const symbol = target(decision.targetId);
    next.targetId = symbol.id;
    next.targetStatus = symbol.status;
    next.resolution = "resolved";
  }
  return next;
}
/** Pure validation before storage writes; module mistakes cannot be confused with backend errors. */
export function resolutionFacts(
  projectId: string,
  module: string,
  result: ResolutionResult,
  files: readonly GraphFile[],
  symbols: readonly GraphSymbol[],
  existing: readonly GraphLink[],
): GraphLink[] {
  const links = existing.filter(
    (link) => link.module === module && link.origin === "parse",
  );
  const decisions = new Map<string, LinkResolution>();
  for (const decision of result.resolutions) {
    if (
      decisions.has(decision.linkId) ||
      !links.some((link) => link.id === decision.linkId)
    )
      throw Error("Invalid, duplicate or foreign link resolution");
    decisions.set(decision.linkId, decision);
  }
  const output = links.map((link) =>
    decideLink(link, decisions.get(link.id), symbols),
  );
  const keys = new Set<string>();
  for (const added of result.links) {
    const file = files.find(
      (file) => file.path === added.file && file.module === module,
    );
    const source = symbols.find((symbol) => symbol.id === added.sourceId);
    const identity = JSON.stringify([added.file, added.key]);
    if (
      !file ||
      file.result.status === "failed" ||
      !added.key ||
      keys.has(identity) ||
      (added.sourceId !== null && (!source || source.file !== file.path))
    )
      throw Error("Invalid or duplicate added link origin/key");
    keys.add(identity);
    const draft = {
      sourceKey: source?.key ?? null,
      kind: added.kind,
      targetName: added.targetName,
      range: added.range,
      ...(added.data === undefined ? {} : { data: added.data }),
    };
    validateResult(file.text, { ...file.result, links: [draft] });
    const link: GraphLink = {
      ...draft,
      id: addedLinkId(projectId, module, file.path, added.key),
      file: file.path,
      module,
      origin: "analysis",
      sourceId: added.sourceId,
      targetId: null,
      targetStatus: null,
      sourceStatus: file.result.status,
      candidates: [],
      resolution: "unresolved",
    };
    const decision: LinkResolution =
      added.candidateIds !== undefined
        ? { linkId: link.id, candidateIds: added.candidateIds }
        : { linkId: link.id, targetId: added.targetId ?? null };
    if (added.candidateIds !== undefined && added.targetId !== undefined)
      throw Error("Added link cannot have definite and candidate targets");
    output.push(decideLink(link, decision, symbols));
  }
  return output.sort((a, b) => compare(a.id, b.id));
}
