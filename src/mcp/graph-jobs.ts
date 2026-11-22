// SPDX-License-Identifier: MIT
import type { operationError } from "./operation-errors.js";
import { findProjectRoot } from "../storage/local.js";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import type { GraphRequest, GraphProgress } from "../graph/commands.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
import { CONTROL, SECTION, controlLength } from "./graph-control.js";
export interface GraphJob {
  id: string;
  state: "running" | "complete" | "error" | "cancelled";
  progress: GraphProgress | null;
  /** The job has finished: its worker answered, or exited. */
  exited: boolean;
  worker: Worker;
  done: Promise<void>;
  view?: GraphView;
  error?: string | ReturnType<typeof operationError>;
  listeners: Set<(p: GraphProgress) => void>;
  /** The worker's session counters after the job (C-48). */
  session?: { loads: number; runs: number; dropped: number };
  /** The job's work counters and stage times (observations). */
  work?: { counts: Record<string, number>; stages: Record<string, unknown> };
}
export interface GraphJobsOptions {
  /** Starts a worker that shares `control` (tests supply their own). */
  launch?: (control: SharedArrayBuffer) => Worker;
  /** The clock idleness is measured with (tests control it). */
  clock?: () => number;
  /** A worker with no job for this long is ended, with its session. */
  idleMs?: number;
}
type WorkerMessage = {
  kind: string;
  id?: string;
  progress?: GraphProgress;
  view?: GraphView;
  message?: string;
  error?: ReturnType<typeof operationError>;
  session?: GraphJob["session"];
  work?: GraphJob["work"];
};
/**
 * The MCP server's graph jobs (C-48): one job at a time, run by one worker
 * that lives between jobs and keeps its index session (graph-worker.ts).
 *
 * Cancelling sets the shared cancel flag and then reads the worker's
 * section. In the graph command itself the worker acknowledges at its next
 * checkpoint and lives on. Inside a language module's call it may pass no
 * checkpoint for long, so it is terminated there, as before C-48, and the
 * next job starts a new worker; a terminated worker leaves the store as a
 * killed CLI run does (the next run repairs it). The worker sets its section
 * before it checks the flag, and the flag is set before the section is
 * read, so a cancellation is never missed by both.
 *
 * A worker with no job for `idleMs` (by `clock`) is ended when the next job
 * starts or when `releaseIfIdle()` runs; the server also arms a timer for it.
 */
export class GraphJobs {
  private readonly jobs = new Map<string, GraphJob>();
  private closed = false;
  private readonly launch: (control: SharedArrayBuffer) => Worker;
  private readonly clock: () => number;
  private readonly idleMs: number;
  private worker: Worker | undefined;
  private control: Int32Array | undefined;
  private current: GraphJob | undefined;
  private finishedAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Workers started so far: a job that reuses the worker leaves it unchanged. */
  generation = 0;
  constructor(
    private readonly root: string,
    options: GraphJobsOptions = {},
  ) {
    this.launch =
      options.launch ??
      ((control) =>
        new Worker(new URL("./graph-worker-main.js", import.meta.url), {
          workerData: { control },
          stdout: true,
          stderr: true,
        }));
    this.clock = options.clock ?? Date.now;
    this.idleMs = options.idleMs ?? 10 * 60_000;
  }
  activeId() {
    return this.current && !this.current.exited ? this.current.id : null;
  }
  start(request: Omit<GraphRequest, "root">) {
    if (findProjectRoot(this.root) !== this.root)
      throw Error(
        "Graph boundary differs from the MCP launch root. Launch at the project root or initialize this directory before indexing; parent projects are never indexed implicitly.",
      );
    if (this.closed) throw Error("Graph session closed; reconnect.");
    if (this.activeId())
      throw Error(
        "A graph job is running. Read or cancel its jobId with graph_result before starting another.",
      );
    this.releaseIfIdle();
    const worker = this.worker ?? this.startWorker();
    Atomics.store(this.control!, CONTROL.cancel, 0);
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
    this.settlers.set(job, settle);
    this.current = job;
    worker.postMessage({
      kind: "request",
      id: job.id,
      request: { ...request, root: this.root },
    });
    this.jobs.set(job.id, job);
    while (this.jobs.size > agentLimits.graphJobs)
      this.jobs.delete(this.jobs.keys().next().value!);
    return job;
  }
  private readonly settlers = new WeakMap<GraphJob, () => void>();
  private finish(job: GraphJob): void {
    if (job.exited) return;
    job.exited = true;
    if (this.current === job) this.current = undefined;
    this.finishedAt = this.clock();
    this.settlers.get(job)?.();
    if (this.timer) clearTimeout(this.timer);
    if (!this.closed && this.worker) {
      this.timer = setTimeout(() => this.releaseIfIdle(), this.idleMs);
      this.timer.unref?.();
    }
  }
  private startWorker(): Worker {
    const control = new Int32Array(
      new SharedArrayBuffer(controlLength * Int32Array.BYTES_PER_ELEMENT),
    );
    const worker = this.launch(control.buffer as SharedArrayBuffer);
    this.generation++;
    this.worker = worker;
    this.control = control;
    // Only parentPort messages enter the protocol; module logging must not corrupt stdio.
    worker.stdout?.resume();
    worker.stderr?.resume();
    worker.on("message", (m: WorkerMessage) => {
      const job = this.current;
      if (!job || job.worker !== worker || m.id !== job.id) return;
      if (m.kind === "progress") {
        job.progress = m.progress!;
        for (const listener of job.listeners) listener(job.progress);
        return;
      }
      if (m.kind === "result") {
        job.view = Object.assign(Object.create(GraphView.prototype), m.view);
        if (job.state === "running") job.state = "complete";
      } else if (m.kind === "cancelled") job.state = "cancelled";
      else {
        job.error = m.error ?? m.message ?? "Graph worker failed";
        if (job.state === "running") job.state = "error";
      }
      if (m.session) job.session = m.session;
      if (m.work) job.work = m.work;
      this.finish(job);
    });
    worker.on("error", (e) => {
      const job = this.current;
      if (job && job.worker === worker && job.state === "running") {
        job.error = e.message;
        job.state = "error";
      }
    });
    worker.on("exit", (code) => {
      if (this.worker === worker) {
        this.worker = undefined;
        this.control = undefined;
      }
      const job = this.current;
      if (job && job.worker === worker) {
        if (job.state === "running") {
          job.state = "error";
          job.error ??= `Graph worker exited (${code}); restart indexing. Completion may be missing.`;
        }
        this.finish(job);
      }
    });
    return worker;
  }
  /** Ends the worker, and with it its session. */
  private async retire(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    this.worker = undefined;
    this.control = undefined;
    await worker.terminate();
  }
  /** Ends a worker that has had no job for `idleMs`, with its session. */
  releaseIfIdle(): boolean {
    if (
      this.worker &&
      !this.activeId() &&
      this.finishedAt !== undefined &&
      this.clock() - this.finishedAt >= this.idleMs
    ) {
      void this.retire();
      return true;
    }
    return false;
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
      const control = job.worker === this.worker ? this.control : undefined;
      if (control) {
        Atomics.store(control, CONTROL.cancel, 1);
        // Inside a module call there may be no checkpoint for long.
        if (Atomics.load(control, CONTROL.section) === SECTION.module)
          await this.retire();
      } else await job.worker.terminate();
      await job.done;
    }
    return job;
  }
  async close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    const job = this.current;
    if (job && !job.exited) job.state = "cancelled";
    await this.retire();
    if (job) await job.done;
    this.jobs.clear();
  }
}
