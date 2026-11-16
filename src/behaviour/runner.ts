// SPDX-License-Identifier: MIT
import { Worker } from "node:worker_threads";
import type { ProjectIR } from "../semantic/core.js";
import type { Preflight } from "./model.js";
export async function lowerInWorker(
  ir: ProjectIR,
  entry: string,
  scope: unknown,
  signal: AbortSignal,
): Promise<Preflight> {
  return await new Promise((resolve) => {
    const worker = new Worker(new URL("./lower-worker.js", import.meta.url), {
      workerData: { ir, entry, scope },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (result: Preflight): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      void worker.terminate().then(() => resolve(result));
    };
    const abort = (): void =>
      finish({ kind: "incomplete", reasons: ["Lowering cancelled"] });
    worker.on("message", (result: Preflight) => finish(result));
    worker.on("error", (e) =>
      finish({ kind: "incomplete", reasons: [String(e)] }),
    );
    worker.on("exit", (code) => {
      if (!settled)
        finish({
          kind: "incomplete",
          reasons: [`Lowering worker exited ${code}`],
        });
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
