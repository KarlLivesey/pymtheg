// SPDX-License-Identifier: MIT
import {
  addedLinkId,
  compare,
  libraryTarget,
  validateResult,
} from "./identity.js";
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
    delete next.libraries;
    if (!decision) return next;
    if (decision.library !== undefined) {
      if (
        decision.targetId !== undefined ||
        decision.candidateIds !== undefined ||
        decision.libraries !== undefined
      )
        throw Error("A library target excludes other targets");
      next.libraries = [libraryTarget(decision.library, true)];
      next.resolution = "library";
    } else if (decision.candidateIds !== undefined) {
      const libraries = (decision.libraries ?? []).map((item) =>
        libraryTarget(item, false),
      );
      const libraryIds = new Set(libraries.map((item) => item.id));
      if (
        decision.targetId !== undefined ||
        decision.candidateIds.length + libraries.length < 2 ||
        new Set(decision.candidateIds).size !== decision.candidateIds.length ||
        libraryIds.size !== libraries.length
      )
        throw Error(
          "Candidates must contain at least two distinct targets, without a definite target",
        );
      next.candidates = [...decision.candidateIds]
        .sort(compare)
        .map((id) => ({ id, status: target(id).status }));
      if (libraries.length)
        next.libraries = libraries.sort((a, b) => compare(a.id, b.id));
      next.resolution = "ambiguous";
    } else if (decision.libraries !== undefined)
      throw Error("Library candidates need candidateIds");
    else if (decision.targetId !== null && decision.targetId !== undefined) {
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
  /** A stored file by path. Read only for files that receive added links. */
  fileOf: (path: string) => GraphFile | undefined,
  symbols: readonly GraphSymbol[],
  existing: readonly GraphLink[],
): GraphLink[] {
  const links = existing.filter(
    (link) => link.module === module && link.origin === "parse",
  );
  const linkIds = new Set(links.map((link) => link.id));
  const decider = new LinkDecider(symbols);
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  /** Per file with added links: what validation needs, not the whole record. */
  interface Checked {
    path: string;
    text: string;
    status: GraphFile["result"]["status"];
    symbols: Map<string, GraphFile["result"]["symbols"][number]>;
  }
  const checked = new Map<string, Checked | undefined>();
  const fileFor = (path: string): Checked | undefined => {
    if (checked.has(path)) return checked.get(path);
    const file = fileOf(path);
    let entry: Checked | undefined;
    if (file?.module === module) {
      // Stored files were validated when written; this re-check is cheap insurance.
      if (file.result.status !== "failed")
        validateResult(file.text, { ...file.result, links: [] });
      entry = {
        path: file.path,
        text: file.text,
        status: file.result.status,
        symbols: new Map(
          file.result.symbols.map((symbol) => [symbol.key, symbol]),
        ),
      };
    }
    checked.set(path, entry);
    return entry;
  };
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
    const file = fileFor(added.file);
    const source =
      added.sourceId === null ? undefined : symbolsById.get(added.sourceId);
    const identity = JSON.stringify([added.file, added.key]);
    if (
      !file ||
      file.status === "failed" ||
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
    const localSource = source ? file.symbols.get(source.key) : undefined;
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
      sourceStatus: file.status,
      candidates: [],
      resolution: "unresolved",
    };
    if (
      [added.candidateIds, added.targetId, added.library].filter(
        (item) => item !== undefined,
      ).length > 1 ||
      (added.libraries !== undefined && added.candidateIds === undefined)
    )
      throw Error("Added link cannot have definite and candidate targets");
    const decision: LinkResolution =
      added.candidateIds !== undefined
        ? {
            linkId: link.id,
            candidateIds: added.candidateIds,
            ...(added.libraries === undefined
              ? {}
              : { libraries: added.libraries }),
          }
        : added.library !== undefined
          ? { linkId: link.id, library: added.library }
          : { linkId: link.id, targetId: added.targetId ?? null };
    output.push(decider.decide(link, decision));
  }
  return output.sort((a, b) => compare(a.id, b.id));
}
