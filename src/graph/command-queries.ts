import type { SqliteGraphStore } from "./store.js";
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
): QueryResult {
  const cache = new Map<string, GraphSymbol | undefined>();
  const symbol = (id: string) => {
    if (!cache.has(id)) cache.set(id, store.getSymbol(id));
    return cache.get(id) ?? null;
  };
  const links = (items: GraphLink[]) =>
    items.map((link) => ({
      ...link,
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
  const select = (input: string) =>
    /^symbol:[a-f0-9]{64}$/.test(input)
      ? [symbol(input)].filter((s): s is GraphSymbol => s !== null)
      : store.namedSymbols(input, limit + 1);
  const result = (
    data: Record<string, unknown>,
    truncated = false,
    status: QueryResult["status"] = "ok",
  ): QueryResult => ({ data, truncated, status });
  if (command === "search") {
    const found = store.searchSymbols(args[0]!, limit + 1);
    return result(
      { matches: found.slice(0, limit), limit },
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
        symbols: symbols.slice(0, limit),
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
