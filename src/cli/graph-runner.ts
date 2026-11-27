// SPDX-License-Identifier: MIT
// C-50: the CLI's coordinator for one graph command. The command runs in a
// worker thread (graph-worker.ts, entry graph-worker-main.ts); this thread
// relays progress and handles the abort signal. A language module's analysis
// can be one long synchronous call: on the main thread it starved the
// SIGINT/SIGTERM handler, so the run could only be stopped by SIGKILL.
//
// On abort the coordinator sets the shared cancel flag and reads the
// worker's section. Inside a module's synchronous code it terminates the
// worker at once; the store is left as a killed CLI run leaves it, and the
// next index takes over the unfinished-run mark and repairs it. Anywhere
// else it sends `cancel`, and the command stops at its next checkpoint as a
// cancelled run did before (an asynchronous module call, such as the Rust
// module's phase worker, receives the abort signal).
//
// Child process groups the worker starts (a toolchain, a helper) are
// recorded in a registry this thread owns (C-54). A terminated worker cannot
// end them, so this thread kills every group still recorded when the worker
// exits, before it answers a terminated run; the registry is also killed
// when this process exits.
import { Worker } from "node:worker_threads";
import {
  jobChildGroups,
  killChildGroups,
  releaseJobChildGroups,
} from "../backends/child-groups.js";
import type {
  GraphProgress,
  GraphRequest,
  GraphResponse,
} from "../graph/commands.js";
import {
  CONTROL,
  controlLength,
  SECTION,
  type GraphWorkerMessage,
} from "./graph-worker.js";

export interface GraphRunOptions {
  signal: AbortSignal;
  progress?: ((progress: GraphProgress) => void) | undefined;
  /** Tests run the coordinator with their own worker (same protocol). */
  workerURL?: URL;
  workerData?: Record<string, unknown>;
  /** Tests are handed the worker, so they can end it whatever they found. */
  onWorker?: (worker: Worker) => void;
}

/** The error an aborted run rejects with: the one `signal.throwIfAborted()` gives. */
function abortError(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }
  return new DOMException("This operation was aborted", "AbortError");
}

export function runGraphInWorker(
  request: GraphRequest,
  options: GraphRunOptions,
): Promise<GraphResponse> {
  const { signal } = options;
  if (signal.aborted) return Promise.reject(abortError(signal));
  const control = new SharedArrayBuffer(
    controlLength * Int32Array.BYTES_PER_ELEMENT,
  );
  const shared = new Int32Array(control);
  const childGroups = jobChildGroups();
  return new Promise<GraphResponse>((resolve, reject) => {
    const worker = new Worker(
      options.workerURL ?? new URL("./graph-worker-main.js", import.meta.url),
      { workerData: { ...options.workerData, request, control, childGroups } },
    );
    options.onWorker?.(worker);
    let settled = false;
    let terminated = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      outcome();
    };
    const onAbort = () => {
      Atomics.store(shared, CONTROL.cancel, 1);
      // Wakes a worker waiting on the flag (tests do), as the MCP server does.
      Atomics.notify(shared, CONTROL.cancel);
      if (Atomics.load(shared, CONTROL.section) === SECTION.module) {
        // Answered on the worker's exit, after its child processes are
        // killed, so nothing it started outlives the answer.
        terminated = true;
        void worker.terminate();
      } else {
        // As C-48's server does: the run's processes are killed at once,
        // and the worker is asked to abort. A module awaiting one of them
        // then goes on, and the command stops at its next checkpoint.
        worker.postMessage({ kind: "cancel" });
        killChildGroups(childGroups);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.on("message", (message: GraphWorkerMessage) => {
      if (message.kind === "progress") options.progress?.(message.progress);
      else if (message.kind === "result")
        finish(() => resolve(message.response));
      else
        finish(() =>
          reject(
            message.cancelled ? abortError(signal) : new Error(message.message),
          ),
        );
    });
    worker.on("error", (error) => finish(() => reject(error)));
    worker.on("exit", (code) => {
      releaseJobChildGroups(childGroups);
      finish(() =>
        reject(
          terminated
            ? abortError(signal)
            : new Error(`The graph worker exited (${code}) before answering`),
        ),
      );
    });
  });
}
