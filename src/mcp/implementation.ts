// SPDX-License-Identifier: MIT
import { implementationComparisonQuerySchema } from "../implementation/comparison-protocol.js";
import { z } from "zod";
import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import type { AgentWorkspace } from "./workspace.js";
import type { ArchitectureIndex } from "../architecture/schema.js";
import {
  implementationQuerySchema,
  captureCodeSchema,
  bindCodeSchema,
  unlinkCodeSchema,
  implementationFilesQuerySchema,
} from "../implementation/protocol.js";
const revisionReceipt = (
  revision: ArchitectureIndex & { storage?: unknown },
) => ({
  id: revision.id,
  snapshotHash: revision.snapshotHash,
  measurements: revision.measurements,
  warningCount: revision.warnings.length,
  ...(revision.storage ? { storage: revision.storage } : {}),
});
export function registerImplementationTools(
  server: McpServer,
  workspace: AgentWorkspace,
  output: (v: Record<string, unknown>) => CallToolResult,
) {
  server.registerTool(
    "compare_implementation",
    {
      description:
        "Compare one retained plan/declaration link against its exact reviewed checkpoint. Shows bounded source diff, paged relationship counts and explicit missing-baseline/coverage limits. Read-only; never acknowledges changes. Use link_implementation with this response's current revision, plan hash, observation ID and retained note only after explicit review to accept the current pair.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: implementationComparisonQuerySchema,
    },
    async (args, ctx) =>
      output(
        await workspace.access.implementationComparison(
          args,
          ctx.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "read_implementation",
    {
      description:
        "Read versioned planned/existing-code graphs and implementation gaps, or discover candidate TS/JS paths with section files. File pages use inventoryId; graph pages use plan/code revisions. Version pages accept query and category (all/design/code/links); retain catalogHash while paging and selectedId to keep a chosen checkpoint visible. Code presence never proves correctness. Does not write the workspace.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: implementationQuerySchema
        .extend({
          section: z.enum(["versions", "graph", "files"]).default("versions"),
          directory: z.string().optional(),
          inventoryId: z.string().optional(),
          category: z.enum(["all", "design", "code", "links"]).optional(),
          selectedId: z.string().max(256).optional(),
          catalogHash: z.string().optional(),
        })
        .strict(),
    },
    async (args, ctx) => {
      if (
        args.section !== "versions" &&
        (args.category !== undefined ||
          args.selectedId !== undefined ||
          args.catalogHash !== undefined)
      )
        throw Error(
          "category, selectedId and catalogHash apply only to section versions.",
        );
      if (args.section === "files")
        return output(
          await workspace.access.implementationFiles(
            implementationFilesQuerySchema.parse({
              directory: args.directory,
              inventoryId: args.inventoryId,
              query: args.query,
              offset: args.offset,
              limit: args.limit,
            }),
            ctx.mcpReq.signal,
          ),
        );
      if (args.directory !== undefined || args.inventoryId !== undefined)
        throw Error("directory and inventoryId apply only to section files.");
      if (args.section === "versions")
        return output(
          await workspace.access.implementationVersions(
            args.offset,
            args.limit,
            {
              query: args.query,
              ...(args.category ? { category: args.category } : {}),
              ...(args.selectedId ? { selectedId: args.selectedId } : {}),
              ...(args.catalogHash ? { catalogHash: args.catalogHash } : {}),
            },
          ),
        );
      return output(
        (await workspace.access.implementationGraph(
          implementationQuerySchema.parse(
            Object.fromEntries(
              Object.entries(args).filter(
                ([key]) =>
                  ![
                    "section",
                    "directory",
                    "inventoryId",
                    "category",
                    "selectedId",
                    "catalogHash",
                  ].includes(key),
              ),
            ),
          ),
          ctx.mcpReq.signal,
        )) ?? {
          activeRevision: null,
          meaning:
            "No retained architecture or implementation observations yet.",
        },
      );
    },
  );
  server.registerTool(
    "observe_implementation",
    {
      description:
        "Explicitly capture selected TypeScript/JavaScript files without executing them and retain a named code version in local architecture history. Writes metadata only; never application source. Call read_implementation versions first and pass its activeRevision as expectedRevision.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: captureCodeSchema.omit({ runId: true }).extend({
        trust: z
          .enum(["trusted", "source-only"])
          .optional()
          .describe(
            "On a project that was never initialised: the answer to whether this repository is trusted (D22). Ask your user or follow your standing instructions.",
          ),
      }),
    },
    async ({ trust, ...args }, ctx) =>
      output({
        revision: revisionReceipt(
          await (async () => {
            await workspace.initialiseForWrite(trust);
            return workspace.access.observeImplementation(
              args,
              ctx.mcpReq.signal,
            );
          })(),
        ),
        meaning: "Observed source structure. No correctness proof.",
      }),
  );
  server.registerTool(
    "link_implementation",
    {
      description:
        "Explicitly link a current plan record to an observed code declaration after reviewing both. Requires reviewed:true, the exact current plan hash and observation ID from read_implementation. Returns a compact revision receipt; use paged reads for details. Retains a versioned metadata link; does not modify source or mark behaviour verified.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: bindCodeSchema
        .extend({
          reviewed: z
            .literal(true)
            .describe(
              "Confirm that you inspected this plan and observed declaration before linking or accepting the new version.",
            ),
          trust: z
            .enum(["trusted", "source-only"])
            .optional()
            .describe(
              "On a project that was never initialised: the answer to whether this repository is trusted (D22). Ask your user or follow your standing instructions.",
            ),
        })
        .strict(),
    },
    async ({ reviewed, trust, ...args }, ctx) =>
      output({
        revision: revisionReceipt(
          await (async () => {
            await workspace.initialiseForWrite(trust);
            return workspace.access.linkImplementation(args, ctx.mcpReq.signal);
          })(),
        ),
        reviewed,
        meaning:
          "Explicit review recorded for this pair. Code presence is not a correctness proof.",
      }),
  );
  server.registerTool(
    "unlink_implementation",
    {
      description:
        "Remove one explicit plan/declaration link from the current revision. Preserves other links, all source and previous history; use even if the linked code no longer exists.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: unlinkCodeSchema,
    },
    async (args, ctx) =>
      output({
        revision: revisionReceipt(
          await workspace.access.unlinkImplementation(args, ctx.mcpReq.signal),
        ),
      }),
  );
}
