// SPDX-License-Identifier: MIT
import { z } from "zod";
import { hash } from "../shared/identity.js";

const relativePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "Use a project-relative source path",
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const span = z
  .object({
    file: relativePath,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict();
export const observedGraphSchema = z
  .object({
    schema: z.literal("pymtheg.observed-graph/v1"),
    snapshotId: digest,
    projectId: z.string().nullable(),
    version: z
      .object({
        label: z.string(),
        gitCommit: z.string().nullable(),
        // D22: unknown when Git was not asked (an untrusted folder) or failed.
        dirty: z.union([z.boolean(), z.literal("unknown")]),
      })
      .strict(),
    reader: z.object({ id: z.string(), version: z.string() }).strict(),
    dependencyModel: z.enum(["lexical-v1", "lexical-v2"]).optional(),
    moduleObjectAliases: z
      .array(z.object({ file: relativePath, target: relativePath }).strict())
      .max(100000)
      .optional(),
    originIndependentTargets: z
      .array(z.string().max(8192))
      .max(100000)
      .optional(),
    requireOriginsIncomplete: z.literal(true).optional(),
    opaqueExportFiles: z.array(relativePath).max(10000).optional(),
    commonjsFiles: z.array(relativePath).max(10000).optional(),
    moduleMemberAliases: z
      .array(
        z
          .object({
            file: relativePath,
            name: z.string(),
            target: relativePath,
            targetName: z.string().optional(),
          })
          .strict(),
      )
      .max(100000)
      .optional(),
    inheritanceForwards: z
      .array(
        z
          .object({
            file: relativePath,
            name: z.string(),
            target: relativePath,
            targetName: z.string().optional(),
          })
          .strict(),
      )
      .max(100000)
      .optional(),
    inheritanceOrigins: z
      .array(
        z
          .object({
            owner: z.string().max(8192),
            base: z.string().max(8192).nullable(),
            importTarget: z
              .object({ file: relativePath, name: z.string() })
              .strict()
              .optional(),
            uncertain: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(100000)
      .optional(),
    escapedImports: z
      .array(
        z
          .object({
            file: relativePath,
            name: z.string(),
            moduleObject: z.literal(true).optional(),
            memberObject: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(100000)
      .optional(),
    importedWrites: z
      .array(
        z
          .object({
            file: relativePath,
            name: z.string(),
            writer: z.string(),
            span,
            moduleObject: z.literal(true).optional(),
            memberObject: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(100000)
      .optional(),
    exports: z
      .array(
        z
          .object({
            file: relativePath,
            name: z.string(),
            nodeId: z.string(),
            mutable: z.boolean().optional(),
            callableMutable: z.boolean().optional(),
          })
          .strict(),
      )
      .max(100000)
      .optional(),
    scope: z
      .object({
        files: z.array(relativePath).max(10000),
        discoveryComplete: z.boolean(),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: relativePath,
            hash: digest,
            bytes: z.number().int().nonnegative(),
            text: z.string().optional(),
            coverage: z
              .object({
                declarations: z.enum(["complete", "partial"]),
                relationships: z.enum(["complete", "partial"]),
              })
              .optional(),
          })
          .strict(),
      )
      .max(10000),
    omittedFiles: z
      .array(
        z
          .object({
            path: relativePath,
            bytes: z.number().int().nonnegative(),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
    nodes: z
      .array(
        z
          .object({
            id: z.string().max(8192),
            name: z.string(),
            qualifiedName: z.string(),
            moduleScoped: z.boolean().optional(),
            kind: z.enum([
              "module",
              "binding",
              "function",
              "method",
              "class",
              "interface",
              "type",
            ]),
            span,
            signature: z.string(),
            declarationHash: digest,
            body: z.enum([
              "declaration-only",
              "empty",
              "fail-fast",
              "present",
              "unparsed",
            ]),
            bodyHash: digest.nullable(),
          })
          .strict(),
      )
      .max(100000),
    edges: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string().nullable(),
            targetName: z.string(),
            kind: z.enum([
              "contains",
              "imports",
              "calls",
              "uses-type",
              "references",
              "written-by",
            ]),
            resolution: z.enum(["resolved", "unresolved"]),
            targetKind: z
              .enum([
                "project",
                "builtin",
                "external-package",
                "local-binding",
                "unknown",
              ])
              .optional(),
            span,
            importTarget: z
              .object({ file: relativePath, name: z.string() })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(1000000),
    diagnostics: z.array(
      z
        .object({
          span,
          severity: z.enum(["error", "warning"]),
          message: z.string(),
        })
        .strict(),
    ),
    completeness: z.enum(["complete", "partial"]),
    coverage: z
      .object({
        declarations: z.enum(["complete", "partial"]),
        relationships: z.enum(["complete", "partial"]),
      })
      .strict(),
    limitations: z.array(z.string()),
    staleFiles: z.array(relativePath).default([]),
  })
  .strict();
export type ObservedGraph = z.infer<typeof observedGraphSchema>;
export interface ObservedSource {
  path: string;
  text: string;
  hash: string;
}

export function readObservedGraph(value: unknown): ObservedGraph {
  return validateObservedGraphProvenance(observedGraphSchema.parse(value));
}

/** Internal assembly boundary: metadata and each file part must already have
 * passed their schemas. Avoid cloning every validated node/edge a second time. */
export function validateObservedGraphProvenance(
  graph: ObservedGraph,
): ObservedGraph {
  if (
    graph.files.length > 10000 ||
    graph.nodes.length > 100000 ||
    graph.edges.length > 1000000
  )
    throw Error(
      "Observed graph exceeds the file, declaration or relationship count bound",
    );
  const files = new Map(graph.files.map((file) => [file.path, file]));
  const nodes = new Set(graph.nodes.map((node) => node.id));
  if (files.size !== graph.files.length || nodes.size !== graph.nodes.length)
    throw Error("Observed graph contains duplicate file or node identities");
  const kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  for (const forward of graph.inheritanceForwards ?? [])
    if (!files.has(forward.file))
      throw Error(
        "Observed graph has invalid inheritance forwarding provenance",
      );
  for (const origin of graph.inheritanceOrigins ?? [])
    if (
      !["class", "binding", "module"].includes(kinds.get(origin.owner) ?? "") ||
      (origin.base !== null && kinds.get(origin.base) !== "class") ||
      (origin.base === null && !origin.importTarget)
    )
      throw Error("Observed graph has invalid inheritance provenance");
  const omissions = new Set<string>();
  for (const omitted of graph.omittedFiles ?? []) {
    if (
      files.has(omitted.path) ||
      omissions.has(omitted.path) ||
      graph.coverage.declarations === "complete"
    )
      throw Error(
        "Omitted code must have a distinct identity and partial declaration coverage",
      );
    omissions.add(omitted.path);
  }
  const checkSpan = (location: ObservedGraph["nodes"][number]["span"]) => {
    const file = files.get(location.file);
    if (
      !file ||
      location.end < location.start ||
      (file.text !== undefined && location.end > file.text.length)
    )
      throw Error("Observed graph has invalid source provenance");
  };
  const exportKeys = new Set<string>();
  for (const alias of graph.moduleObjectAliases ?? [])
    if (!files.has(alias.file))
      throw Error("Observed graph has invalid module-object alias provenance");
  for (const id of graph.originIndependentTargets ?? [])
    if (!nodes.has(id))
      throw Error("Observed graph has invalid lexical-call provenance");
  for (const file of [
    ...(graph.commonjsFiles ?? []),
    ...(graph.opaqueExportFiles ?? []),
  ])
    if (!files.has(file))
      throw Error("Observed graph has invalid CommonJS provenance");
  for (const alias of graph.moduleMemberAliases ?? [])
    if (!files.has(alias.file))
      throw Error("Observed graph has invalid member alias provenance");
  for (const write of graph.importedWrites ?? [])
    if (!nodes.has(write.writer))
      throw Error("Observed graph has invalid imported write provenance");
    else checkSpan(write.span);
  for (const entry of graph.exports ?? []) {
    const key = entry.file + "\0" + entry.name;
    if (
      !files.has(entry.file) ||
      !nodes.has(entry.nodeId) ||
      exportKeys.has(key)
    )
      throw Error("Observed graph has invalid or duplicate export provenance");
    exportKeys.add(key);
  }
  graph.nodes.forEach((node) => checkSpan(node.span));
  graph.edges.forEach((edge) => checkSpan(edge.span));
  graph.diagnostics.forEach((item) => checkSpan(item.span));
  for (const file of graph.files)
    if (
      file.text !== undefined &&
      (Buffer.byteLength(file.text) !== file.bytes ||
        hash(file.text) !== file.hash)
    )
      throw Error("Observed source hash or byte count does not match its text");
  if (
    graph.completeness === "complete" &&
    (graph.coverage.declarations !== "complete" ||
      graph.coverage.relationships !== "complete")
  )
    throw Error(
      "Incomplete coverage cannot be reported as a complete observed graph",
    );
  if (
    graph.coverage.relationships === "complete" &&
    graph.edges.some((edge) => edge.resolution === "unresolved")
  )
    throw Error("Unresolved relationships cannot be reported as complete");
  for (const edge of graph.edges)
    if (
      !nodes.has(edge.from) ||
      (edge.to !== null && !nodes.has(edge.to)) ||
      (edge.resolution === "resolved") !== (edge.to !== null)
    )
      throw Error("Observed graph contains an invalid edge");
  return graph;
}
