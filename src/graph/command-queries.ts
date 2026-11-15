import type { SqliteGraphStore } from "./store.js";
import { GraphLocations, type Located } from "./command-locations.js";
import type { GraphLink, GraphSymbol } from "./types.js";

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
  if (command === "callers" || command === "callees") {
    const found =
      command === "callers"
        ? store.callLinks(start.id, "incoming", limit + 1)
        : store.callLinks(start.id, "outgoing", limit + 1);
    return result(
      { symbol: start, links: links(found.slice(0, limit)), limit },
      found.length > limit,
    );
  }
  // Bounded breadth-first traversal. Candidate edges retain uncertainty at every hop.
  const maxNodes = limit;
  if (command === "impact") {
    const visited = new Map<
      string,
      {
        symbol: GraphSymbol;
        certainty: "definite" | "candidate";
        distance: number;
      }
    >();
    visited.set(start.id, {
      symbol: start,
      certainty: "definite",
      distance: 0,
    });
    let frontier = [start.id];
    const edges = new Map<string, GraphLink>();
    let truncated = false;
    for (let level = 0; level < depth && frontier.length; level++) {
      const next: string[] = [];
      for (const id of frontier) {
        const incident = store.callLinks(id, "incoming", limit + 1);
        if (incident.length > limit) truncated = true;
        for (const link of incident.slice(0, limit)) {
          if (!edges.has(link.id) && edges.size >= limit) {
            truncated = true;
            continue;
          }
          edges.set(link.id, link);
          if (!link.sourceId) continue;
          const caller = symbol(link.sourceId);
          if (!caller) continue;
          const certainty =
            visited.get(id)!.certainty === "definite" && link.targetId === id
              ? "definite"
              : "candidate";
          const previous = visited.get(caller.id);
          if (
            previous &&
            (previous.certainty === "definite" || certainty === "candidate")
          )
            continue;
          if (!previous && visited.size >= maxNodes) {
            truncated = true;
            continue;
          }
          visited.set(caller.id, {
            symbol: caller,
            certainty,
            distance: level + 1,
          });
          next.push(caller.id);
        }
      }
      frontier = next;
    }
    if (
      frontier.some(
        (id) => store.callLinks(id, "incoming", limit + 1).length > 0,
      )
    )
      truncated = true;
    return result(
      {
        symbol: start,
        callers: [...visited.values()].filter(
          (item) => item.symbol.id !== start.id,
        ),
        links: links([...edges.values()]),
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
  return result(
    {
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
