import { z } from "zod";
import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
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
  state: job.state,
  progress: job.progress,
  next:
    job.state === "running"
      ? "Call graph_result with this jobId; wait=true waits with progress notifications. Polling is also supported."
      : "Read result sections; job snapshots never auto-refresh.",
});
const failure = (error: unknown, jobId?: string) =>
  output(
    {
      state: "error",
      jobId: jobId ?? null,
      error: {
        code: "GRAPH_REQUEST_FAILED",
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          2048,
        ),
        action:
          "Use code_graph status, read/cancel an active job, or narrow the query. Start a new job if the handle expired. No complete answer is claimed.",
      },
    },
    true,
  );
export function registerGraphTools(
  server: McpServer,
  workspace: AgentWorkspace,
) {
  server.registerTool(
    "code_graph",
    {
      description:
        "Ask about Go/Rust/TypeScript code: search first, then symbol/callers/callees/impact/path/file. Selectors accept stable symbol refs, exact names, qualified names or path:line[:column]. Queries automatically sync changed content unless noSync. Every call starts a nonblocking job; retrieve with graph_result. index explicitly updates all modules; status is read-only. Cold indexing can be long: poll the job for deterministic file/phase progress. Never treat possible/unresolved calls as definite.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: z
        .object({
          action: z.enum(commands),
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
    async (a) => {
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
        const job = workspace.graph.start({
          command: a.action,
          args: needs ? [a.query!, ...(a.to !== undefined ? [a.to] : [])] : [],
          limit: a.limit,
          depth: a.depth,
          noSync: a.noSync,
          caseSensitive: a.caseSensitive,
          includePossible: a.includePossible,
        });
        return output(state(job));
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
          let count = 0;
          const notify = (p: unknown) => {
            const token = ctx.mcpReq._meta?.progressToken;
            if (token !== undefined)
              void ctx.mcpReq
                .notify({
                  method: "notifications/progress",
                  params: {
                    progressToken: token,
                    progress: ++count,
                    message: JSON.stringify(p),
                  },
                })
                .catch(() => {});
          };
          const aborted = () => {
            void workspace.graph.cancel(job.id);
          };
          job.listeners.add(notify);
          ctx.mcpReq.signal.addEventListener("abort", aborted, { once: true });
          try {
            if (ctx.mcpReq.signal.aborted) aborted();
            await job.done;
          } finally {
            job.listeners.delete(notify);
            ctx.mcpReq.signal.removeEventListener("abort", aborted);
          }
          job = workspace.graph.get(a.jobId);
        }
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
          a.section === "detail"
            ? Math.min(a.limit, 16384)
            : Math.min(a.limit, 100);
        for (;;) {
          const page = view.page(a.section, a.offset, limit, a.ref);
          const previews =
            a.section === "answer"
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
      } catch (error) {
        return failure(error, a.jobId);
      }
    },
  );
}
