import { acknowledgementSchema } from "./acknowledgements.js";
import {
  architectureLimits,
  maxStoredDocuments,
  documentCountsWithinLimits,
} from "./limits.js";
import { z } from "zod";
import { sourceSelectionSchema } from "../shared/source-contracts.js";
export const documentSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (s) =>
          !s.startsWith("/") &&
          !s.split("/").includes("..") &&
          !s.includes("\\") &&
          !s.includes("\0"),
        "Use a relative document path",
      ),
    // Browser-safe shape bound. Import/index/history enforce UTF-8 byte limits;
    // code capture additionally checks each part before worker submission.
    text: z.string().max(architectureLimits.documentBytes),
  })
  .strict();
export type ArchitectureDocument = z.infer<typeof documentSchema>;
export const entitySchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    kind: z.enum([
      "document",
      "heading",
      "route",
      "command",
      "review",
      "profile",
      "release",
      "function",
      "type",
      "owner",
      "component",
      "requirement",
      "decision",
      "risk",
      "milestone",
      "test",
      "evidence",
    ]),
    owner: z.string(),
    status: z.string(),
    summary: z.string(),
    contentHash: z.string(),
    relationshipHash: z.string().optional(),
    conflictOf: z.string().optional(),
    searchText: z.string().optional(),
    searchTruncated: z.boolean().optional(),
    planning: z
      .object({
        hasAcceptance: z.boolean(),
        hasEvidence: z.boolean(),
        evidenceRevision: z.string(),
        originRevision: z.string().optional(),
        linkReviewRevision: z.string().optional(),
        linkBaselines: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    document: z.string(),
    pointer: z.array(z.union([z.string(), z.number()])),
    identity: z.enum(["declared", "name-derived"]),
  })
  .strict();
export type ArchitectureEntity = z.infer<typeof entitySchema>;
export const edgeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    targetName: z.string(),
    kind: z.string(),
    order: z.number(),
    document: z.string(),
    pointer: z.array(z.union([z.string(), z.number()])),
    binding: z.enum([
      "recorded",
      "partial",
      "missing",
      "not-applicable",
      "unknown",
    ]),
    unresolved: z.boolean(),
  })
  .strict();
export type ArchitectureEdge = z.infer<typeof edgeSchema>;
export const architectureIndexVersion = 20 as const;
export const indexSchema = z
  .object({
    schema: z.literal("pymtheg.architecture/v1"),
    indexVersion: z
      .literal(architectureIndexVersion)
      .default(architectureIndexVersion),
    id: z.string(),
    snapshotHash: z.string().optional(),
    reviewRecords: z.array(acknowledgementSchema).max(10000).optional(),
    reviewRecordCount: z.number().int().nonnegative().optional(),
    reviewedAgainst: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(10000)
      .optional(),
    entities: z.array(entitySchema),
    edges: z.array(edgeSchema),
    documents: z.array(
      z.object({ path: z.string(), hash: z.string(), bytes: z.number() }),
    ),
    warnings: z.array(z.string()),
    measurements: z.object({
      documents: z.number(),
      bytes: z.number(),
      entities: z.number(),
      edges: z.number(),
      indexVisits: z.number(),
    }),
  })
  .strict();
export type ArchitectureIndex = z.infer<typeof indexSchema>;

export const revisionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    created: z.string(),
    source: z.string(),
    snapshotHash: z.string().optional(),
    reviewRecords: z.array(acknowledgementSchema).max(10000).optional(),
    reviewRecordCount: z.number().int().nonnegative().optional(),
    reviewedAgainst: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(10000)
      .optional(),
    parentId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
  })
  .strict();
export const importSourceSchema = z
  .object({
    id: z.string().min(1).max(4096),
    label: z.string().min(1).max(4096),
    kind: z.enum(["folder", "upload", "bundle"]),
    selection: z.enum(["project-documents", "all-text"]).optional(),
  })
  .strict();
export const importResolutionSchema = z
  .object({
    path: z.string(),
    localHash: z.string().nullable(),
    incomingHash: z.string().nullable(),
    choice: z.enum(["keep-local", "take-incoming", "keep-both"]),
  })
  .strict();
export const importConflictSchema = z
  .object({
    path: z.string(),
    reason: z.string(),
    local: z.string().nullable(),
    incoming: z.string().nullable(),
    localHash: z.string().nullable(),
    incomingHash: z.string().nullable(),
    choices: z.array(z.enum(["keep-local", "take-incoming", "keep-both"])),
  })
  .strict();
export const importPreviewSchema = z
  .object({
    token: z.string(),
    baseRevision: z.string().nullable(),
    label: z.string(),
    mode: z.enum(["add", "refresh"]),
    source: importSourceSchema,
    summary: z.object({
      added: z.array(z.string()),
      changed: z.array(z.string()),
      removed: z.array(z.string()),
      keptLocal: z.array(z.string()),
      keptShared: z.array(z.string()).default([]),
      adopted: z.array(z.string()),
      archivedMetadata: z.array(z.string()),
      keptNative: z.array(z.string()),
      sources: z.array(importSourceSchema),
    }),
    conflicts: z.array(importConflictSchema),
    unresolvedLinks: z.number(),
    newlyBrokenAuthoredLinks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        target: z.string(),
      }),
    ),
    warnings: z.array(z.string()),
  })
  .strict();
export const overviewSchema = z
  .object({
    index: indexSchema.nullable(),
    revisions: z.array(revisionSchema),
    activeRevision: z.string().nullable().optional(),
    sources: z.array(importSourceSchema).optional(),
  })
  .strict();
export const bundleSchema = z
  .object({
    schema: z.enum([
      "pymtheg.architecture-bundle/v1",
      "pymtheg.architecture-bundle/v2",
      "pymtheg.architecture-bundle/v3",
    ]),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    revision: revisionSchema.optional(),
    index: indexSchema.extend({
      indexVersion: z
        .union([
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(5),
          z.literal(6),
          z.literal(7),
          z.literal(8),
          z.literal(9),
          z.literal(10),
          z.literal(11),
          z.literal(12),
          z.literal(13),
          z.literal(14),
          z.literal(15),
          z.literal(16),
          z.literal(17),
          z.literal(18),
          z.literal(19),
          z.literal(architectureIndexVersion),
        ])
        .optional(),
    }),
    documents: z
      .array(documentSchema)
      .min(1)
      .max(maxStoredDocuments)
      .refine(
        documentCountsWithinLimits,
        "A snapshot supports 4,096 architecture documents and 10,000 observed-code parts.",
      ),
  })
  .strict()
  .refine(
    (bundle) =>
      bundle.schema !== "pymtheg.architecture-bundle/v3" ||
      !!bundle.contentHash,
    { message: "v3 bundle requires a content checksum" },
  );
export const differenceSchema = z
  .object({
    recordChanges: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          fields: z.array(
            z.object({
              path: z.string(),
              before: z.string(),
              after: z.string(),
              truncated: z.boolean(),
            }),
          ),
          truncated: z.boolean(),
        }),
      )
      .optional(),
    documentChanges: z
      .array(
        z.object({
          path: z.string(),
          startLine: z.number(),
          before: z.string(),
          after: z.string(),
          truncated: z.boolean(),
        }),
      )
      .optional(),
    removedNames: z.record(z.string(), z.string()).optional(),
    changed: z.array(z.string()),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    renamed: z.array(
      z.object({ id: z.string(), before: z.string(), after: z.string() }),
    ),
    changedDocuments: z.array(z.string()),
    removedDocuments: z.array(z.string()),
  })
  .strict();
export const searchSchema = z.array(
  z.object({ path: z.string(), snippet: z.string() }),
);
export const searchPageSchema = z.object({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextOffset: z.number().int().nonnegative().nullable(),
  matches: searchSchema,
});
export const planKindSchema = z.enum([
  "component",
  "requirement",
  "decision",
  "risk",
  "milestone",
  "test",
  "evidence",
]);
export const planItemSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: planKindSchema,
    title: z.string().min(1).max(240),
    owner: z.string().min(1).max(120),
    status: z.enum([
      "proposed",
      "accepted",
      "in-progress",
      "implemented",
      "reviewed",
      "superseded",
    ]),
    detail: z.string().max(100000),
    acceptance: z.string().max(100000),
    evidence: z.string().max(100000),
    evidenceRevision: z.string().max(120),
    originRevision: z.string().max(120).optional(),
    linkReviewRevision: z.string().max(120).optional(),
    /** Server-recorded revision at which each not-yet-reviewed document link was added. Never a review. */
    linkBaselines: z
      .record(z.string().max(8192), z.string().max(120))
      .optional(),
    sourceExpectations: z.record(z.string(), z.string().length(64)).optional(),
    sourceRoots: z
      .record(
        z.string(),
        z
          .object({
            expectations: z.record(z.string(), z.string().length(64)),
            hashes: z.record(z.string(), z.string().length(64)),
            precise: z.boolean(),
          })
          .strict(),
      )
      .optional(),
    sourceHashes: z.record(z.string(), z.string().length(64)).optional(),
    sourceReviewSnapshot: z.string().max(120).optional(),
    sourceSelectionSnapshot: z.string().max(120).optional(),
    sourceSelections: z
      .record(z.string().max(8192), sourceSelectionSchema)
      .optional(),
    sourceReviewSelection: sourceSelectionSchema.optional(),
    links: z
      .array(
        z.object({
          kind: z.enum([
            "depends-on",
            "satisfies",
            "tests",
            "implements",
            "supersedes",
            "supports",
          ]),
          target: z.string().min(1).max(8192),
        }),
      )
      .max(1000),
  })
  .passthrough();
export type PlanItem = z.infer<typeof planItemSchema>;
/** Which earlier revision a document link is compared with, and what it truthfully is. */
export function linkComparisonBase(
  item: Pick<
    PlanItem,
    "linkBaselines" | "linkReviewRevision" | "originRevision"
  >,
  target: string,
): {
  revision: string | undefined;
  state: "never-reviewed" | "reviewed" | "none";
  label: string;
} {
  const baseline = item.linkBaselines?.[target];
  if (baseline)
    return {
      revision: baseline,
      state: "never-reviewed",
      label: "version when this link was added",
    };
  if (item.linkReviewRevision)
    return {
      revision: item.linkReviewRevision,
      state: "reviewed",
      label: "reviewed version",
    };
  if (item.originRevision)
    return {
      revision: item.originRevision,
      state: "never-reviewed",
      label: "version when this link was added",
    };
  return { revision: undefined, state: "none", label: "earlier version" };
}
export const planSchema = z
  .object({
    schema: z.literal("pymtheg.plan/v1"),
    items: z.array(planItemSchema).max(100000),
  })
  .passthrough();

export const impactSchema = z
  .object({
    direct: z.array(z.string()),
    transitive: z.array(z.string()),
    planning: z.array(z.string()),
  })
  .strict();

export const workIssueSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "missing-criteria",
      "missing-evidence",
      "stale-evidence",
      "unknown-evidence",
      "unscoped-evidence",
      "broken-link",
      "unresolved-type",
      "open-decision",
      "retitled-target",
      "changed-target",
      "moved-target",
      "diverged-target",
      "unknown-link-review",
    ]),
    message: z.string(),
    origin: z.enum(["authored", "imported"]),
    target: z.string().optional(),
    /** For link findings: compared with an explicit review, or with the baseline recorded when the never-reviewed link was added. */
    linkReview: z.enum(["reviewed", "never-reviewed"]).optional(),
  })
  .strict();
export const workIssuesSchema = z.array(workIssueSchema);
