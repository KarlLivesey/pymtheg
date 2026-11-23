// SPDX-License-Identifier: MIT
import type { operationError } from "./operation-errors.js";
import { findProjectRoot } from "../storage/local.js";
import { Worker } from "node:worker_threads";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { GraphRequest, GraphProgress } from "../graph/commands.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
import { CONTROL, SECTION, controlLength } from "./graph-control.js";
import {
  jobChildGroups,
  killChildGroups,
  liveChildGroups,
  releaseJobChildGroups,
} from "../backends/child-groups.js";
import type { ProcessClock } from "../backends/process.js";

/**
 * C-54: how long a cancel waits for the worker's answer while a child
 * process group it started is live. The answer normally comes at once (the
 * worker is awaiting the child, so its event loop is free); the bound only
 * keeps a worker that will not answer from holding the cancel for ever. The
 * groups are killed either way.
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
  /** The job has finished: its worker answered, or exited. */
  exited: boolean;
  worker: Worker;
  done: Promise<void>;
  view?: GraphView;
  error?: string | ReturnType<typeof operationError>;
  listeners: Set<(p: GraphProgress) => void>;
  /** The worker's session counters after the job (C-48). */
  session?: { loads: number; runs: number; dropped: number };
  /** The worker's live heap after the job, after a full collection. */
  memory?: { liveBytes: number; heapBytes: number };
  /** The server ended the worker when the job finished: it kept more than its bound. */
  workerEnded?: boolean;
  /** The job's work counters and stage times (observations). */
  work?: { counts: Record<string, number>; stages: Record<string, unknown> };
  /** What the worker answered, if it answered (not set when it exited). */
  answer?: "result" | "cancelled" | "error";
  /** For a cancelled answer: the checkpoint (1-based, since the worker started) that acted on the cancel. */
  abortedAt?: number;
}
export interface GraphJobsOptions {
  /**
   * Starts a worker that shares `control` and records the process groups
   * it starts in `childGroups` (C-54; tests supply their own).
   */
  launch?: (
    control: SharedArrayBuffer,
    childGroups: SharedArrayBuffer,
  ) => Worker;
  /** The clock and bound of a cancel's grace (C-54; tests control them). */
  cancelClock?: ProcessClock;
  graceMs?: number;
  /** The clock idleness is measured with (tests control it). */
  clock?: () => number;
  /** A worker with no job for this long is ended, with its session. */
  idleMs?: number;
  /**
   * A worker whose live heap after a job exceeds this many bytes is ended
   * when the job finishes, with its session: the next job starts a new one.
   */
  restingBytes?: number;
  /**
   * The code a new worker would run (the package version and build). A
   * worker started under another value is ended before the next job, so an
   * upgrade on disk is never served by old module code. Tests supply one.
   */
  codeVersion?: () => string;
}
/**
 * The package version and a build id: the size and modification time of
 * the worker's own compiled entry. An upgrade or a rebuild changes it.
 */
export function installedCodeVersion(): string {
  const entry = fileURLToPath(new URL("./graph-worker.js", import.meta.url));
  const manifest = fileURLToPath(
    new URL("../../package.json", import.meta.url),
  );
  const read = (path: string) => {
    try {
      const info = statSync(path);
      return `${info.size}:${info.mtimeMs}`;
    } catch {
      return "missing";
    }
  };
  let version = "unknown";
  try {
    version = String(
      (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown })
        .version,
    );
  } catch {
    // No manifest: the build id alone.
  }
  return `${version}\u0000${read(entry)}`;
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
  memory?: GraphJob["memory"];
  abortedAt?: number;
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
/**
 * C-48: the live heap a worker may keep after a job (measured after a full
 * collection). On restic, cli/cli, Hono and helix it kept 77 to 132 MiB
 * after every job; a TypeScript program kept alive by a cache (C-40)
 * would be gigabytes. Ending the worker affects no answer, only the next
 * job's start-up.
 */
export const defaultRestingBytes = 512 * 1024 * 1024;
export class GraphJobs {
  private readonly jobs = new Map<string, GraphJob>();
  private closed = false;
  private readonly launch: (
    control: SharedArrayBuffer,
    childGroups: SharedArrayBuffer,
  ) => Worker;
  private readonly cancelClock: ProcessClock;
  private readonly graceMs: number;
  /** The process groups the current worker started, owned by this server. */
  private childGroups: SharedArrayBuffer | undefined;
  private readonly clock: () => number;
  private readonly idleMs: number;
  private readonly restingBytes: number;
  private readonly codeVersion: () => string;
  /** The code version the current worker was started under. */
  private workerCode: string | undefined;
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
      ((control, childGroups) =>
        new Worker(new URL("./graph-worker-main.js", import.meta.url), {
          workerData: { control, childGroups },
          stdout: true,
          stderr: true,
        }));
    this.clock = options.clock ?? Date.now;
    this.idleMs = options.idleMs ?? 10 * 60_000;
    this.restingBytes = options.restingBytes ?? defaultRestingBytes;
    this.codeVersion = options.codeVersion ?? installedCodeVersion;
    this.cancelClock = options.cancelClock ?? systemClock;
    this.graceMs = options.graceMs ?? CANCEL_GRACE_MS;
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
    // A worker started under other code (an upgrade or rebuild on disk) is
    // ended; the job starts one with the code installed now.
    const code = this.codeVersion();
    if (this.worker && this.workerCode !== code) void this.retire();
    const worker = this.worker ?? this.startWorker(code);
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
  private startWorker(code: string): Worker {
    const control = new Int32Array(
      new SharedArrayBuffer(controlLength * Int32Array.BYTES_PER_ELEMENT),
    );
    // The worker's own registry; a server that exits kills it (C-54).
    const childGroups = jobChildGroups();
    const worker = this.launch(
      control.buffer as SharedArrayBuffer,
      childGroups,
    );
    this.childGroups = childGroups;
    this.generation++;
    this.worker = worker;
    this.workerCode = code;
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
      job.answer =
        m.kind === "result"
          ? "result"
          : m.kind === "cancelled"
            ? "cancelled"
            : "error";
      if (m.abortedAt !== undefined) job.abortedAt = m.abortedAt;
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
      if (m.memory) job.memory = m.memory;
      // A worker that keeps more than its bound between jobs is ended now,
      // not when it has been idle: only the next job's start-up is lost.
      if (m.memory && m.memory.liveBytes > this.restingBytes) {
        job.workerEnded = true;
        void this.retire();
      }
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
      // Whatever the worker left running, this server kills (C-54).
      releaseJobChildGroups(childGroups);
      if (this.worker === worker) {
        this.worker = undefined;
        this.control = undefined;
        this.childGroups = undefined;
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
      const groups = job.worker === this.worker ? this.childGroups : undefined;
      if (control) {
        Atomics.store(control, CONTROL.cancel, 1);
        // Wakes a worker waiting on the flag (tests do).
        Atomics.notify(control, CONTROL.cancel);
        // C-54: the job's children are killed at once, by this server, and
        // the worker is asked to abort through its signal, which unwinds
        // the command and lets the toolchain route remove its folder.
        const live = groups ? liveChildGroups(groups).length : 0;
        const section = Atomics.load(control, CONTROL.section);
        job.worker.postMessage({ kind: "abort" });
        if (groups) killChildGroups(groups);
        if (live || section === SECTION.awaiting) {
          // The worker awaits its children, or a promise a module returned:
          // its event loop is free, the abort reaches a module that honours
          // the signal, and it answers. A worker that does not is ended
          // when the grace ends.
          let timer: unknown;
          await Promise.race([
            job.done,
            new Promise<void>((resolve) => {
              timer = this.cancelClock.schedule(resolve, this.graceMs);
            }),
          ]);
          this.cancelClock.cancel(timer);
          if (!job.exited) await this.retire();
        } else if (section === SECTION.module)
          // Inside a module call there may be no checkpoint for long.
          await this.retire();
      } else await job.worker.terminate();
      await job.done;
      if (groups) killChildGroups(groups);
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
