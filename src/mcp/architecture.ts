import { revisionSchema } from "../architecture/schema.js";
import { branchReview } from "../architecture/branches.js";
import { json } from "../shared/identity.js";
import { sourceTargetsSchema } from "../shared/source-contracts.js";
import { z } from "zod";
import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import type { AgentWorkspace } from "./workspace.js";

/** Read access only. Architecture status stays an authored/imported claim. */
export function registerArchitectureTools(
  server: McpServer,
  workspace: AgentWorkspace,
  output: (value: Record<string, unknown>) => CallToolResult,
) {
  server.registerTool(
    "read_architecture",
    {
      description:
        "Read the retained architecture, including planning records and complete source documents. Imported and authored claims remain unverified. Start with summary, then page records or documents; follow stable record IDs and dependencies. Never writes the project.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: z
        .object({
          section: z
            .enum([
              "summary",
              "records",
              "record",
              "documents",
              "document",
              "search",
              "changes",
              "work",
              "branches",
              "branch_reviews",
              "branch_withdrawals",
              "source_contracts",
              "source_contract",
            ])
            .default("summary"),
          branchState: z
            .enum(["all", "unreviewed", "reviewed", "unknown"])
            .default("all"),
          revision: z.string().optional(),
          sourceSnapshotId: z.string().optional(),
          planId: z
            .string()
            .max(240)
            .optional()
            .describe(
              "Planning record ID, such as plan:R1. Selects that plan's recorded source expectations for source_contract comparisons; omit only when no per-plan comparison is needed.",
            ),
          sourceTargets: sourceTargetsSchema.optional(),
          previous: z.string().optional(),
          id: z.string().optional(),
          path: z.string().optional(),
          query: z.string().max(256).default(""),
          owner: z.string().optional(),
          kind: z
            .enum([
              "route",
              "command",
              "review",
              "profile",
              "release",
              "document",
              "heading",
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
            ])
            .optional(),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(50).default(20),
          characterOffset: z.number().int().min(0).default(0),
        })
        .strict(),
    },
    async (a, ctx) => {
      if (a.section === "source_contracts")
        return output(
          await workspace.access.sourceContractPage(
            {
              ...(a.sourceSnapshotId ? { snapshotId: a.sourceSnapshotId } : {}),
              ...(a.path ? { file: a.path } : {}),
              query: a.query,
              offset: a.offset,
              limit: a.limit,
              targets: a.sourceTargets,
            },
            ctx.mcpReq.signal,
          ),
        );
      if (a.section === "source_contract") {
        if (!a.id?.startsWith("source:"))
          throw Error(
            "Choose a source:<file>#<component> ID from source_contracts",
          );
        const snapshotId =
          a.sourceSnapshotId ??
          (
            await workspace.access.sourceContractPage(
              { targets: [a.id], limit: 1 },
              ctx.mcpReq.signal,
            )
          ).snapshotId;
        return output(
          await workspace.access.sourceContractDetail(
            { id: a.id, snapshotId, revision: a.revision, planId: a.planId },
            ctx.mcpReq.signal,
          ),
        );
      }
      if (a.section === "search" && a.offset > 0 && !a.revision)
        throw Error(
          "Continue search with the revision returned by its first page",
        );
      const { index, revisions, activeRevision } =
        await workspace.access.architectureOverview(a.revision);
      const boundary =
        "Stored architecture information. Import, planning status and linked evidence are not semantic verification.";
      if (!index) return output({ boundary, available: false, revisions: [] });
      const branches = branchReview(
        revisions.map((r) => revisionSchema.parse(r)),
        activeRevision,
      );
      const needing = branches.filter(
          (b) => b.lineage === "recorded" && !b.reviewed,
        ),
        unknown = branches.filter((b) => b.lineage === "unknown"),
        reviewed = branches.filter(
          (b) => b.lineage === "recorded" && b.reviewed,
        );
      const common = {
        boundary,
        revision: index.id,
        branchCounts: {
          unreviewed: needing.length,
          unknown: unknown.length,
          reviewed: reviewed.length,
        },
      };
      const paged = (items: unknown[]) => ({
        ...common,
        total: items.length,
        offset: a.offset,
        items: items.slice(a.offset, a.offset + a.limit),
        nextOffset:
          a.offset + a.limit < items.length ? a.offset + a.limit : null,
      });
      const planningDocuments = new Set(
        index.entities.filter((e) => e.planning).map((e) => e.document),
      );
      switch (a.section) {
        case "branch_withdrawals":
          if (!a.id) throw Error("Choose a branch acknowledgement ID");
          return output({
            ...common,
            ...(await workspace.access.branchWithdrawalHistory(
              a.id,
              a.offset,
              a.limit,
            )),
          });
        case "branch_reviews":
          return output({
            ...common,
            ...(await workspace.access.branchReviewHistory(
              a.id ?? index.id,
              a.offset,
              a.limit,
            )),
          });
        case "branches":
          return output(
            paged(
              a.branchState === "unreviewed"
                ? needing
                : a.branchState === "reviewed"
                  ? reviewed
                  : a.branchState === "unknown"
                    ? unknown
                    : branches,
            ),
          );
        case "work":
          return output(
            paged(
              await workspace.access.architectureWork(
                index.id,
                ctx.mcpReq.signal,
              ),
            ),
          );
        case "summary":
          return output({
            ...common,
            branchesNeedingReview: needing.slice(a.offset, a.offset + a.limit),
            unknownLineage: unknown.slice(a.offset, a.offset + a.limit),
            reviewedBranches: reviewed.slice(a.offset, a.offset + a.limit),
            branchPaging: {
              offset: a.offset,
              limit: a.limit,
              nextOffset:
                a.offset + a.limit <
                Math.max(needing.length, unknown.length, reviewed.length)
                  ? a.offset + a.limit
                  : null,
            },
            measurements: {
              ...index.measurements,
              documents: index.entities.filter(
                (e) =>
                  e.kind === "document" && !planningDocuments.has(e.document),
              ).length,
              storedDocuments: index.documents.length,
            },
            warnings: index.warnings,
            revisions: revisions.slice(a.offset, a.offset + a.limit),
            totalRevisions: revisions.length,
          });
        case "records":
          return output(
            paged(
              index.entities
                .filter(
                  (e) =>
                    (!a.owner || e.owner === a.owner) &&
                    (!a.kind || e.kind === a.kind) &&
                    `${e.key} ${e.summary} ${e.kind} ${e.status} ${e.searchText ?? ""}`
                      .toLowerCase()
                      .includes(a.query.toLowerCase()),
                )
                .map(({ searchText, ...e }) => ({
                  ...e,
                  summary: e.summary.slice(0, 1000),
                  summaryTruncated: e.summary.length > 1000,
                })),
            ),
          );
        case "documents":
          return output(paged(index.documents));
        case "record": {
          if (!a.id) throw Error("Choose a record ID");
          const record = await workspace.access.architectureRecord(
            index.id,
            a.id,
          );
          const content =
            Buffer.byteLength(json(record.data)) > 128 * 1024
              ? {
                  dataOmitted: true,
                  reason:
                    "Read the complete original document in character pages.",
                  document: record.entity.document,
                  pointer: record.entity.pointer,
                }
              : { data: record.data };
          const { searchText: _searchText, ...entity } = record.entity;
          return output({
            ...common,
            entity,
            ...content,
            dependents: record.dependents.slice(a.offset, a.offset + a.limit),
            totalDependents: record.dependents.length,
            impact: Object.fromEntries(
              Object.entries(record.impact).map(([kind, items]) => [
                kind,
                {
                  total: items.length,
                  items: items.slice(a.offset, a.offset + a.limit),
                },
              ]),
            ),
            outgoing: index.edges
              .filter((e) => e.from === a.id)
              .slice(a.offset, a.offset + a.limit),
          });
        }
        case "document": {
          if (!a.path) throw Error("Choose a retained document path");
          const document = await workspace.access.architectureDocument(
            index.id,
            a.path,
          );
          return output({
            ...common,
            path: document.path,
            characterOffset: a.characterOffset,
            text: document.text.slice(
              a.characterOffset,
              a.characterOffset + 16000,
            ),
            totalCharacters: document.text.length,
            nextCharacterOffset:
              a.characterOffset + 16000 < document.text.length
                ? a.characterOffset + 16000
                : null,
          });
        }
        case "search": {
          const query = a.query.trim().toLowerCase();
          const records = query
            ? index.entities.filter(
                (e) =>
                  e.planning &&
                  `${e.key} ${e.summary} ${e.searchText ?? ""}`
                    .toLowerCase()
                    .includes(query),
              )
            : [];
          return output({
            ...common,
            recordMatches: records
              .slice(a.offset, a.offset + a.limit)
              .map((e) => ({
                id: e.id,
                name: e.name,
                kind: e.kind,
                document: e.document,
              })),
            recordTotal: records.length,
            nextRecordOffset:
              a.offset + a.limit < records.length ? a.offset + a.limit : null,
            ...(await workspace.access.searchArchitecturePage(
              index.id,
              a.query,
              a.offset,
              a.limit,
            )),
          });
        }
        case "changes": {
          if (!a.previous) throw Error("Choose the previous revision");
          return output({
            ...common,
            previous: a.previous,
            ...(await workspace.access.compareArchitecture(
              index.id,
              a.previous,
            )),
          });
        }
      }
    },
  );
}
