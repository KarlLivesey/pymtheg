// SPDX-License-Identifier: MIT
import type { operationError } from "./operation-errors.js";
import { findProjectRoot } from "../storage/local.js";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import type { GraphRequest, GraphProgress } from "../graph/commands.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
export interface GraphJob {
  id: string;
  state: "running" | "complete" | "error" | "cancelled";
  progress: GraphProgress | null;
  exited: boolean;
  worker: Worker;
  done: Promise<void>;
  view?: GraphView;
  error?: string | ReturnType<typeof operationError>;
  listeners: Set<(p: GraphProgress) => void>;
}
export class GraphJobs {
  private readonly jobs = new Map<string, GraphJob>();
  private closed = false;
  constructor(
    private readonly root: string,
    private readonly launch: (request: GraphRequest) => Worker = (request) =>
      new Worker(new URL("./graph-worker.js", import.meta.url), {
        workerData: request,
        stdout: true,
        stderr: true,
      }),
  ) {}
  activeId() {
    return [...this.jobs.values()].find((j) => !j.exited)?.id ?? null;
  }
  start(request: Omit<GraphRequest, "root">) {
    if (findProjectRoot(this.root) !== this.root)
      throw Error(
        "Graph boundary differs from the MCP launch root. Launch at the project root or initialize this directory before indexing; parent projects are never indexed implicitly.",
      );
    if (this.closed) throw Error("Graph session closed; reconnect.");
    if ([...this.jobs.values()].some((j) => !j.exited))
      throw Error(
        "A graph job is running. Read or cancel its jobId with graph_result before starting another.",
      );
    const worker = this.launch({ ...request, root: this.root });
    // Only parentPort messages enter the protocol; module logging must not corrupt stdio.
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settle!: () => void;
    const job: GraphJob = {
      id: randomUUID(),
      state: "running",
      progress: null,
      exited: false,
      worker,
      done: new Promise((r) => {
        settle = r;
      }),
      listeners: new Set(),
    };
    worker.on(
      "message",
      (m: {
        kind: string;
        progress?: GraphProgress;
        view?: GraphView;
        message?: string;
        error?: ReturnType<typeof operationError>;
      }) => {
        if (job.state !== "running") return;
        if (m.kind === "progress") {
          job.progress = m.progress!;
          for (const listener of job.listeners) listener(job.progress);
        } else if (m.kind === "result") {
          job.view = Object.assign(Object.create(GraphView.prototype), m.view);
          job.state = "complete";
        } else {
          job.error = m.error ?? m.message ?? "Graph worker failed";
          job.state = "error";
        }
      },
    );
    worker.on("error", (e) => {
      job.error = e.message;
      job.state = "error";
    });
    worker.on("exit", (code) => {
      job.exited = true;
      if (
        job.state === "running" ||
        (code !== 0 && job.state !== "cancelled")
      ) {
        job.state = "error";
        job.error ??= `Graph worker exited (${code}); restart indexing. Completion may be missing.`;
      }
      settle();
    });
    this.jobs.set(job.id, job);
    while (this.jobs.size > agentLimits.graphJobs)
      this.jobs.delete(this.jobs.keys().next().value!);
    return job;
  }
  get(id: string) {
    const job = this.jobs.get(id);
    if (!job)
      throw Error(
        "Unknown or expired graph job. Start code_graph again; jobs last only for this connection.",
      );
    return job;
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (!job.exited) {
      job.state = "cancelled";
      await job.worker.terminate();
      await job.done;
    }
    return job;
  }
  async close() {
    this.closed = true;
    await Promise.all(
      [...this.jobs.keys()].map(async (id) => {
        const job = await this.cancel(id);
        await job.done;
      }),
    );
    this.jobs.clear();
  }
}
