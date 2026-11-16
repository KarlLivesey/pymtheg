// SPDX-License-Identifier: MIT
import { z } from "zod";
export const versionCatalogQuerySchema = z
  .object({
    query: z.string().max(256).default(""),
    category: z.enum(["all", "design", "code", "links"]).default("all"),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(50),
    selectedId: z.string().max(256).optional(),
    catalogHash: z.string().optional(),
  })
  .strict();
export const versionMetadataSchema = z.object({
  id: z.string(),
  label: z.string(),
  created: z.string(),
  source: z.string(),
  category: z.enum(["design", "code", "links"]),
  current: z.boolean(),
  labelCount: z.number().int().positive().default(1),
});
export const versionCatalogSchema = z.object({
  activeRevision: z.string().nullable(),
  catalogHash: z.string(),
  category: z.string(),
  query: z.string(),
  counts: z.object({ design: z.number(), code: z.number(), links: z.number() }),
  total: z.number(),
  repositoryTotal: z.number(),
  observationTotal: z.number(),
  offset: z.number(),
  nextOffset: z.number().nullable(),
  items: z.array(versionMetadataSchema),
  selected: versionMetadataSchema.nullable(),
  examined: z.number(),
});
export const implementationFilesQuerySchema = z
  .object({
    inventoryId: z.string().optional(),
    directory: z.string().min(1).max(4096).optional(),
    query: z.string().max(256).default(""),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const implementationFilesPageSchema = z.object({
  inventoryId: z.string(),
  directory: z.string(),
  query: z.string(),
  files: z.array(z.string()),
  total: z.number(),
  inventoryTotal: z.number(),
  offset: z.number(),
  nextOffset: z.number().nullable(),
  complete: z.boolean(),
  warnings: z.array(z.string()),
  warningCount: z.number(),
  visitedEntries: z.number(),
  visitedDirectories: z.number(),
  ignoredSymlinks: z.number(),
  meaning: z.string(),
});
export const implementationQuerySchema = z
  .object({
    mode: z.enum(["planned", "existing", "gaps"]).default("gaps"),
    planRevision: z.string().optional(),
    codeRevision: z.string().optional(),
    query: z.string().max(256).default(""),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
    detailId: z.string().max(8192).optional(),
    characterOffset: z.number().int().min(0).default(0),
  })
  .strict();
export const captureCodeSchema = z
  .object({
    files: z.array(z.string().min(1).max(4096)).min(1).max(10000),
    label: z.string().trim().min(1).max(160),
    expectedRevision: z.string().nullable(),
    runId: z.string().optional(),
  })
  .strict();
export const bindCodeSchema = z
  .object({
    revision: z.string(),
    planId: z.string(),
    nodeId: z.string(),
    planHash: z.string(),
    observationId: z.string(),
    note: z.string().max(2000).default(""),
  })
  .strict();
export type ImplementationQuery = z.infer<typeof implementationQuerySchema>;
export const unlinkCodeSchema = z
  .object({ revision: z.string(), planId: z.string(), nodeId: z.string() })
  .strict();
export const graphPageSchema = z.object({
  activeRevision: z.string().nullable(),
  linkAllowed: z.boolean().default(false),
  planRevision: z.string(),
  codeRevision: z.string().nullable(),
  observationId: z.string().nullable(),
  codeLabel: z.string().nullable(),
  coverage: z
    .object({
      declarations: z.enum(["complete", "partial"]),
      relationships: z.enum(["complete", "partial"]),
    })
    .nullable(),
  limitations: z.array(z.string()),
  counts: z.record(z.string(), z.number()),
  mode: z.enum(["planned", "existing", "gaps"]),
  query: z.string().default(""),
  offset: z.number(),
  total: z.number(),
  nextOffset: z.number().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      status: z.string().optional(),
      statuses: z.array(z.string()).optional(),
      reason: z.string().optional(),
      planHash: z.string().optional(),
      linkCount: z.number().int().nonnegative().optional(),
      codeLinks: z
        .array(
          z.object({
            nodeId: z.string(),
            name: z.string(),
            file: z.string(),
            status: z.string(),
            statuses: z.array(z.string()).optional(),
            reason: z.string(),
            body: z.string().nullable(),
            reviewedRevision: z.string().optional(),
          }),
        )
        .optional(),
      body: z.string().optional(),
      file: z.string().optional(),
      signature: z.string().optional(),
      code: z
        .object({
          id: z.string(),
          name: z.string(),
          file: z.string(),
          start: z.number(),
          signature: z.string(),
          body: z.string(),
        })
        .nullable()
        .optional(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string().nullable(),
      fromName: z.string().optional(),
      toName: z.string().optional(),
      targetName: z.string().optional(),
      targetKind: z.string().optional(),
      kind: z.string(),
      unresolved: z.boolean(),
    }),
  ),
  edgeCount: z.number(),
  edgesTruncated: z.boolean(),
  meaning: z.string(),
  detail: z
    .object({
      id: z.string(),
      file: z.string(),
      text: z.string(),
      totalCharacters: z.number(),
      characterOffset: z.number(),
      fields: z
        .array(
          z.object({
            label: z.string(),
            text: z.string(),
            truncated: z.boolean(),
          }),
        )
        .optional(),
      nextOffset: z.number().nullable(),
    })
    .nullable()
    .optional(),
});
export type GraphPage = z.infer<typeof graphPageSchema>;
