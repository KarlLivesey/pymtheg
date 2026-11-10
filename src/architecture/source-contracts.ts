import { relative, isAbsolute } from "node:path";
import { setImmediate as yieldToCoordinator } from "node:timers/promises";
import { hash } from "../shared/identity.js";
import type { ProjectIR } from "../semantic/core.js";
import { blockedSymbols } from "../semantic/core.js";
import type { TypeRef } from "../language/ast.js";

export {
  sourceContractsPath,
  sourceContractSchema,
  sourceCatalogueSchema,
} from "../shared/source-contracts.js";
import {
  sourceCatalogueSchema,
  type SourceCatalogue,
  type SourceContract,
} from "../shared/source-contracts.js";
export type {
  SourceContract,
  SourceCatalogue,
} from "../shared/source-contracts.js";
function normalized(value: unknown, depth = 0): unknown {
  if (depth > 256) throw Error("Source contract nesting exceeds 256 levels");
  if (typeof value === "bigint") return { $integer: String(value) };
  if (Array.isArray(value)) return value.map((v) => normalized(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            key !== "id" &&
            key !== "span" &&
            !key.endsWith("Span") &&
            !key.endsWith("Spans"),
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, normalized(v, depth + 1)]),
    );
  return value;
}
/** Projection of one canonical IR. It neither reparses nor writes source/store data. */
export function sourceCatalogue(ir: ProjectIR, root: string): SourceCatalogue {
  const portable = (file: string) => {
    const path = relative(root, file).split("\\").join("/");
    if (path === ".." || path.startsWith("../") || isAbsolute(path))
      throw Error("Source contract is outside the selected project");
    return path;
  };
  const sources = new Map(ir.snapshot.sources.map((s) => [s.file, s]));
  const ids = new Map(
    ir.declarations.map((d) => [
      d.id,
      `source:${portable(d.span.file)}#${d.name}`,
    ]),
  );
  const counts = new Map<string, number>();
  const resolvedDependencies = new Map<string, string[]>();
  for (const edge of ir.edges)
    if (ids.has(edge.from) && ids.has(edge.to)) {
      const list = resolvedDependencies.get(edge.from) ?? [];
      list.push(edge.kind + ":" + ids.get(edge.to)!);
      resolvedDependencies.set(edge.from, list);
    }
  for (const list of resolvedDependencies.values()) list.sort();
  for (const d of ir.declarations)
    counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
  const blocked = blockedSymbols(ir);
  const type = (t: TypeRef): string =>
    t.name + (t.args.length ? `<${t.args.map(type).join(", ")}>` : "");
  const entries = ir.declarations.map((d) => {
    const source = sources.get(d.span.file)!;
    const normalizedDeclaration = normalized(d) as Record<string, unknown>;
    const declaration = JSON.stringify(normalizedDeclaration);
    const { name: _name, ...replacementShape } = normalizedDeclaration;
    return {
      id: ids.get(d.id)!,
      snapshotId: ir.snapshot.id,
      symbolId: portable(d.span.file) + "#" + d.name,
      name: d.name,
      kind: d.kind,
      file: portable(d.span.file),
      signature:
        "params" in d
          ? `${d.kind} ${d.name}(${d.params.map((p) => `${p.mode === "value" ? "" : p.mode + " "}${p.name}: ${type(p.type)}`).join(", ")}) -> ${type(d.result)}`
          : `${d.kind} ${d.name}`,
      declaration,
      replacementHash: hash(JSON.stringify(replacementShape)),
      declarationHash: hash(
        declaration +
          "\0" +
          JSON.stringify(resolvedDependencies.get(d.id) ?? []),
      ),
      sourceHash: source.hash,
      source: source.text.slice(d.span.start, d.span.end),
      start: d.span.start,
      end: d.span.end,
      modelStatus:
        counts.get(d.id)! > 1
          ? ("ambiguous" as const)
          : blocked.has(d.id)
            ? ("incomplete" as const)
            : ("checked" as const),
    };
  });
  return sourceCatalogueSchema.parse({
    schema: "pymtheg.source-contracts/v1",
    snapshotId: ir.snapshot.id,
    entries,
    dependencies: ir.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        from: ids.get(e.from)!,
        to: ids.get(e.to)!,
        kind: e.kind,
      })),
    incompleteFiles: ir.snapshot.sources
      .filter((s) => s.recovered)
      .map((s) => portable(s.file)),
    diagnostics: ir.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => ({
        file: portable(d.span.file),
        code: d.code,
        message: d.message,
      })),
    meaning:
      "A typed design snapshot, not proof of a requirement or handwritten implementation. Incomplete models remain explicit.",
  });
}
/** One reverse walk covers changed declarations and dependent source targets. */
export function affectedSourceContracts(
  before: SourceCatalogue,
  after: SourceCatalogue,
): Set<string> {
  const current = new Map(after.entries.map((e) => [e.id, e]));
  const previous = new Map(before.entries.map((e) => [e.id, e]));
  const affected = new Set<string>();
  for (const id of new Set([...previous.keys(), ...current.keys()]))
    if (
      previous.get(id)?.declarationHash !== current.get(id)?.declarationHash ||
      previous.get(id)?.modelStatus !== current.get(id)?.modelStatus
    )
      affected.add(id);
  const reverse = new Map<string, Set<string>>();
  for (const e of [...before.dependencies, ...after.dependencies]) {
    const users = reverse.get(e.to) ?? new Set();
    users.add(e.from);
    reverse.set(e.to, users);
  }
  const queue = [...affected];
  for (let index = 0; index < queue.length; index++)
    for (const id of reverse.get(queue[index]!) ?? [])
      if (!affected.has(id)) {
        affected.add(id);
        queue.push(id);
      }
  return affected;
}

export function sourceExpectations(
  catalogue: SourceCatalogue,
  targets: readonly string[],
) {
  return expectationResolver(catalogue)(targets);
}

export function sourceExpectationSets(
  catalogue: SourceCatalogue,
  roots: readonly string[],
) {
  const resolve = expectationResolver(catalogue, 1000000);
  return Object.fromEntries(roots.map((root) => [root, resolve([root])]));
}

function expectationResolver(catalogue: SourceCatalogue, budget = Infinity) {
  let visits = 0;
  const entries = new Map(catalogue.entries.map((e) => [e.id, e]));
  const graph = new Map<string, Set<string>>();
  for (const edge of catalogue.dependencies) {
    const list = graph.get(edge.from) ?? new Set<string>();
    list.add(edge.to);
    graph.set(edge.from, list);
  }
  return (targets: readonly string[]) => {
    const pending = [...targets],
      seen = new Set<string>(),
      result: Record<string, string> = {};
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      if (++visits > budget)
        throw Error(
          "Source-root mapping exceeded 1,000,000 dependency visits. Split this plan into smaller components before reviewing it.",
        );
      seen.add(id);
      const entry = entries.get(id);
      if (entry) result[id] = sourceExpectationHash(entry);
      for (const dependency of graph.get(id) ?? []) pending.push(dependency);
    }
    return result;
  };
}

export function sourceExpectationHash(entry: SourceContract) {
  return hash(entry.declarationHash + "|" + entry.modelStatus);
}

export function retainSourceCatalogue(
  previous: SourceCatalogue | null,
  current: SourceCatalogue,
): SourceCatalogue {
  const entries = new Map((previous?.entries ?? []).map((e) => [e.id, e]));
  for (const entry of current.entries) entries.set(entry.id, entry);
  const updated = new Set(current.entries.map((e) => e.id));
  const history = new Map(
    [
      ...(previous?.history ?? []),
      ...(previous?.entries ?? []),
      ...current.entries,
    ].map((e) => [
      e.id + ":" + sourceExpectationHash(e) + ":" + e.sourceHash,
      e,
    ]),
  );
  return {
    ...current,
    snapshotId: hash(
      JSON.stringify(
        [...entries.values()].map((e) => [
          e.id,
          e.declarationHash,
          e.snapshotId,
        ]),
      ),
    ),
    entries: [...entries.values()],
    history: [...history.values()],
    dependencies: [
      ...(previous?.dependencies ?? []).filter((e) => !updated.has(e.from)),
      ...current.dependencies,
    ],
    meaning:
      "Retained source snapshots captured with planning records. Each entry retains its source snapshot; this collection is not proof of implementation behaviour.",
  };
}

/** Advisory repair candidates; this never establishes declaration identity. */
export function sourceReplacementCandidates(
  previous: SourceContract,
  current: SourceCatalogue,
) {
  const shape = (entry: SourceContract) => {
    const value = JSON.parse(entry.declaration) as Record<string, unknown>;
    const { name: _name, ...rest } = value;
    return hash(JSON.stringify(rest));
  };
  const oldShape = previous.replacementHash ?? shape(previous);
  return current.entries
    .filter(
      (entry) =>
        entry.id !== previous.id &&
        entry.kind === previous.kind &&
        entry.modelStatus !== "ambiguous",
    )
    .map((entry) => ({
      entry,
      sameDeclaration: entry.replacementHash === oldShape,
    }))
    .filter(
      ({ entry, sameDeclaration }) =>
        sameDeclaration || entry.name === previous.name,
    )
    .sort(
      (a, b) =>
        Number(b.sameDeclaration) - Number(a.sameDeclaration) ||
        (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
    )
    .map(({ entry, sameDeclaration }) => ({
      id: entry.id,
      name: entry.name,
      file: entry.file,
      signature: entry.signature,
      reason: sameDeclaration
        ? "Same declaration apart from its name; dependencies still need review."
        : "Same name and kind at another path; contents may differ.",
    }));
}

/** Shortest dependency routes, with bounded display output and cycle-safe graph work. */
export async function sourceDependencyPaths(
  catalogue: SourceCatalogue,
  root: string,
  targets: readonly string[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!targets.some((target) => target !== root)) return [];
  let visits = 0;
  const adjacency = new Map<string, Set<string>>();
  for (const edge of catalogue.dependencies) {
    if (++visits % 1024 === 0) {
      await yieldToCoordinator();
      signal?.throwIfAborted();
    }
    const list = adjacency.get(edge.from) ?? new Set<string>();
    list.add(edge.to);
    adjacency.set(edge.from, list);
  }
  const parents = new Map<string, string | null>([[root, null]]),
    queue = [root];
  for (let position = 0; position < queue.length; position++) {
    if (++visits % 1024 === 0) {
      await yieldToCoordinator();
      signal?.throwIfAborted();
    }
    const from = queue[position]!;
    for (const to of adjacency.get(from) ?? []) {
      if (++visits % 1024 === 0) {
        await yieldToCoordinator();
        signal?.throwIfAborted();
      }
      if (!parents.has(to)) {
        parents.set(to, from);
        queue.push(to);
      }
    }
  }
  const paths: { target: string; via: string[]; truncated: boolean }[] = [];
  let bytes = 0;
  for (const target of targets) {
    if (target === root || !parents.has(target)) continue;
    const via: string[] = [];
    let cursor: string | null = target;
    while (cursor !== null && via.length < 16) {
      via.unshift(cursor);
      cursor = parents.get(cursor) ?? null;
    }
    const item = { target, via, truncated: cursor !== null };
    const size = Buffer.byteLength(JSON.stringify(item));
    if (paths.length >= 10 || bytes + size > 49152) break;
    paths.push(item);
    bytes += size;
  }
  return paths;
}
