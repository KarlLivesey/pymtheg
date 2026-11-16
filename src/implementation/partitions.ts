// SPDX-License-Identifier: MIT
import { hash } from "../shared/identity.js";
import {
  readObservedGraph,
  type ObservedGraph,
  type ObservedSource,
} from "./schema.js";

/** Whole files stay together; each parse context has a deterministic byte bound. */
export function partitionSources(
  files: readonly ObservedSource[],
  maximumBytes = 3 * 1024 * 1024,
): ObservedSource[][] {
  const batches: ObservedSource[][] = [];
  let current: ObservedSource[] = [],
    bytes = 0;
  for (const file of [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    const size = Buffer.byteLength(file.text);
    if (current.length && bytes + size > maximumBytes) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Union declarations without inventing symbol resolution between parse contexts. */
export function combinePartitions(
  parts: readonly ObservedGraph[],
): ObservedGraph {
  return qualifyGraphs(parts, true);
}

/** Qualify full-parser targets with provenance; never recover extra targets. */
export function qualifyObservation(graph: ObservedGraph): ObservedGraph {
  return qualifyGraphs([graph], false);
}

function qualifyGraphs(
  parts: readonly ObservedGraph[],
  partitioned: boolean,
): ObservedGraph {
  if (!parts.length) throw Error("No code partitions were captured.");
  const first = parts[0]!;
  const originIndependentTargets = new Set(
    parts.flatMap((p) => p.originIndependentTargets ?? []),
  );
  const requireOriginsIncomplete = parts.some(
    (p) => p.requireOriginsIncomplete,
  );
  if (
    parts.some(
      (part) =>
        part.projectId !== first.projectId ||
        JSON.stringify(part.version) !== JSON.stringify(first.version),
    )
  )
    throw Error(
      "Code partitions must belong to one captured project and version.",
    );
  const files = parts.flatMap((p) => p.files);
  if (new Set(files.map((f) => f.path)).size !== files.length)
    throw Error("Code partitions overlap; no source replacement was inferred.");
  const nodes = parts.flatMap((p) => p.nodes);
  const key = (node: ObservedGraph["nodes"][number]) =>
    node.kind === "method" ? "method:" + node.qualifiedName : node.name;
  const scopes = new Map<string, Set<number>>();
  for (const [index, part] of parts.entries())
    for (const node of part.nodes) {
      if (node.kind === "module" || node.moduleScoped) continue;
      const owners = scopes.get(key(node)) ?? new Set<number>();
      owners.add(index);
      scopes.set(key(node), owners);
    }
  const ambiguous = new Set(
    nodes
      .filter(
        (node) => !node.moduleScoped && (scopes.get(key(node))?.size ?? 0) > 1,
      )
      .map((node) => node.id),
  );
  const exported = parts.flatMap((p) => p.exports ?? []);
  const exportTargets = new Map(
    exported.map((e) => [e.file + "\0" + e.name, e]),
  );
  const exportsByFile = new Map<string, typeof exported>();
  for (const entry of exported) {
    const group = exportsByFile.get(entry.file) ?? [];
    group.push(entry);
    exportsByFile.set(entry.file, group);
  }
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const independentCall = (edge: ObservedGraph["edges"][number]) =>
    !!edge.to &&
    originIndependentTargets.has(edge.to) &&
    nodeMap.get(edge.to)?.span.file === edge.span.file &&
    nodeMap.get(edge.to)?.name === edge.targetName;

  const rawWrites = parts.flatMap((p) => p.importedWrites ?? []);
  const rawEscapes = [
    ...new Map(
      parts
        .flatMap((p) => p.escapedImports ?? [])
        .map((e) => [JSON.stringify(e), e]),
    ).values(),
  ];
  const moduleObjectAliases = [
    ...new Map(
      parts
        .flatMap((p) => p.moduleObjectAliases ?? [])
        .map((a) => [JSON.stringify(a), a]),
    ).values(),
  ];
  const aliasGraph = new Map<string, Set<string>>();
  for (const alias of moduleObjectAliases)
    for (const [a, b] of [
      [alias.file, alias.target],
      [alias.target, alias.file],
    ]) {
      const group = aliasGraph.get(a!) ?? new Set<string>();
      group.add(b!);
      aliasGraph.set(a!, group);
    }
  const moduleMemberAliases = [
    ...new Map(
      parts
        .flatMap((p) => p.moduleMemberAliases ?? [])
        .map((a) => [JSON.stringify(a), a]),
    ).values(),
  ];
  const memberAliases = new Map<string, typeof moduleMemberAliases>();
  const memberAliasesByFile = new Map<string, typeof moduleMemberAliases>();
  for (const alias of moduleMemberAliases) {
    const key = alias.file + "\0" + alias.name,
      group = memberAliases.get(key) ?? [];
    group.push(alias);
    memberAliases.set(key, group);
    const fileGroup = memberAliasesByFile.get(alias.file) ?? [];
    fileGroup.push(alias);
    memberAliasesByFile.set(alias.file, fileGroup);
  }
  type Escape = NonNullable<ObservedGraph["escapedImports"]>[number];
  type Write = NonNullable<ObservedGraph["importedWrites"]>[number];
  const importedWrites: Write[] = [],
    escapedImports: Escape[] = [];
  const commonjsFiles = new Set(parts.flatMap((p) => p.commonjsFiles ?? []));
  const queue: (Escape | Write)[] = [...rawWrites, ...rawEscapes],
    qualifiers = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    let entry = queue[i]!;
    if (
      entry.name === "default" &&
      entry.memberObject &&
      commonjsFiles.has(entry.file)
    ) {
      const { memberObject, ...rest } = entry;
      entry = { ...rest, name: "*", moduleObject: true };
    }
    const key = JSON.stringify(entry);
    if (qualifiers.has(key)) continue;
    qualifiers.add(key);
    if ("writer" in entry) importedWrites.push(entry);
    else escapedImports.push(entry);
    for (const file of aliasGraph.get(entry.file) ?? [])
      queue.push({ ...entry, file });
    const forwards = entry.moduleObject
      ? memberAliasesByFile.get(entry.file)
      : [
          ...(entry.memberObject
            ? (memberAliases.get(entry.file + "\0" + entry.name) ?? [])
            : []),
          ...(memberAliases.get(entry.file + "\0*") ?? []),
        ];
    for (const alias of forwards ?? []) {
      const { moduleObject, memberObject, ...other } = entry;
      queue.push({
        ...other,
        file: alias.target,
        name: alias.targetName ?? "*",
        ...(alias.targetName === undefined
          ? { moduleObject: true as const }
          : { memberObject: true as const }),
      });
    }
  }
  const written = new Set<string>();
  const writeSpans = new Map<string, { start: number; end: number }[]>();
  const opaqueExportFiles = [
    ...new Set(parts.flatMap((p) => p.opaqueExportFiles ?? [])),
  ];
  for (const file of opaqueExportFiles) {
    const node = nodeMap.get("file:" + file);
    if (node) writeSpans.set(file, [node.span]);
  }
  const writerEdges: ObservedGraph["edges"] = [];
  const escapedRoots = new Set<string>();
  const unstableConstructors = new Set(
    exported
      .filter(
        (e) =>
          e.mutable &&
          e.callableMutable !== false &&
          nodeMap.get(e.nodeId)?.kind === "class",
      )
      .map((e) => e.nodeId),
  );
  const classesByFile = new Map<string, string[]>(),
    opaqueFiles = new Set<string>();
  for (const node of nodes)
    if (node.kind === "class") {
      const group = classesByFile.get(node.span.file) ?? [];
      group.push(node.id);
      classesByFile.set(node.span.file, group);
    }
  for (const file of opaqueExportFiles)
    for (const id of classesByFile.get(file) ?? [])
      unstableConstructors.add(id);
  function opaqueFile(file: string) {
    if (opaqueFiles.has(file)) return;
    opaqueFiles.add(file);
    escapedRoots.add(`file:${file}`);
    for (const id of classesByFile.get(file) ?? [])
      unstableConstructors.add(id);
    for (const entry of exportsByFile.get(file) ?? []) {
      if (nodeMap.get(entry.nodeId)?.kind === "module") {
        for (const node of nodes)
          if (node.span.file === file && node.kind === "method") {
            const spans = writeSpans.get(file) ?? [];
            spans.push(node.span);
            writeSpans.set(file, spans);
          }
      } else qualify(entry, true);
    }
  }
  function qualify(entry: (typeof exported)[number], constructor = false) {
    const node = nodeMap.get(entry.nodeId);
    if (!node) return;
    if (node.kind === "module") {
      escapedRoots.add(node.id);
      for (const candidate of nodes)
        if (
          candidate.span.file === node.span.file &&
          candidate.kind === "method"
        ) {
          const spans = writeSpans.get(node.span.file) ?? [];
          spans.push(candidate.span);
          writeSpans.set(node.span.file, spans);
        }
      return;
    }
    if (constructor && node.kind === "class") unstableConstructors.add(node.id);
    escapedRoots.add(node.id);
    const spans = writeSpans.get(node.span.file) ?? [];
    spans.push(node.span);
    writeSpans.set(node.span.file, spans);
  }
  function entriesFor(file: string, name: string, object = false) {
    return (exportsByFile.get(file) ?? []).filter(
      (e) =>
        name === "*" ||
        e.name === name ||
        (object && e.name.startsWith(name + ".")),
    );
  }
  for (const write of importedWrites) {
    if (write.moduleObject) {
      opaqueFile(write.file);
      continue;
    }
    const writer = nodeMap.get(write.writer);
    if (!writer) continue;
    for (const entry of entriesFor(
      write.file,
      write.name,
      !!write.memberObject,
    )) {
      qualify(entry, true);
      const binding = nodeMap.get(entry.nodeId);
      if (!binding || binding.kind === "module") continue;
      writerEdges.push({
        from: binding.id,
        to: writer.id,
        targetName: writer.qualifiedName,
        kind: "written-by",
        resolution: "resolved",
        targetKind: "project",
        span: write.span,
      });
    }
  }
  for (const escaped of escapedImports) {
    if (escaped.moduleObject) {
      opaqueFile(escaped.file);
      continue;
    }
    for (const entry of entriesFor(
      escaped.file,
      escaped.name,
      !!escaped.memberObject,
    )) {
      const binding = nodeMap.get(entry.nodeId);
      if (binding?.kind !== "function")
        qualify(
          entry,
          escaped.name === "*" ||
            (!!escaped.memberObject &&
              binding?.kind === "class" &&
              /\.d\.[cm]?ts$/.test(binding.span.file)),
        );
    }
  }

  for (const entry of exported)
    if (entry.mutable && nodeMap.get(entry.nodeId)?.kind === "class")
      escapedRoots.add(entry.nodeId);
  const origins = new Map<string, string[]>();
  for (const part of parts)
    for (const edge of part.edges)
      if (edge.kind === "calls" && edge.to) {
        const group = origins.get(edge.from) ?? [];
        group.push(edge.to);
        origins.set(edge.from, group);
      }
  const inheritanceOrigins = parts.flatMap((p) => p.inheritanceOrigins ?? []);
  const inheritanceForwards = parts.flatMap((p) => p.inheritanceForwards ?? []);
  const inheritanceOwners = new Set(inheritanceOrigins.map((o) => o.owner));
  const classForwards = new Map<
    string,
    {
      file: string;
      name: string;
      target: string;
      targetName?: string | undefined;
      esm: boolean;
    }[]
  >();
  for (const [values, esm] of [
    [moduleMemberAliases, false],
    [inheritanceForwards, true],
  ] as const)
    for (const value of values) {
      const key = value.file + "\0" + value.name,
        group = classForwards.get(key) ?? [];
      group.push({ ...value, esm });
      classForwards.set(key, group);
    }
  const classTargetCache = new Map<string, Set<string>>();
  function classTargets(file: string, name: string) {
    const cacheKey = file + "\0" + name,
      cached = classTargetCache.get(cacheKey);
    if (cached) return cached;
    const found = new Set<string>(),
      queue = [{ file, name }],
      seen = new Set<string>();
    while (queue.length) {
      const ref = queue.pop()!,
        key = ref.file + "\0" + ref.name;
      if (seen.has(key)) continue;
      seen.add(key);
      const entries =
        ref.name === "*"
          ? (exportsByFile.get(ref.file) ?? [])
          : [exportTargets.get(key)].filter(
              (e): e is (typeof exported)[number] => !!e,
            );
      for (const entry of entries)
        if (
          nodeMap.get(entry.nodeId)?.kind === "class" ||
          inheritanceOwners.has(entry.nodeId)
        )
          found.add(entry.nodeId);
      for (const alias of [
        ...(classForwards.get(key) ?? []),
        ...(ref.name === "*"
          ? []
          : (classForwards.get(ref.file + "\0*") ?? [])),
      ])
        queue.push({
          file: alias.target,
          name: alias.targetName ?? (alias.esm ? ref.name : "*"),
        });
    }
    classTargetCache.set(cacheKey, found);
    return found;
  }
  // ES re-export provenance qualifies class chains only. It must not turn
  // unrelated function reads/exports into writes or opaque module escapes.
  for (const entry of [...escapedImports, ...importedWrites])
    for (const id of classTargets(
      entry.file,
      entry.moduleObject ? "*" : entry.name,
    ))
      escapedRoots.add(id);
  const bases = new Map<string, Set<string>>();
  for (const origin of inheritanceOrigins) {
    if (origin.uncertain) escapedRoots.add(origin.owner);
    const group = bases.get(origin.owner) ?? new Set<string>();
    if (origin.base) group.add(origin.base);
    if (origin.importTarget)
      for (const id of classTargets(
        origin.importTarget.file,
        origin.importTarget.name,
      ))
        group.add(id);
    if (group.size) bases.set(origin.owner, group);
  }
  const pending = [...escapedRoots],
    visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) continue;
    for (const base of bases.get(id) ?? [])
      if (!visited.has(base)) pending.push(base);
    if (node.kind === "class") {
      const spans = writeSpans.get(node.span.file) ?? [];
      spans.push(node.span);
      writeSpans.set(node.span.file, spans);
    } else if (node.kind !== "module")
      for (const target of origins.get(id) ?? [])
        if (!visited.has(target)) pending.push(target);
  }
  for (const [file, spans] of writeSpans) {
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: typeof spans = [];
    for (const span of spans) {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end)
        previous.end = Math.max(previous.end, span.end);
      else merged.push({ ...span });
    }
    writeSpans.set(file, merged);
  }
  for (const node of nodes) {
    const spans = writeSpans.get(node.span.file);
    if (!spans) continue;
    let low = 0,
      high = spans.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (spans[mid]!.start <= node.span.start) low = mid + 1;
      else high = mid;
    }
    if (low && spans[low - 1]!.end >= node.span.end) written.add(node.id);
  }
  const referencePairs = new Set<string>();
  const edges = parts
    .flatMap((p) => p.edges)
    .map((edge) =>
      edge.kind !== "contains" &&
      edge.to &&
      (ambiguous.has(edge.to) ||
        (edge.kind === "calls" &&
          written.has(edge.to) &&
          !independentCall(edge) &&
          (nodeMap.get(edge.to)?.kind !== "class" ||
            unstableConstructors.has(edge.to))))
        ? {
            ...edge,
            to: null,
            resolution: "unresolved" as const,
            targetKind: "unknown" as const,
          }
        : edge,
    )
    .map((edge) => {
      if (!partitioned || edge.to || !edge.importTarget) return edge;
      const imported = edge.importTarget;
      const exported = exportTargets.get(imported.file + "\0" + imported.name);
      if (
        edge.kind === "calls" &&
        ((exported?.mutable && exported.callableMutable !== false) ||
          (exported &&
            written.has(exported.nodeId) &&
            (nodeMap.get(exported.nodeId)?.kind !== "class" ||
              unstableConstructors.has(exported.nodeId))))
      )
        return edge;
      const id =
        edge.kind === "imports" ? `file:${imported.file}` : exported?.nodeId;
      const node = id ? nodeMap.get(id) : undefined;
      if (
        !node ||
        (node.kind === "module" && edge.kind !== "imports") ||
        (edge.kind === "calls" &&
          !["function", "class", "method"].includes(node.kind))
      )
        return edge;
      return {
        ...edge,
        to: node.id,
        resolution: "resolved" as const,
        targetKind: "project" as const,
      };
    })
    .map((edge) =>
      requireOriginsIncomplete &&
      edge.kind === "calls" &&
      edge.to &&
      !independentCall(edge)
        ? {
            ...edge,
            to: null,
            resolution: "unresolved" as const,
            targetKind: "unknown" as const,
          }
        : edge,
    )
    .filter((edge) => {
      if (edge.kind !== "references" || !edge.to) return true;
      const pair = edge.from + "\0" + edge.to;
      if (referencePairs.has(pair)) return false;
      referencePairs.add(pair);
      return true;
    });
  const writerPairs = new Set(
    edges
      .filter((e) => e.kind === "written-by")
      .map((e) => e.from + "\0" + e.to),
  );
  for (const edge of writerEdges) {
    const pair = edge.from + "\0" + edge.to;
    if (!writerPairs.has(pair)) {
      writerPairs.add(pair);
      edges.push(edge);
    }
  }
  if (files.length > 10000 || nodes.length > 100000 || edges.length > 1000000)
    throw Error(
      `Combined code capture has ${files.length} files, ${nodes.length} declarations and ${edges.length} relationships; limits are 10,000 / 100,000 / 1,000,000. Narrow the source selection; prior versions are preserved.`,
    );
  return readObservedGraph({
    schema: first.schema,
    snapshotId: partitioned
      ? hash(
          JSON.stringify({
            reader: "typescript-ast-partitioned/v15",
            parts: parts.map((p) => p.snapshotId),
          }),
        )
      : hash(
          JSON.stringify({ reader: first.reader, qualified: first.snapshotId }),
        ),
    projectId: first.projectId,
    version: first.version,
    reader: partitioned
      ? { id: "typescript-ast-partitioned/v15", version: first.reader.version }
      : first.reader,
    ...(first.dependencyModel &&
    parts.every((p) => p.dependencyModel === first.dependencyModel)
      ? { dependencyModel: first.dependencyModel }
      : {}),
    exports: exported,
    importedWrites,
    escapedImports,
    moduleObjectAliases,
    moduleMemberAliases,
    inheritanceOrigins,
    inheritanceForwards,
    commonjsFiles: [...commonjsFiles],
    opaqueExportFiles,
    originIndependentTargets: [...originIndependentTargets],
    ...(requireOriginsIncomplete
      ? { requireOriginsIncomplete: true as const }
      : {}),
    scope: {
      files: files.map((f) => f.path),
      discoveryComplete: parts.every((p) => p.scope.discoveryComplete),
    },
    files,
    nodes,
    edges,
    diagnostics: parts.flatMap((p) => p.diagnostics),
    coverage: {
      declarations: parts.every((p) => p.coverage.declarations === "complete")
        ? "complete"
        : "partial",
      relationships:
        partitioned ||
        first.coverage.relationships === "partial" ||
        edges.some((e) => e.resolution === "unresolved")
          ? "partial"
          : "complete",
    },
    completeness:
      partitioned ||
      first.completeness === "partial" ||
      edges.some((e) => e.resolution === "unresolved")
        ? "partial"
        : "complete",
    limitations: [
      ...(partitioned
        ? [
            `One combined code version contains ${parts.length} bounded parse partitions. All captured declarations share this graph; only explicit static module imports can be resolved across partitions; other cross-partition relationships remain unknown. Names declared in multiple partitions stay unresolved, including locally unique ambient declarations. A missing cross-partition edge is not evidence of no dependency.`,
          ]
        : []),
      ...(requireOriginsIncomplete
        ? [
            "Require-origin collection is incomplete; namespace and imported-call uncertainty applies across this observation. Direct same-file lexical callable identities remain independently known.",
          ]
        : []),
      ...new Set(parts.flatMap((p) => p.limitations)),
    ],
    staleFiles: [...new Set(parts.flatMap((p) => p.staleFiles))],
  });
}
