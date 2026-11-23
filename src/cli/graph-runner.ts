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
// Child processes the worker starts (a toolchain, a helper) are recorded in
// a table this thread owns (child-groups.ts). A terminated worker cannot end
// them, so this thread kills every group still recorded once the worker has
// stopped, when it exits for any reason, and when this process exits.
import { Worker } from "node:worker_threads";
import { childGroupTable, killChildGroups } from "../backends/child-groups.js";
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
  const children = childGroupTable();
  const onProcessExit = () => killChildGroups(children);
  process.on("exit", onProcessExit);
  return new Promise<GraphResponse>((resolve, reject) => {
    const worker = new Worker(
      options.workerURL ?? new URL("./graph-worker-main.js", import.meta.url),
      { workerData: { ...options.workerData, request, control, children } },
    );
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
      if (Atomics.load(shared, CONTROL.section) === SECTION.module) {
        // The run is answered on the worker's exit, after its child
        // processes are killed, so nothing it started outlives the answer.
        terminated = true;
        void worker.terminate();
      } else worker.postMessage({ kind: "cancel" });
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
      killChildGroups(children);
      process.off("exit", onProcessExit);
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
