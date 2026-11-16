// SPDX-License-Identifier: MIT
import { possibleCalls, type PossibleCall } from "./command-possible.js";
import type { SqliteGraphStore } from "./store.js";
import { GraphLocations, type Located } from "./command-locations.js";
import type { GraphLink, GraphSymbol } from "./types.js";

/**
 * Whether the Go toolchain route decided a link: a parsed link it upgraded,
 * confirmed or verified records `data.toolchain.origin`; an `implements`
 * pair it added records `data.origin` (W3-L).
 */
const decidedByToolchain = (link: GraphLink): boolean => {
  const data = link.data as {
    origin?: string;
    toolchain?: { origin?: string };
  } | null;
  return (
    data?.toolchain?.origin === "toolchain" || data?.origin === "toolchain"
  );
};

/** Callers' class counts are exact up to this many links (the CLI's default limit). */
export const CALLER_COUNT_BOUND = 1000;

export type QueryCommand =
  | "search"
  | "symbol"
  | "callers"
  | "callees"
  | "path"
  | "impact"
  | "file";
export interface QueryResult {
  status: "ok" | "ambiguous" | "not-found" | "bounded";
  data: Record<string, unknown>;
  truncated: boolean;
}
/** Queries decode only matching facts and visited endpoints. No full graph snapshot. */
export function queryGraph(
  store: SqliteGraphStore,
  command: QueryCommand,
  args: readonly string[],
  depth: number,
  limit: number,
  caseSensitive = false,
  includePossible = false,
): QueryResult {
  const locations = new GraphLocations(store);
  const located = (value: GraphSymbol) => ({
    ...value,
    ...locations.locate(value.file, value.range),
  });
  const cache = new Map<string, (GraphSymbol & Located) | undefined>();
  const symbol = (id: string) => {
    if (!cache.has(id)) {
      const value = store.getSymbol(id);
      cache.set(id, value ? located(value) : undefined);
    }
    return cache.get(id) ?? null;
  };
  const links = (items: GraphLink[]) =>
    items.map((link) => ({
      ...link,
      ...locations.locate(link.file, link.range),
      certainty:
        link.resolution === "resolved"
          ? "definite"
          : link.resolution === "ambiguous"
            ? "candidate-set"
            : "unresolved",
      // Where a toolchain decided the link (W3-L2): `decidedBy`, beside the
      // certainty it has as stored (`origin` is the link's parse/analysis
      // origin). Absent for source-only links.
      ...(decidedByToolchain(link) ? { decidedBy: "toolchain" as const } : {}),
      source: link.sourceId ? symbol(link.sourceId) : null,
      target: link.targetId ? symbol(link.targetId) : null,
      candidates: link.candidates.map((item) => ({
        ...item,
        symbol: symbol(item.id),
      })),
    }));
  const select = (input: string): (GraphSymbol & Located)[] => {
    if (/^symbol:[a-f0-9]{64}$/.test(input)) {
      const value = symbol(input);
      return value ? [value] : [];
    }
    const named = store.namedSymbols(input, limit + 1);
    if (named.length) return named.map(located);
    const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(input);
    if (!match) return [];
    const path = match[1]!,
      line = Number(match[2]),
      column = match[3] === undefined ? null : Number(match[3]);
    if (
      !Number.isSafeInteger(line) ||
      line < 1 ||
      (column !== null && (!Number.isSafeInteger(column) || column < 1))
    )
      throw Error("Selector line and column must be positive integers");
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw Error("Selector path must be project-relative POSIX");
    const range = locations.lineRange(path, line);
    if (!range) return [];
    const offset =
      column === null ? null : locations.offset(path, line, column);
    if (column !== null && offset === null) return [];
    const found = store.symbolsAt(
      path,
      offset ?? range.start,
      offset ?? range.end,
      column !== null,
    );
    // Remove strict containers, keeping equal-range declarations and same-line siblings ambiguous.
    found.sort(
      (a, b) =>
        b.range.start - a.range.start ||
        a.range.end - b.range.end ||
        (a.id < b.id ? -1 : 1),
    );
    let minimumEnd = Infinity,
      maximumStart = -1;
    const inner: GraphSymbol[] = [];
    for (let i = 0; i < found.length; ) {
      const value = found[i]!;
      let end = i + 1;
      while (
        end < found.length &&
        found[end]!.range.start === value.range.start &&
        found[end]!.range.end === value.range.end
      )
        end++;
      if (
        !(
          minimumEnd < value.range.end ||
          (minimumEnd === value.range.end && maximumStart > value.range.start)
        )
      )
        inner.push(...found.slice(i, end));
      if (value.range.end < minimumEnd) {
        minimumEnd = value.range.end;
        maximumStart = value.range.start;
      } else if (value.range.end === minimumEnd)
        maximumStart = Math.max(maximumStart, value.range.start);
      i = end;
    }
    return inner
      .sort(
        (a, b) =>
          a.range.start - b.range.start ||
          a.range.end - b.range.end ||
          (a.id < b.id ? -1 : 1),
      )
      .slice(0, limit + 1)
      .map(located);
  };
  /** Suggestions for a selector that selected nothing, never a selection:
   * symbols whose identity, written without `impl`, generic arguments, a
   * trait-for prefix, receiver punctuation or spaces, ends with the input
   * written the same way; else symbols with the input's last name. At most 5. */
  const nearMatches = (input: string): (GraphSymbol & Located)[] => {
    if (/^symbol:/.test(input) || /:\d+(?::\d+)?$/.test(input)) return [];
    const parts = (value: string) => {
      let text = value.trim();
      for (let before = ""; before !== text; ) {
        before = text;
        text = text.replace(/<[^<>]*>|\[[^[\]]*\]/g, "");
      }
      return text
        .replace(/^impl\s+/, "")
        .replace(/^.*\s+for\s+/, "")
        .replace(/[()*&\s]/g, "")
        .split(/::|\./)
        .filter(Boolean);
    };
    const wanted = parts(input);
    const name = wanted.at(-1);
    if (!name) return [];
    const named = store.namedSymbols(name, 1000);
    const tail = named.filter((s) => {
      const have = parts(s.identity);
      return (
        have.length >= wanted.length &&
        wanted.every(
          (part, i) => have[have.length - wanted.length + i] === part,
        )
      );
    });
    return (tail.length ? tail : named).slice(0, 5).map(located);
  };
  const result = (
    data: Record<string, unknown>,
    truncated = false,
    status: QueryResult["status"] = "ok",
  ): QueryResult => ({ data, truncated, status });
  if (command === "search") {
    const found = store.searchSymbols(args[0]!, limit + 1, caseSensitive);
    return result(
      {
        matches: found.slice(0, limit).map(located),
        limit,
        caseSensitive,
        caseFolding: caseSensitive ? "none" : "ASCII",
      },
      found.length > limit,
    );
  }
  if (command === "file") {
    const path = args[0]!;
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw Error("Expected a project-relative POSIX file path");
    const exists = store.hasFile(path);
    const symbols = store.symbolsForFile(path, limit + 1);
    const found = store.linksForFile(path, limit + 1);
    return result(
      {
        path,
        exists,
        symbols: symbols.slice(0, limit).map(located),
        links: links(found.slice(0, limit)),
        limit,
      },
      symbols.length > limit || found.length > limit,
      exists ? "ok" : "not-found",
    );
  }
  const inputs = args.map((input) => {
    const found = select(input);
    return {
      input,
      matches: found.slice(0, limit),
      truncated: found.length > limit,
      totalAtLeast: found.length,
      ...(found.length ? {} : { nearMatches: nearMatches(input) }),
    };
  });
  if (inputs.some((item) => item.matches.length !== 1 || item.truncated))
    return result(
      { inputs },
      inputs.some((item) => item.truncated),
      inputs.some((item) => !item.matches.length) ? "not-found" : "ambiguous",
    );
  const start = inputs[0]!.matches[0]!;
  if (command === "symbol") return result({ symbol: start });
  const classCounts = (items: GraphLink[], possible: number) => ({
    definite: items.filter((l) => l.resolution === "resolved").length,
    candidateSet: items.filter((l) => l.resolution === "ambiguous").length,
    unresolved: possible,
  });
  const displayPossible = (items: PossibleCall[]) =>
    items.map((item) => ({
      ...links([item.link])[0]!,
      matchKind: item.matchKind,
    }));
  const possibleCache = new Map<string, PossibleCall[]>();
  let possibleRemaining = limit;
  const possibleFrontier = (target: GraphSymbol) => {
    let found = possibleCache.get(target.id);
    if (!found) {
      found = possibleCalls(store, target, limit + 1);
      possibleCache.set(target.id, found);
    }
    const count = Math.min(found.length, limit);
    const items = found.slice(0, possibleRemaining);
    possibleRemaining -= items.length;
    return { items, count, truncated: found.length > items.length };
  };
  if (command === "callers" || command === "callees") {
    // Callers' class counts are totals, counted up to countBound (at least
    // the CLI's default limit) whatever the item limit, so a small page still
    // reports how many exist; countsTruncated means a total reached the bound.
    const countBound =
      command === "callers" ? Math.max(limit, CALLER_COUNT_BOUND) : limit;
    const found = store.callLinks(
      start.id,
      command === "callers" ? "incoming" : "outgoing",
      countBound + 1,
    );
    const possible =
      command === "callers" ? possibleCalls(store, start, countBound + 1) : [];
    return result(
      {
        symbol: start,
        links: links(found.slice(0, limit)),
        limit,
        ...(command === "callers"
          ? {
              possibleCallers: displayPossible(possible.slice(0, limit)),
              hasPossibleCallers: possible.length > 0,
              classCounts: classCounts(
                found.slice(0, countBound),
                Math.min(possible.length, countBound),
              ),
              countsTruncated:
                found.length > countBound || possible.length > countBound,
              countBound,
            }
          : {}),
      },
      found.length > limit || possible.length > limit,
    );
  }
  // Bounded breadth-first traversal. Keep shortest distance independent of
  // strongest route certainty: a longer definite route must not raise distance.
  const maxNodes = limit;
  if (command === "impact") {
    type Certainty = "definite" | "candidate" | "unresolved";
    const strength = { definite: 2, candidate: 1, unresolved: 0 };
    const visited = new Map<
      string,
      { symbol: GraphSymbol; certainty: Certainty; distance: number }
    >();
    visited.set(start.id, {
      symbol: start,
      certainty: "definite",
      distance: 0,
    });
    let frontier: { id: string; certainty: Certainty; distance: number }[] = [
      { id: start.id, certainty: "definite", distance: 0 },
    ];
    const seenRoutes = new Map<string, number>([[`${start.id}:definite`, 0]]);
    const edges = new Map<string, GraphLink>();
    const reports = new Map<
      string,
      {
        symbol: GraphSymbol;
        distance: number;
        links: ReturnType<typeof displayPossible>;
        classCounts: ReturnType<typeof classCounts>;
        truncated: boolean;
      }
    >();
    let truncated = false;
    for (let level = 0; level <= depth && frontier.length; level++) {
      const next: typeof frontier = [];
      for (const current of frontier) {
        const target = symbol(current.id)!;
        const incident = store.callLinks(current.id, "incoming", limit + 1);
        const priorReport = reports.get(current.id);
        const possible = priorReport
          ? {
              items: (possibleCache.get(current.id) ?? []).slice(
                0,
                priorReport.links.length,
              ),
              count: priorReport.classCounts.unresolved,
              truncated: priorReport.truncated,
            }
          : possibleFrontier(target);
        reports.set(current.id, {
          symbol: target,
          distance: visited.get(current.id)!.distance,
          links: displayPossible(possible.items),
          classCounts: classCounts(incident.slice(0, limit), possible.count),
          truncated: incident.length > limit || possible.truncated,
        });
        if (incident.length > limit || possible.truncated) truncated = true;
        const steps = [
          ...incident
            .slice(0, limit)
            .map((link) => ({ link, possible: false })),
          ...(includePossible
            ? possible.items.map((item) => ({
                link: item.link,
                possible: true,
              }))
            : []),
        ];
        if (level === depth) {
          if (steps.length) truncated = true;
          continue;
        }
        for (const step of steps) {
          const link = step.link;
          if (!edges.has(link.id) && edges.size >= limit) {
            truncated = true;
            continue;
          }
          edges.set(link.id, link);
          if (!link.sourceId) continue;
          const caller = symbol(link.sourceId);
          if (!caller) continue;
          const certainty: Certainty =
            step.possible || current.certainty === "unresolved"
              ? "unresolved"
              : current.certainty === "definite" && link.targetId === current.id
                ? "definite"
                : "candidate";
          const previous = visited.get(caller.id);
          const distance = current.distance + 1;
          const routeKey = `${caller.id}:${certainty}`;
          if ((seenRoutes.get(routeKey) ?? Infinity) <= distance) continue;
          if (!previous && visited.size >= maxNodes) {
            truncated = true;
            continue;
          }
          visited.set(caller.id, {
            symbol: caller,
            certainty:
              previous && strength[previous.certainty] > strength[certainty]
                ? previous.certainty
                : certainty,
            distance: Math.min(previous?.distance ?? Infinity, distance),
          });
          seenRoutes.set(routeKey, distance);
          // Propagate the actual route, never a combined stronger/shorter imaginary route.
          next.push({ id: caller.id, certainty, distance });
        }
      }
      frontier = next;
    }
    return result(
      {
        symbol: start,
        callers: [...visited.values()].filter(
          (item) => item.symbol.id !== start.id,
        ),
        links: links(
          [...edges.values()].filter(
            (link) => link.resolution !== "unresolved",
          ),
        ),
        possibleTraversalLinks: links(
          [...edges.values()].filter(
            (link) => link.resolution === "unresolved",
          ),
        ),
        maxPossibleLinks: limit,
        includePossible,
        possibleCallers: [...reports.values()],
        hasPossibleCallers: [...reports.values()].some(
          (item) => item.links.length > 0,
        ),
        classCounts: classCounts(
          [...edges.values()],
          new Set(
            [...reports.values()].flatMap((r) => r.links.map((l) => l.id)),
          ).size,
        ),
        depth,
        maxNodes,
        maxEdges: limit,
        visited: visited.size,
      },
      truncated,
    );
  }
  const target = inputs[1]!.matches[0]!;
  let truncated = false;
  const allVisited = new Set([start.id]);
  const observed = new Map<string, GraphLink>();
  function find(allowCandidates: boolean) {
    const queue = [
      {
        id: start.id,
        ids: [start.id],
        edges: [] as GraphLink[],
        certainty: "definite",
      },
    ];
    const visited = new Set([start.id]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]!;
      if (current.id === target.id) {
        return current;
      }
      const outgoing = store.callLinks(current.id, "outgoing", limit + 1);
      if (outgoing.length > limit) truncated = true;
      for (const link of outgoing.slice(0, limit)) {
        if (!observed.has(link.id) && observed.size >= limit) {
          truncated = true;
          continue;
        }
        observed.set(link.id, link);
      }
      if (current.edges.length === depth) {
        if (outgoing.length) truncated = true;
        continue;
      }
      for (const link of outgoing.slice(0, limit)) {
        if (!observed.has(link.id)) continue;
        const endpoints = link.targetId
          ? [link.targetId]
          : allowCandidates
            ? link.candidates.map((item) => item.id)
            : [];
        for (const endpoint of endpoints) {
          if (visited.has(endpoint)) continue;
          if (!allVisited.has(endpoint) && allVisited.size >= maxNodes) {
            truncated = true;
            continue;
          }
          visited.add(endpoint);
          allVisited.add(endpoint);
          queue.push({
            id: endpoint,
            ids: [...current.ids, endpoint],
            edges: [...current.edges, link],
            certainty:
              current.certainty === "definite" && link.targetId === endpoint
                ? "definite"
                : "candidate",
          });
        }
      }
    }
    return null;
  }
  const path = find(false) ?? find(true);
  // A separate reverse walk exposes unresolved suggestions, never relabels them
  // as candidate/definite paths. It has its own explicitly reported budget.
  const possibleReports = [];
  const reversePossible = new Map<
    string,
    ReturnType<typeof possibleFrontier>
  >();
  const reverseQueue = [
    {
      id: target.id,
      ids: [target.id],
      edges: [] as GraphLink[],
      unresolved: false,
    },
  ];
  const reverseVisited = new Set([target.id]);
  const reverseStates = new Set([`${target.id}:false`]);
  let possiblePath: (typeof reverseQueue)[number] | null = null;
  let possibleTruncated = false;
  let reverseEdges = 0;
  for (let cursor = 0; cursor < reverseQueue.length; cursor++) {
    const current = reverseQueue[cursor]!;
    const at = symbol(current.id)!;
    const priorPossible = reversePossible.get(current.id);
    const possible = priorPossible ?? possibleFrontier(at);
    reversePossible.set(current.id, possible);
    if (!priorPossible)
      possibleReports.push({
        symbol: at,
        distance: current.edges.length,
        links: displayPossible(possible.items),
        classCounts: classCounts(
          store.callLinks(current.id, "incoming", limit + 1).slice(0, limit),
          possible.count,
        ),
        truncated: possible.truncated,
      });
    if (possible.truncated) possibleTruncated = true;
    if (current.id === start.id && current.unresolved && !possiblePath)
      possiblePath = current;
    const incoming = store.callLinks(current.id, "incoming", limit + 1);
    if (incoming.length > limit) possibleTruncated = true;
    const steps = [
      ...incoming.slice(0, limit).map((link) => ({ link, unresolved: false })),
      ...possible.items.map((item) => ({ link: item.link, unresolved: true })),
    ];
    if (current.edges.length === depth) {
      if (steps.length) possibleTruncated = true;
      continue;
    }
    for (const step of steps) {
      if (reverseEdges >= limit) {
        possibleTruncated = true;
        break;
      }
      reverseEdges++;
      const id = step.link.sourceId;
      const unresolved = current.unresolved || step.unresolved;
      const state = `${id}:${unresolved}`;
      if (!id || !symbol(id) || reverseStates.has(state)) continue;
      if (!reverseVisited.has(id) && reverseVisited.size >= maxNodes) {
        possibleTruncated = true;
        continue;
      }
      reverseVisited.add(id);
      reverseStates.add(state);
      reverseQueue.push({
        id,
        ids: [id, ...current.ids],
        edges: [step.link, ...current.edges],
        unresolved,
      });
    }
  }
  truncated ||= possibleTruncated;

  return result(
    {
      hasPossibleCallers: possibleReports.some((item) => item.links.length > 0),
      possibleCallers: possibleReports,
      classCounts: classCounts(
        [...observed.values()],
        new Set(possibleReports.flatMap((r) => r.links.map((l) => l.id))).size,
      ),
      possiblePath: possiblePath
        ? {
            certainty: "unresolved",
            symbols: possiblePath.ids.map(symbol),
            links: links(possiblePath.edges),
          }
        : null,
      possibleBounds: {
        maxPossibleLinks: limit,
        depth,
        maxNodes,
        maxEdges: limit,
        visited: reverseVisited.size,
        truncated: possibleTruncated,
      },
      from: start,
      to: target,
      found: path !== null,
      certainty: path?.certainty ?? null,
      symbols: path?.ids.map(symbol) ?? [],
      links: links(path?.edges ?? []),
      observedLinks: links([...observed.values()]),
      depth,
      maxNodes,
      maxEdges: limit,
      visited: allVisited.size,
    },
    truncated,
    path ? "ok" : "bounded",
  );
}
