// SPDX-License-Identifier: MIT
import type { ContractDocument, ContractType } from "./document.js";

/** Inline storage cycles need indirection in value-layout target languages.
 * Lists already own indirection; Go unions/results are interfaces. This decides
 * representation only, never source semantics, and does not expand named types.
 * Iterative SCC traversal is O(declarations + inline references).
 */
export function recursiveLayout(doc: ContractDocument, target: "rust" | "go") {
  const declarations = new Map(doc.declarations.map((d) => [d.symbolId, d]));
  const graph = new Map<string, Set<string>>();
  for (const d of doc.declarations) {
    const edges = new Set<string>();
    graph.set(d.symbolId, edges);
    const pending: ContractType[] =
      d.kind === "record"
        ? d.fields.map((f) => f.type)
        : target === "rust" && d.kind === "union"
          ? d.variants.flatMap((v) => (v.payload ? [v.payload] : []))
          : [];
    while (pending.length) {
      const type = pending.pop()!;
      if (type.kind === "named") {
        const referenced = declarations.get(type.symbolId);
        if (referenced && (target === "rust" || referenced.kind === "record"))
          edges.add(type.symbolId);
      } else if (type.kind === "result" && target === "rust")
        pending.push(type.ok, type.error);
    }
  }
  const reverse = new Map(
    [...graph.keys()].map((id) => [id, new Set<string>()]),
  );
  for (const [id, edges] of graph)
    for (const next of edges) reverse.get(next)!.add(id);
  const visited = new Set<string>(),
    order: string[] = [];
  for (const id of graph.keys()) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, remaining: [...graph.get(id)!], next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const next = frame.remaining[frame.next++];
      if (next !== undefined) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, remaining: [...graph.get(next)!], next: 0 });
        }
      } else {
        order.push(frame.id);
        stack.pop();
      }
    }
  }
  const components = new Map<string, number>(),
    sizes: number[] = [];
  for (const id of order.reverse()) {
    if (components.has(id)) continue;
    const component = sizes.length,
      pending = [id];
    let size = 0;
    components.set(id, component);
    while (pending.length) {
      const next = pending.pop()!;
      size++;
      for (const parent of reverse.get(next)!)
        if (!components.has(parent)) {
          components.set(parent, component);
          pending.push(parent);
        }
    }
    sizes.push(size);
  }
  const needsIndirection = (owner: string | undefined, referenced: string) =>
    owner !== undefined &&
    graph.get(owner)?.has(referenced) === true &&
    components.get(owner) === components.get(referenced) &&
    (owner === referenced || sizes[components.get(owner)!]! > 1);
  const recursive = [...graph].some(([owner, edges]) =>
    [...edges].some((reference) => needsIndirection(owner, reference)),
  );
  return {
    needsIndirection,
    recursive,
    measurements: {
      declarations: graph.size,
      references: [...graph.values()].reduce((n, edges) => n + edges.size, 0),
    },
  };
}
