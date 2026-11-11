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
  return new LinkDecider(symbols).decide(link, decision);
}
/** Internal per-pass lookup; callers of decideLink retain its original signature. */
export class LinkDecider {
  private readonly byId: Map<string, GraphSymbol>;
  constructor(symbols: readonly GraphSymbol[]) {
    this.byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  }
  decide(link: GraphLink, decision: LinkResolution | undefined): GraphLink {
    const target = (id: string) => {
      const value = this.byId.get(id);
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
  const linkIds = new Set(links.map((link) => link.id));
  const decider = new LinkDecider(symbols);
  const filesByPath = new Map(
    files
      .filter((file) => file.module === module)
      .map((file) => [file.path, file]),
  );
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const validated = new Map<
    string,
    Map<string, GraphFile["result"]["symbols"][number]>
  >();
  const decisions = new Map<string, LinkResolution>();
  for (const decision of result.resolutions) {
    if (decisions.has(decision.linkId) || !linkIds.has(decision.linkId))
      throw Error("Invalid, duplicate or foreign link resolution");
    decisions.set(decision.linkId, decision);
  }
  const output = links.map((link) =>
    decider.decide(link, decisions.get(link.id)),
  );
  const keys = new Set<string>();
  for (const added of result.links) {
    const file = filesByPath.get(added.file);
    const source =
      added.sourceId === null ? undefined : symbolsById.get(added.sourceId);
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
    let localSymbols = validated.get(file.path);
    if (!localSymbols) {
      validateResult(file.text, { ...file.result, links: [] });
      localSymbols = new Map(
        file.result.symbols.map((symbol) => [symbol.key, symbol]),
      );
      validated.set(file.path, localSymbols);
    }
    const localSource = source ? localSymbols.get(source.key) : undefined;
    validateResult(file.text, {
      status: "clean",
      diagnostics: [],
      symbols: localSource ? [localSource] : [],
      links: [draft],
    });
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
    output.push(decider.decide(link, decision));
  }
  return output.sort((a, b) => compare(a.id, b.id));
}
