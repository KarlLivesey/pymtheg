// SPDX-License-Identifier: MIT
import { hash, json } from "../shared/identity.js";
import { compareText } from "../shared/order.js";
import type { ObservedGraph } from "./schema.js";

export const dependencyEdge = (e: ObservedGraph["edges"][number]) =>
  e.to !== null &&
  ["references", "calls", "uses-type", "written-by"].includes(e.kind);
/** Iterative SCC condensation: every graph is traversed once, including cycles.
 * Hashes describe observed dependencies, never complete runtime dependencies. */
export function dependencyHashes(
  graph: ObservedGraph | null | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  if (!graph?.dependencyModel) return result;
  const nodes = graph.nodes,
    index = new Map(nodes.map((n, i) => [n.id, i]));
  const out = nodes.map(() => new Set<number>()),
    incoming = nodes.map(() => new Set<number>());
  for (const edge of graph.edges)
    if (dependencyEdge(edge)) {
      const a = index.get(edge.from),
        b = index.get(edge.to!);
      if (a !== undefined && b !== undefined) {
        out[a]!.add(b);
        incoming[b]!.add(a);
      }
    }
  const visited = new Set<number>(),
    order: number[] = [];
  for (let start = 0; start < nodes.length; start++) {
    if (visited.has(start)) continue;
    const stack: [number, boolean][] = [[start, false]];
    while (stack.length) {
      const [v, done] = stack.pop()!;
      if (done) {
        order.push(v);
        continue;
      }
      if (visited.has(v)) continue;
      visited.add(v);
      stack.push([v, true]);
      for (const next of out[v]!)
        if (!visited.has(next)) stack.push([next, false]);
    }
  }
  const components: number[][] = [],
    component = new Map<number, number>();
  for (const start of order.reverse()) {
    if (component.has(start)) continue;
    const id = components.length,
      members: number[] = [],
      stack = [start];
    component.set(start, id);
    while (stack.length) {
      const v = stack.pop()!;
      members.push(v);
      for (const next of incoming[v]!)
        if (!component.has(next)) {
          component.set(next, id);
          stack.push(next);
        }
    }
    components.push(members);
  }
  const children = components.map(() => new Set<number>()),
    parents = components.map(() => new Set<number>());
  for (let a = 0; a < nodes.length; a++)
    for (const b of out[a]!) {
      const ca = component.get(a)!,
        cb = component.get(b)!;
      if (ca !== cb) {
        children[ca]!.add(cb);
        parents[cb]!.add(ca);
      }
    }
  const pending = children.map((c) => c.size),
    ready = pending.flatMap((n, i) => (n === 0 ? [i] : [])),
    hashes = new Map<number, string>();
  const local = (i: number) =>
    json([nodes[i]!.id, nodes[i]!.declarationHash, nodes[i]!.bodyHash]);
  while (ready.length) {
    const c = ready.pop()!;
    hashes.set(
      c,
      hash(
        json([
          components[c]!.map(local).sort(compareText),
          [...children[c]!].map((x) => hashes.get(x)!).sort(compareText),
        ]),
      ),
    );
    for (const parent of parents[c]!) {
      pending[parent] = pending[parent]! - 1;
      if (pending[parent] === 0) ready.push(parent);
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    // Include a cyclic component's peers; for acyclic nodes exclude own text.
    const dependencies = [...out[i]!]
      .map((v) => hashes.get(component.get(v)!)!)
      .sort(compareText);
    result.set(nodes[i]!.id, hash(json(dependencies)));
  }
  return result;
}

export function dependencyChanges(
  before: ObservedGraph | null | undefined,
  after: ObservedGraph | null | undefined,
  id: string,
) {
  const collect = (graph: ObservedGraph | null | undefined) => {
    const found = new Map<string, ObservedGraph["nodes"][number]>();
    if (!graph?.dependencyModel) return found;
    const nodes = new Map(graph.nodes.map((n) => [n.id, n])),
      out = new Map<string, string[]>();
    for (const e of graph.edges)
      if (dependencyEdge(e)) {
        const list = out.get(e.from) ?? [];
        list.push(e.to!);
        out.set(e.from, list);
      }
    const seen = new Set([id]),
      queue = [id];
    while (queue.length)
      for (const next of out.get(queue.pop()!) ?? []) {
        // A captured cycle can make this declaration's own edit part of its
        // fingerprint. Show that exact cause rather than an empty change list.
        if (next === id && nodes.has(id)) found.set(id, nodes.get(id)!);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
          const node = nodes.get(next);
          if (node) found.set(next, node);
        }
      }
    return found;
  };
  const a = collect(before),
    b = before === after ? a : collect(after),
    items = [];
  let total = 0;
  const beforeFiles = new Map(before?.files.map((f) => [f.path, f]) ?? []);
  const afterFiles = new Map(after?.files.map((f) => [f.path, f]) ?? []);
  const source = (
    graph: ObservedGraph | null | undefined,
    node: ObservedGraph["nodes"][number] | undefined,
  ) => {
    if (!node) return null;
    const file = (graph === before ? beforeFiles : afterFiles).get(
      node.span.file,
    );
    return (
      file?.text?.slice(
        node.span.start,
        Math.min(node.span.end, node.span.start + 2000),
      ) ?? null
    );
  };
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort(
    compareText,
  )) {
    const old = a.get(key),
      current = b.get(key);
    if (
      old?.declarationHash === current?.declarationHash &&
      old?.bodyHash === current?.bodyHash
    )
      continue;
    total++;
    if (items.length >= 100) continue;
    items.push({
      id: key,
      name: current?.qualifiedName ?? old!.qualifiedName,
      file: current?.span.file ?? old!.span.file,
      change: !old ? "added" : !current ? "removed" : "changed",
      before: source(before, old),
      after: source(after, current),
      truncated: !!(
        (old && old.span.end - old.span.start > 2000) ||
        (current && current.span.end - current.span.start > 2000)
      ),
    });
  }
  return {
    available: !!before?.dependencyModel && !!after?.dependencyModel,
    total,
    items,
    truncated: total > 100,
    meaning:
      "Captured lexical bindings and resolved calls/types only. Dynamic, external and uncaptured dependencies remain unknown.",
  };
}
