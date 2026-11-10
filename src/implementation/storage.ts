import {
  encodePart,
  decodePart,
  serializePart,
  partExpandedBytes,
} from "./part-codec.js";
import { z } from "zod";
import { hash } from "../shared/identity.js";
import {
  architectureLimits,
  isObservationPart,
} from "../architecture/limits.js";
import type { ArchitectureDocument } from "../architecture/schema.js";
import {
  observedGraphSchema,
  readObservedGraph,
  validateObservedGraphProvenance,
  type ObservedGraph,
} from "./schema.js";

export const observationPath = ".pymtheg-observed-code.json";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const partSchema = z
  .object({
    schema: z.literal("pymtheg.observed-file/v1"),
    file: observedGraphSchema.shape.files.element,
    nodes: observedGraphSchema.shape.nodes,
    edges: observedGraphSchema.shape.edges,
    diagnostics: observedGraphSchema.shape.diagnostics,
  })
  .strict();
type Part = z.infer<typeof partSchema>;
const runSchema = z.array(
  z.tuple([z.number().int().nonnegative(), z.number().int().positive()]),
);
const manifestSchema = z
  .object({
    storage: z.literal("pymtheg.observed-parts/v1"),
    graph: observedGraphSchema.omit({
      files: true,
      nodes: true,
      edges: true,
      diagnostics: true,
    }),
    parts: z
      .array(
        z
          .object({ path: z.string().refine(isObservationPart), hash: digest })
          .strict(),
      )
      .max(10000),
    order: z
      .object({ nodes: runSchema, edges: runSchema, diagnostics: runSchema })
      .strict(),
  })
  .strict();

/** Partition once by source provenance. Part bytes never contain labels or global offsets. */
export function observationDocuments(
  graph: ObservedGraph,
): ArchitectureDocument[] {
  const { files, nodes, edges, diagnostics, ...metadata } = graph;
  const parts: Part[] = files.map((file) => ({
    schema: "pymtheg.observed-file/v1",
    file,
    nodes: [],
    edges: [],
    diagnostics: [],
  }));
  const byFile = new Map(files.map((file, i) => [file.path, i]));
  function partition<K extends "nodes" | "edges" | "diagnostics">(
    kind: K,
    items: ObservedGraph[K],
  ) {
    const runs: [number, number][] = [];
    for (const item of items) {
      const i = byFile.get(item.span.file);
      if (i === undefined)
        throw Error("Observed item has no captured source file.");
      (parts[i]![kind] as (typeof items)[number][]).push(item);
      const last = runs.at(-1);
      if (last?.[0] === i) last[1]++;
      else runs.push([i, 1]);
    }
    return runs;
  }
  const order = {
    nodes: partition("nodes", nodes),
    edges: partition("edges", edges),
    diagnostics: partition("diagnostics", diagnostics),
  };
  let expandedBytes = 0;
  const documents = parts.map((part) => {
    const encoded = encodePart(part);
    expandedBytes += Buffer.byteLength(JSON.stringify(encoded));
    if (expandedBytes > architectureLimits.snapshotBytes)
      throw Error(
        "Expanded code version exceeds the 64 MiB bound; existing versions were preserved.",
      );
    const text = serializePart(encoded);
    if (Buffer.byteLength(text) > architectureLimits.documentBytes)
      throw Error(
        `Observed source ${part.file.path} produces a code part over 16 MiB. Capture a smaller source file; existing versions were preserved.`,
      );
    return { path: `.pymtheg-code-parts/${hash(part.file.path)}.json`, text };
  });
  const result = [
    {
      path: observationPath,
      text: JSON.stringify({
        storage: "pymtheg.observed-parts/v1",
        graph: metadata,
        parts: documents.map((d) => ({ path: d.path, hash: hash(d.text) })),
        order,
      }),
    },
    ...documents,
  ];
  if (Buffer.byteLength(result[0]!.text) > architectureLimits.documentBytes)
    throw Error(
      "Code version metadata exceeds 16 MiB. Capture fewer source files or shorter paths; existing versions were preserved.",
    );
  if (
    result.reduce((bytes, d) => bytes + Buffer.byteLength(d.text), 0) >
    architectureLimits.snapshotBytes
  )
    throw Error(
      "This code graph exceeds the 64 MiB snapshot limit. Capture a smaller source scope; existing versions were preserved.",
    );
  return result;
}

/** Legacy monolithic observations remain readable; reads never rewrite storage. */
export function decodeObservation(
  documents: readonly ArchitectureDocument[],
): ObservedGraph | null {
  const manifest = documents.find((d) => d.path === observationPath);
  if (!manifest) return null;
  const value = JSON.parse(manifest.text);
  if (value?.schema === "pymtheg.observed-graph/v1")
    return readObservedGraph(value);
  const stored = manifestSchema.parse(value);
  const byPath = new Map(documents.map((d) => [d.path, d.text]));
  const paths = new Set<string>();
  let expandedBytes = 0;
  // Preflight every size/hash before decompressing; retain no parsed tuple trees.
  for (const ref of stored.parts) {
    const text = byPath.get(ref.path);
    if (paths.has(ref.path) || text === undefined || hash(text) !== ref.hash)
      throw Error(
        "Retained code part is missing, duplicated or does not match its version. Restore this observation from a history export.",
      );
    paths.add(ref.path);
    const value: unknown = JSON.parse(text);
    expandedBytes += partExpandedBytes(value, Buffer.byteLength(text));
    if (expandedBytes > architectureLimits.snapshotBytes)
      throw Error(
        "Expanded code version exceeds the 64 MiB bound; no parts were decompressed.",
      );
  }
  const parts = stored.parts.map((ref) => {
    const part = partSchema.parse(
      decodePart(JSON.parse(byPath.get(ref.path)!)),
    );
    if (
      ref.path !== `.pymtheg-code-parts/${hash(part.file.path)}.json` ||
      [...part.nodes, ...part.edges, ...part.diagnostics].some(
        (item) => item.span.file !== part.file.path,
      )
    )
      throw Error("Retained code part has incorrect source provenance.");
    return part;
  });
  function restore<K extends "nodes" | "edges" | "diagnostics">(kind: K) {
    const cursors = parts.map(() => 0);
    const items: Part[K][number][] = [];
    for (const [i, count] of stored.order[kind]) {
      const source = parts[i]?.[kind];
      const cursor = cursors[i];
      if (!source || cursor === undefined || cursor + count > source.length)
        throw Error("Retained code ordering is invalid.");
      for (let j = cursor; j < cursor + count; j++) items.push(source[j]!);
      cursors[i] = cursor + count;
    }
    if (parts.some((part, i) => cursors[i] !== part[kind].length))
      throw Error("Retained code ordering omits source items.");
    return items;
  }
  return validateObservedGraphProvenance({
    ...stored.graph,
    files: parts.map((part) => part.file),
    nodes: restore("nodes"),
    edges: restore("edges"),
    diagnostics: restore("diagnostics"),
  });
}
