import { z } from "zod";
export const sourceTargetsSchema = z
  .array(z.string().startsWith("source:").max(8192))
  .max(500);
export const sourceContractsPath = ".pymtheg-source-contracts.json";
export const sourceSelectionSchema = z
  .object({
    schema: z.literal("pymtheg.source-selection/v1"),
    targets: sourceTargetsSchema,
    expectations: z.record(z.string().max(8192), z.string().length(64)),
    textHashes: z.record(z.string().max(8192), z.string().length(64)),
  })
  .strict();
export type SourceSelection = z.infer<typeof sourceSelectionSchema>;
export const sourceContractSchema = z
  .object({
    id: z.string().max(8192),
    symbolId: z.string().max(8192),
    name: z.string().max(4096),
    kind: z.enum(["type", "resource", "op", "flow", "rule", "machine"]),
    file: z.string().max(4096),
    signature: z.string().max(16384),
    declaration: z.string().max(16 * 1024 * 1024),
    declarationHash: z.string().length(64),
    replacementHash: z.string().length(64).optional(),
    sourceHash: z.string().length(64),
    source: z.string().max(2 * 1024 * 1024),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    modelStatus: z.enum(["checked", "incomplete", "ambiguous"]),
    snapshotId: z.string(),
  })
  .strict();
export const sourceCatalogueSchema = z
  .object({
    schema: z.literal("pymtheg.source-contracts/v1"),
    snapshotId: z.string(),
    entries: z.array(sourceContractSchema).max(100000),
    history: z.array(sourceContractSchema).max(100000).optional(),
    dependencies: z
      .array(
        z
          .object({ from: z.string(), to: z.string(), kind: z.string() })
          .strict(),
      )
      .max(1000000),
    incompleteFiles: z.array(z.string()),
    missingFiles: z.array(z.string()).optional(),
    diagnostics: z.array(
      z.object({ file: z.string(), code: z.string(), message: z.string() }),
    ),
    meaning: z.string(),
  })
  .strict();
export type SourceContract = z.infer<typeof sourceContractSchema>;
export type SourceCatalogue = z.infer<typeof sourceCatalogueSchema>;

export const sourceContractPageSchema = z
  .object({
    snapshotId: z.string(),
    meaning: z.string(),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    items: z.array(
      sourceContractSchema.omit({ source: true, declaration: true }),
    ),
    nextOffset: z.number().int().nonnegative().nullable(),
    complete: z.boolean(),
    notices: z.array(
      z.object({ file: z.string(), code: z.string(), message: z.string() }),
    ),
    noticeCount: z.number().int().nonnegative(),
    incompleteFiles: z.array(z.string()),
    incompleteFileCount: z.number().int().nonnegative(),
  })
  .strict();

const sourcePreviewSchema = sourceContractSchema
  .omit({ declaration: true })
  .extend({
    sourceTruncated: z.boolean(),
  })
  .strict();
export const sourceContractDetailSchema = z
  .object({
    snapshotId: z.string(),
    current: sourcePreviewSchema.nullable(),
    recorded: sourcePreviewSchema.nullable(),
    recordedAtReview: z.boolean(),
    meaning: z.string(),
    changedDependencies: z.array(z.string()).nullable(),
    dependencyPaths: z
      .array(
        z
          .object({
            target: z.string(),
            via: z.array(z.string()).max(16),
            truncated: z.boolean(),
          })
          .strict(),
      )
      .max(10),
    comparisonPlanId: z.string().nullable(),
    comparisonReason: z.string().nullable(),
    replacements: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            file: z.string(),
            signature: z.string(),
            reason: z.string(),
          })
          .strict(),
      )
      .max(10),
    replacementCount: z.number().int().nonnegative(),
    replacementScope: z.string(),
    complete: z.boolean(),
  })
  .strict();
export const sourceContractRequestSchema = z
  .object({
    id: z.string().max(8192),
    snapshotId: z.string().max(120),
    revision: z.string().max(120).optional(),
    planId: z.string().max(240).optional(),
    expectations: z
      .record(z.string().max(8192), z.string().length(64))
      .optional(),
    sourceHashes: z
      .record(z.string().max(8192), z.string().length(64))
      .optional(),
  })
  .strict();
