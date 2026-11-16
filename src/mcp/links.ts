// SPDX-License-Identifier: MIT
import { operationError } from "./operation-errors.js";
import { agentLimits } from "./limits.js";
import { z } from "zod";
import type {
  McpServer,
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import type { AgentWorkspace } from "./workspace.js";
import type { LinkJob } from "./links-jobs.js";
import { linkSections, type LinkSection } from "./links-view.js";
const actions = [
  "requirement",
  "add",
  "remove",
  "refresh",
  "list",
  "check",
  "requirements_for",
  "unlinked",
  "history",
] as const;
const text = z.string().min(1).max(4096);
const page = {
  section: z.enum(linkSections).default("items"),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
};
function output(
  value: Record<string, unknown>,
  isError = false,
): CallToolResult {
  const body = {
    viewSchema: "pymtheg.agent/v1",
    linkSchema: "pymtheg.mcp-links/v1",
    ...value,
  };
  const result = {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > agentLimits.linkResponseBytes)
    throw Error(
      "Link response exceeds 64 KiB; narrow the query or request fewer items. A mutation may have committed; reconcile with list/history.",
    );
  return result;
}
const state = (j: LinkJob) => ({
  jobId: j.id,
  state: j.exited ? j.state : "running",
  progress: j.progress,
  next: j.exited
    ? "Use link_result for immutable result pages; new reads capture current state."
    : "Call link_result with this jobId; wait:true waits with progress. Other MCP tools remain available.",
});
const failure = (error: unknown, jobId?: string) =>
  output(
    {
      jobId: jobId ?? null,
      state: "error",
      error: operationError(error, "invalid-input"),
    },
    true,
  );
async function wait(
  job: LinkJob,
  ctx: ServerContext,
  cancel: () => Promise<unknown>,
  bounded: boolean,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((r) => {
    if (bounded) timer = setTimeout(r, agentLimits.linkInlineWaitMs);
  });
  const abort = () => {
    void cancel();
  };
  let n = 0;
  const progress = (p: unknown) => {
    const token = ctx.mcpReq._meta?.progressToken;
    if (token !== undefined)
      void ctx.mcpReq
        .notify({
          method: "notifications/progress",
          params: {
            progressToken: token,
            progress: ++n,
            message: JSON.stringify(p),
          },
        })
        .catch(() => {});
  };
  job.listeners.add(progress);
  ctx.mcpReq.signal.addEventListener("abort", abort, { once: true });
  try {
    if (ctx.mcpReq.signal.aborted) abort();
    await (bounded ? Promise.race([job.done, deadline]) : job.done);
    if (ctx.mcpReq.signal.aborted) await job.done;
  } finally {
    clearTimeout(timer);
    job.listeners.delete(progress);
    ctx.mcpReq.signal.removeEventListener("abort", abort);
  }
}
function result(
  job: LinkJob,
  section: LinkSection,
  offset: number,
  limit: number,
): CallToolResult {
  if (!job.exited) return output(state(job));
  if (job.state === "error") return failure(job.error, job.id);
  if (job.state === "cancelled")
    return output(
      {
        ...state(job),
        mutationMayHaveCommitted: true,
        error: {
          code: "cancelled",
          message:
            "Cancelled; no completed answer is claimed. Already committed planning writes are not undone.",
          action: "Read list/history before retrying any mutation.",
        },
      },
      true,
    );
  const view = job.view!,
    rows = view.tables[section];
  for (;;) {
    const items = rows.slice(offset, offset + limit);
    const nextOffset =
      offset + items.length < rows.length ? offset + items.length : null;
    try {
      return output({
        ...state(job),
        summary: view.summary,
        failedFiles: {
          total: view.tables.failed_files.length,
          items: view.tables.failed_files.slice(0, 1),
          nextOffset: view.tables.failed_files.length > 1 ? 1 : null,
        },
        section,
        offset,
        limit,
        total: rows.length,
        items,
        nextOffset,
        truncated:
          nextOffset !== null ||
          offset > 0 ||
          view.summary.sourceTruncated ||
          view.summary.textClipped ||
          (section === "not_followed" &&
            view.summary.notFollowedCount > rows.length),
        next:
          nextOffset !== null
            ? "Continue this job/section at nextOffset. Core-bounded results require a new narrower query."
            : "Result page complete; inspect summary coverage before interpreting absence.",
      });
    } catch (e) {
      if (limit === 1) throw e;
      limit = Math.max(1, Math.floor(limit / 2));
    }
  }
}
export function registerLinkTools(
  server: McpServer,
  workspace: AgentWorkspace,
) {
  server.registerTool(
    "requirement_links",
    {
      description:
        "Connect planning requirements to Go/Rust/TS code. requirement creates a record; add links record+selector (exact/qualified name, path:line[:column], or unchanged symbol: ref); remove/refresh require link ID. list filters record/symbol/file; check reports non-ok links with differences and suggestions (moved is unconfirmed unless allowMoved); requirements_for selects symbol OR file with optional definite-caller impact; unlinked finds records and optionally public symbols; history reads receipts. Suggestions are NEVER applied. No application source is written. Queries sync the graph unless noSync. Waits up to 5s by default, returning the first bounded page or a progress handle; wait:false opts out. Finish graph indexing before link work on a cold project. Arguments by action (others are refused; wait, section, limit and noSync apply to all): requirement id, title, text, owner; add record, selector, note; remove link; refresh link; list record, symbol, file; check allowMoved; requirements_for symbol or file, impact, depth; unlinked symbols, symbolLimit; history none. The first planning write in a project that was never initialised initialises it first, as pymtheg init would.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: z
        .object({
          action: z.enum(actions),
          id: text.optional(),
          title: z.string().min(1).max(2000).optional(),
          text: z.string().max(10000).optional(),
          owner: z.string().max(200).optional(),
          record: text.optional(),
          selector: text.optional(),
          link: text.optional(),
          note: z.string().max(4000).optional(),
          symbol: text.optional(),
          file: text.optional(),
          impact: z.boolean().optional(),
          depth: z.number().int().min(0).max(100).optional(),
          allowMoved: z.boolean().optional(),
          symbols: z.boolean().optional(),
          symbolLimit: z
            .number()
            .int()
            .min(1)
            .max(1000)
            .optional()
            .describe("unlinked only; default 200"),
          noSync: z.boolean().default(false),
          wait: z.boolean().default(true),
          section: page.section,
          limit: page.limit,
        })
        .strict(),
    },
    async (a, ctx) => {
      try {
        const allowed: Record<string, string[]> = {
          requirement: ["id", "title", "text", "owner"],
          add: ["record", "selector", "note"],
          remove: ["link"],
          refresh: ["link"],
          list: ["record", "symbol", "file"],
          check: ["allowMoved"],
          requirements_for: ["symbol", "file", "impact", "depth"],
          unlinked: ["symbols", "symbolLimit"],
          history: [],
        };
        const required: Record<string, string[]> = {
          requirement: ["id", "title"],
          add: ["record", "selector"],
          remove: ["link"],
          refresh: ["link"],
        };
        for (const key of required[a.action] ?? [])
          if (!(a as Record<string, unknown>)[key])
            throw Error(`${a.action} requires ${key}`);
        const common = new Set([
          "action",
          "wait",
          "section",
          "limit",
          "noSync",
        ]);
        const input: Record<string, unknown> = { noSync: a.noSync };
        for (const [key, value] of Object.entries(a))
          if (!common.has(key) && value !== undefined) {
            if (!allowed[a.action]!.includes(key))
              throw Error(
                `${key} is not accepted by ${a.action}. ${a.action} accepts ${allowed[a.action]!.length ? allowed[a.action]!.join(", ") : "no action-specific arguments"}, plus wait, section, limit and noSync.`,
              );
            input[key] = value;
          }
        if (
          a.action === "requirements_for" &&
          (a.symbol === undefined) === (a.file === undefined)
        )
          throw Error(
            "requirements_for requires exactly one of symbol or file",
          );
        if (a.action === "unlinked") {
          delete input.symbolLimit;
          input.limit = a.symbolLimit ?? 200;
        }
        ctx.mcpReq.signal.throwIfAborted();
        if (workspace.graph?.activeId())
          throw Object.assign(
            Error(
              "A graph job is running; await graph_result before a link operation.",
            ),
            { code: "busy" },
          );
        const job = workspace.links.start(a.action, input);
        if (a.wait)
          await wait(job, ctx, () => workspace.links.cancel(job.id), true);
        return result(job, a.section, 0, a.limit);
      } catch (e) {
        return failure(e, workspace.links.activeId() ?? undefined);
      }
    },
  );
  server.registerTool(
    "link_result",
    {
      description:
        "Read a requirement_links job's progress or immutable bounded page. wait:true waits for worker exit (including SQLite's bounded lock wait), with progress notifications. section selects items, matches, failed_files, not_followed or symbols; continue at nextOffset. cancel joins its worker; mutations may already have committed, so reconcile using list/history before retry. Handles are connection-owned, retained for three jobs. Native lock cleanup can wait until SQLite returns, but the MCP event loop remains responsive.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: z
        .object({
          jobId: text,
          action: z.enum(["read", "cancel"]).default("read"),
          wait: z.boolean().default(false),
          ...page,
        })
        .strict(),
    },
    async (a, ctx) => {
      try {
        let job = workspace.links.get(a.jobId);
        if (a.action === "cancel") job = await workspace.links.cancel(a.jobId);
        else if (a.wait && !job.exited)
          await wait(job, ctx, () => workspace.links.cancel(job.id), false);
        return result(job, a.section, a.offset, a.limit);
      } catch (e) {
        return failure(e, a.jobId);
      }
    },
  );
}
