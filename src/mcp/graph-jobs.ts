// SPDX-License-Identifier: MIT
import type { operationError } from "./operation-errors.js";
import { findProjectRoot } from "../storage/local.js";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import type { GraphRequest, GraphProgress } from "../graph/commands.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
import {
  jobChildGroups,
  killChildGroups,
  liveChildGroups,
  releaseJobChildGroups,
} from "../backends/child-groups.js";
import type { ProcessClock } from "../backends/process.js";

/**
 * How long a cancel waits for the worker's `aborted` answer while a child
 * process group is live. The answer normally comes at once; the bound only
 * keeps a worker that will not answer from holding the cancel for ever. It
 * decides nothing but how long clean-up may take: the job's groups are
 * killed either way.
 */
export const CANCEL_GRACE_MS = 30_000;
const systemClock: ProcessClock = {
  schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
};
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
  /** The process groups the job's worker started, owned by this server. */
  childGroups: SharedArrayBuffer;
  /** Settles when the worker answers an abort with no live child group. */
  aborted: Promise<void>;
}

export class GraphJobs {
  private readonly jobs = new Map<string, GraphJob>();
  private closed = false;
  constructor(
    private readonly root: string,
    private readonly launch: (
      request: GraphRequest & { childGroups: SharedArrayBuffer },
    ) => Worker = (request) =>
      new Worker(new URL("./graph-worker.js", import.meta.url), {
        workerData: request,
        stdout: true,
        stderr: true,
      }),
    /** Test hooks: the clock and bound of the cancel's grace. */
    private readonly controls: { clock?: ProcessClock; graceMs?: number } = {},
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
    // The job's own registry; a server that exits kills it (child-groups.ts).
    const childGroups = jobChildGroups();
    const worker = this.launch({ ...request, root: this.root, childGroups });
    // Only parentPort messages enter the protocol; module logging must not corrupt stdio.
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settle!: () => void;
    let abortAnswered!: () => void;
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
      childGroups,
      aborted: new Promise((r) => {
        abortAnswered = r;
      }),
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
        if (m.kind === "aborted") {
          abortAnswered();
          return;
        }
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
      // Whatever the worker left running, this server kills.
      releaseJobChildGroups(childGroups);
      abortAnswered();
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
  /**
   * Cancels a job (C-43 review). The worker is asked to abort first: its
   * abort signal kills the process groups it is waiting on and lets the
   * toolchain route remove its run folder; the worker answers `aborted`
   * once the command has settled. The server waits for that answer only
   * while the job has a live child process group: a group is live only
   * while the worker awaits it (`runProcess`), so its event loop is free
   * and the answer comes. A worker that does not answer within
   * `CANCEL_GRACE_MS` (it is stuck, or not the production worker) is
   * terminated all the same. With no live group there is nothing to clean
   * up, and the worker is terminated at once, as before. Any group still
   * recorded after the worker has gone is killed by this server, which needs
   * no help from the worker.
   */
  async cancel(id: string) {
    const job = this.get(id);
    if (!job.exited) {
      job.state = "cancelled";
      job.worker.postMessage({ kind: "abort" });
      if (liveChildGroups(job.childGroups).length) {
        const clock = this.controls.clock ?? systemClock;
        let timer: unknown;
        await Promise.race([
          job.aborted,
          job.done,
          new Promise<void>((resolve) => {
            timer = clock.schedule(
              resolve,
              this.controls.graceMs ?? CANCEL_GRACE_MS,
            );
          }),
        ]);
        clock.cancel(timer);
      }
      await job.worker.terminate();
      await job.done;
    }
    killChildGroups(job.childGroups);
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
