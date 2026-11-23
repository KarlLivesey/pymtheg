// SPDX-License-Identifier: MIT
import { agentLimits } from "./limits.js";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { findProjectRoot } from "../storage/local.js";
import type { LinkView } from "./links-view.js";
import {
  jobChildGroups,
  killChildGroups,
  releaseJobChildGroups,
} from "../backends/child-groups.js";
export interface LinkJob {
  id: string;
  state: "running" | "complete" | "error" | "cancelled";
  exited: boolean;
  worker: Worker;
  done: Promise<void>;
  progress: unknown;
  view?: LinkView;
  error?: { code: string; message: string; action: string };
  listeners: Set<(value: unknown) => void>;
  /** The process groups the job's worker started (C-54), owned by this server. */
  childGroups: SharedArrayBuffer;
}
export class LinkJobs {
  private jobs = new Map<string, LinkJob>();
  private closed = false;
  constructor(
    private root: string,
    private launch = (data: unknown) =>
      new Worker(new URL("./links-worker.js", import.meta.url), {
        workerData: data,
        stdout: true,
        stderr: true,
      }),
  ) {}
  start(action: string, input: Record<string, unknown>) {
    if (this.closed)
      throw Object.assign(Error("Link session closed; reconnect."), {
        code: "session-closed",
      });
    if (this.activeId())
      throw Object.assign(
        Error(
          "A requirement-link job is running. Read or cancel it with link_result before starting another.",
        ),
        { code: "busy" },
      );
    if (findProjectRoot(this.root) !== this.root)
      throw Error(
        "Link boundary differs from the MCP launch root; launch at the project root or initialize this directory. Parent projects are never used implicitly.",
      );
    // C-54: a link job can index (the Go route runs `go`), so its worker
    // records its children in a registry this server kills.
    const childGroups = jobChildGroups();
    const worker = this.launch({
      action,
      input: { ...input, root: this.root },
      childGroups,
    });
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settle!: () => void;
    const job: LinkJob = {
      id: randomUUID(),
      state: "running",
      exited: false,
      worker,
      done: new Promise((r) => {
        settle = r;
      }),
      progress: null,
      listeners: new Set(),
      childGroups,
    };
    worker.on("message", (m) => {
      if (job.state !== "running") return;
      if (m.kind === "progress") {
        job.progress = m;
        for (const f of job.listeners) f(m);
      } else if (m.kind === "result") {
        job.view = m.view;
        job.state = "complete";
      } else {
        job.error = m.error;
        job.state = "error";
      }
    });
    worker.on("error", (e) => {
      job.state = "error";
      job.error = {
        code: "worker-error",
        message: e.message,
        action: "Inspect list/history before retrying a mutation.",
      };
    });
    worker.on("exit", (code) => {
      job.exited = true;
      if (
        job.state === "running" ||
        (code !== 0 && job.state !== "cancelled")
      ) {
        job.state = "error";
        job.error ??= {
          code: "worker-exit",
          message: `Link worker exited (${code}). A mutation may have committed.`,
          action: "Inspect list/history, then explicitly retry if needed.",
        };
      }
      // Whatever the worker left running, this server kills.
      releaseJobChildGroups(childGroups);
      settle();
    });
    this.jobs.set(job.id, job);
    while (this.jobs.size > agentLimits.linkJobs)
      this.jobs.delete(this.jobs.keys().next().value!);
    return job;
  }
  activeId() {
    return [...this.jobs.values()].find((j) => !j.exited)?.id ?? null;
  }
  get(id: string) {
    const job = this.jobs.get(id);
    if (!job)
      throw Error(
        "Unknown or expired link job; results last for three jobs in this connection. Start a fresh read; reconcile a mutation with list/history.",
      );
    return job;
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (!job.exited) {
      job.state = "cancelled";
      // The link library takes no abort signal: the worker is terminated,
      // and the job's process groups are killed by this server.
      await job.worker.terminate();
      await job.done;
    }
    killChildGroups(job.childGroups);
    return job;
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.jobs.keys()].map((id) => this.cancel(id)));
    this.jobs.clear();
  }
}
