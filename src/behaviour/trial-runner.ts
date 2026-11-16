// SPDX-License-Identifier: MIT
import { Worker } from "node:worker_threads";
import type { ProjectIR } from "../semantic/core.js";
import { trialSchema, type TrialResult } from "./trial.js";
export function tryFlowInWorker(
  ir: ProjectIR,
  entry: string,
  inputs: Record<string, unknown>,
  signal: AbortSignal,
): Promise<TrialResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./trial-worker.js", import.meta.url), {
      workerData: { ir, entry, inputs },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let done = false;
    const finish = (error: Error | null, value?: TrialResult) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", abort);
      void worker
        .terminate()
        .then(() => (error ? reject(error) : resolve(value!)));
    };
    const abort = () => finish(Error("Example execution cancelled"));
    worker.on("message", (value) => {
      try {
        finish(null, trialSchema.parse(value));
      } catch (error) {
        finish(Error("Invalid example result: " + String(error)));
      }
    });
    worker.on("error", (error) => finish(error));
    worker.on("exit", (code) => {
      if (!done) finish(Error("Example worker exited " + code));
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
