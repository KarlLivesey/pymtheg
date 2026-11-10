import { z } from "zod";
export const implementationComparisonQuerySchema = z
  .object({
    planRevision: z.string().min(1),
    codeRevision: z.string().min(1),
    planId: z.string().min(1).max(8192),
    nodeId: z.string().min(1).max(8192),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ImplementationComparisonQuery = z.infer<
  typeof implementationComparisonQuerySchema
>;
const sideSchema = z.object({
  revision: z.string().nullable(),
  label: z.string().nullable(),
  observationId: z.string().nullable(),
  file: z.string(),
  available: z.boolean(),
  reason: z.string().nullable(),
  body: z.string().nullable(),
  signature: z.string().nullable(),
  signatureTruncated: z.boolean(),
  declarationHash: z.string().nullable(),
  bodyHash: z.string().nullable(),
  sourceHash: z.string().nullable(),
  fileHash: z.string().nullable(),
});
export const implementationComparisonSchema = z.object({
  planId: z.string(),
  nodeId: z.string(),
  planRevision: z.string(),
  codeRevision: z.string(),
  activeRevision: z.string().nullable(),
  reviewAllowed: z.boolean(),
  plan: z.object({
    name: z.string(),
    fields: z.array(
      z.object({ label: z.string(), text: z.string(), truncated: z.boolean() }),
    ),
    text: z.string(),
    truncated: z.boolean(),
  }),
  design: z.object({
    meaning: z.string(),
    issues: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        origin: z.string(),
        message: z.string(),
        target: z.string().optional(),
      }),
    ),
    current: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        sourceHash: z.string(),
        fileHash: z.string().optional(),
        declarationHash: z.string().optional(),
        truncated: z.boolean(),
      }),
    ),
  }),
  planHash: z.string(),
  note: z.string(),
  before: sideSchema,
  after: sideSchema,
  source: z
    .object({
      equal: z.boolean(),
      lineEndingsDiffer: z.boolean(),
      lineEndingsNormalized: z.boolean(),
      complete: z.boolean(),
      coarse: z.boolean(),
      cells: z.number(),
      comparisons: z.number(),
      beforeLines: z.number(),
      afterLines: z.number(),
      omittedBeforeLines: z.number().int().nonnegative(),
      omittedAfterLines: z.number().int().nonnegative(),
      entries: z.array(
        z.object({
          kind: z.enum(["context", "removed", "added"]),
          text: z.string(),
          beforeLine: z.number().nullable(),
          afterLine: z.number().nullable(),
        }),
      ),
    })
    .nullable(),
  relationships: z
    .object({
      items: z.array(
        z.object({
          kind: z.string(),
          target: z.string(),
          targetId: z.string().nullable(),
          resolution: z.string(),
          count: z.number(),
          beforeCount: z.number(),
          afterCount: z.number(),
          displayTruncated: z.boolean(),
        }),
      ),
      offset: z.number(),
      total: z.number(),
      nextOffset: z.number().nullable(),
      coverageComplete: z.boolean(),
      meaning: z.string(),
    })
    .nullable(),
  dependencies: z.object({
    available: z.boolean(),
    total: z.number(),
    truncated: z.boolean(),
    meaning: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        file: z.string(),
        change: z.string(),
        before: z.string().nullable(),
        after: z.string().nullable(),
        truncated: z.boolean(),
      }),
    ),
  }),
  limitations: z.array(z.string()),
  meaning: z.string(),
});
export type ImplementationComparison = z.infer<
  typeof implementationComparisonSchema
>;
