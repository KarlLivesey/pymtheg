// SPDX-License-Identifier: MIT
import { operationError } from "./operation-errors.js";
import {
  graphDeadline,
  waitForGraph,
  type GraphDeadline,
} from "./graph-wait.js";
import { z } from "zod";
import type {
  McpServer,
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import type { AgentWorkspace } from "./workspace.js";
import type { GraphJob } from "./graph-jobs.js";
import { graphSections } from "./graph-view.js";
import { agentLimits } from "./limits.js";

const commands = [
  "index",
  "status",
  "search",
  "symbol",
  "callers",
  "callees",
  "path",
  "impact",
  "file",
] as const;
function output(
  value: Record<string, unknown>,
  failed = false,
): CallToolResult {
  const body = {
    viewSchema: "pymtheg.agent/v1",
    graphSchema: "pymtheg.mcp-graph/v1",
    ...value,
  };
  const result = {
    ...(failed ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
  if (
    Buffer.byteLength(JSON.stringify(result)) >
    Math.min(agentLimits.graphResponseBytes, agentLimits.responseBytes)
  )
    throw Error(
      "Page exceeds transport budget. Use a smaller limit or section detail with a ref.",
    );
  return result;
}
const state = (job: GraphJob) => ({
  jobId: job.id,
  state: job.exited ? job.state : "running",
  progress: job.progress,
  next: !job.exited
    ? "Call graph_result with this jobId; wait=true waits with progress notifications. Polling is also supported."
    : "Read result sections; job snapshots never auto-refresh.",
});
const failure = (error: unknown, jobId?: string) =>
  output(
    {
      state: "error",
      jobId: jobId ?? null,
      error: operationError(error, "GRAPH_REQUEST_FAILED"),
    },
    true,
  );
function resultPage(
  job: GraphJob,
  pageRequest: {
    section: (typeof graphSections)[number];
    limit: number;
    offset: number;
    ref?: string | undefined;
  },
): CallToolResult {
  if (!job.exited) return output(state(job));
  if (job.state === "error") return failure(job.error, job.id);
  if (job.state !== "complete")
    return output(
      {
        ...state(job),
        ...(job.state === "cancelled"
          ? {
              error: {
                code: "GRAPH_CANCELLED",
                message:
                  "Graph job was cancelled; no completed answer is claimed.",
                action:
                  "Start a new code_graph job. Missing completion metadata forces a sync.",
              },
            }
          : {}),
      },
      job.state === "cancelled",
    );
  const view = job.view!;
  let limit =
    pageRequest.section === "detail"
      ? Math.min(pageRequest.limit, 16384)
      : Math.min(pageRequest.limit, 100);
  for (;;) {
    const page = view.page(
      pageRequest.section,
      pageRequest.offset,
      limit,
      pageRequest.ref,
    );
    const previews =
      pageRequest.section === "answer"
        ? {
            symbols: view.tables.symbols!.slice(0, 1),
            links: view.tables.links!.slice(0, 1),
            possibleCallers: view.tables.possible_callers!.slice(0, 1),
            failedFiles: view.tables.failed_files!.slice(0, 1),
          }
        : undefined;
    try {
      return output({
        ...state(job),
        summary: view.summary,
        failedFiles: {
          total: view.tables.failed_files!.length,
          items: view.tables.failed_files!.slice(0, 1),
          nextOffset: view.tables.failed_files!.length > 1 ? 1 : null,
        },
        ...page,
        ...(previews ? { previews } : {}),
      });
    } catch (error) {
      if (limit === 1) throw error;
      limit = Math.max(1, Math.floor(limit / 2));
    }
  }
}
function progressFor(ctx: ServerContext) {
  let count = 0;
  return (value: unknown) => {
    const token = ctx.mcpReq._meta?.progressToken;
    if (token !== undefined)
      void ctx.mcpReq
        .notify({
          method: "notifications/progress",
          params: {
            progressToken: token,
            progress: ++count,
            message: JSON.stringify(value),
          },
        })
        .catch(() => {});
  };
}
export function registerGraphTools(
  server: McpServer,
  workspace: AgentWorkspace,
  options: { deadline?: (milliseconds: number) => GraphDeadline } = {},
) {
  server.registerTool(
    "code_graph",
    {
      description:
        "Ask about Go/Rust/TypeScript code: search first, then symbol/callers/callees/impact/path/file. Selectors accept stable symbol refs, exact names, qualified names or path:line[:column]. Queries automatically sync changed content unless noSync. Returns the first result page inline when finished within 5 seconds (default wait:true); otherwise returns a job with progress for graph_result. Use wait:false to return a handle immediately. section chooses the first result page; later pages use graph_result. index explicitly updates all modules; status is read-only. Cold indexing can be long: poll the job for deterministic file/phase progress. Never treat possible/unresolved calls as definite.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: z
        .object({
          action: z.enum(commands),
          wait: z.boolean().default(true),
          section: z
            .enum(graphSections.filter((section) => section !== "detail"))
            .default("answer"),
          query: z.string().max(4096).optional(),
          to: z.string().max(4096).optional(),
          limit: z.number().int().min(1).max(100).default(20),
          depth: z.number().int().min(0).max(100).default(5),
          noSync: z.boolean().default(false),
          caseSensitive: z.boolean().default(false),
          includePossible: z.boolean().default(false),
        })
        .strict(),
    },
    async (a, ctx) => {
      try {
        const needs = a.action !== "index" && a.action !== "status";
        if (
          (needs && a.query === undefined) ||
          (!needs && a.query !== undefined) ||
          (a.action === "path") !== (a.to !== undefined)
        )
          throw Error(
            "index/status take no query; other actions require query; only path requires to.",
          );
        ctx.mcpReq.signal.throwIfAborted();
        if (workspace.links?.activeId())
          throw Error(
            "A requirement-link job is running; await link_result before starting graph work.",
          );
        const job = workspace.graph.start({
          command: a.action,
          args: needs ? [a.query!, ...(a.to !== undefined ? [a.to] : [])] : [],
          limit: a.limit,
          depth: a.depth,
          noSync: a.noSync,
          caseSensitive: a.caseSensitive,
          includePossible: a.includePossible,
        });
        if (a.wait && !job.exited)
          await waitForGraph(
            job,
            ctx.mcpReq.signal,
            () => workspace.graph.cancel(job.id),
            progressFor(ctx),
            (options.deadline ?? graphDeadline)(agentLimits.graphInlineWaitMs),
          );
        return resultPage(job, {
          section: a.section,
          offset: 0,
          limit: a.limit,
        });
      } catch (error) {
        return failure(error, workspace.graph.activeId() ?? undefined);
      }
    },
  );
  server.registerTool(
    "graph_result",
    {
      description:
        "Read/poll/cancel a code_graph job. Default answer includes counts, failure names and certainty previews. Follow nextOffset for immutable pages; sections symbols/links/possible_callers/frontiers/candidates/failed_files/stale_files/warnings/modules/legend/detail. Filter candidates by ref=link ref; detail retrieves exact stored JSON in character pages (limit <=16384). Reason codes expand in legend. Core truncation requires a narrower/new query, not more pages. wait=true waits without blocking other tools and emits progress if the client supplied a progressToken.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: z
        .object({
          jobId: z.string().uuid(),
          action: z.enum(["read", "cancel"]).default("read"),
          section: z.enum(graphSections).default("answer"),
          ref: z.string().max(8192).optional(),
          offset: z.number().int().nonnegative().default(0),
          limit: z.number().int().min(1).max(16384).default(20),
          wait: z.boolean().default(false),
        })
        .strict(),
    },
    async (a, ctx) => {
      try {
        let job = workspace.graph.get(a.jobId);
        if (a.action === "cancel")
          return output(state(await workspace.graph.cancel(a.jobId)));
        if (a.wait && !job.exited) {
          await waitForGraph(
            job,
            ctx.mcpReq.signal,
            () => workspace.graph.cancel(job.id),
            progressFor(ctx),
            null,
          );
          job = workspace.graph.get(a.jobId);
        }
        return resultPage(job, a);
      } catch (error) {
        return failure(error, a.jobId);
      }
    },
  );
}
