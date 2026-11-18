// SPDX-License-Identifier: MIT
import { Worker } from "node:worker_threads";
import type { rustPhases } from "./index.js";

type Phases = typeof rustPhases;
type Phase = keyof Phases;
export type PhaseRequest<P extends Phase = Phase> = {
  [K in P]: { phase: K; context: Parameters<Phases[K]>[0] };
}[P];
export type PhaseMessage =
  | { kind: "done"; result: ReturnType<Phases[Phase]> }
  | { kind: "error"; message: string };

/** Own the CPU worker until it has exited, including on abort. */
export async function runRustPhase<P extends Phase>(
  request: PhaseRequest<P>,
  signal: AbortSignal,
): Promise<ReturnType<Phases[P]>> {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("./phase-worker.js", import.meta.url),
    { workerData: request },
  );
  let abort!: () => void;
  try {
    const result = await new Promise<ReturnType<Phases[P]>>((resolve, reject) => {
      abort = () => reject(signal.reason);
      worker.on("error", reject);
      worker.on("exit", (code) =>
        reject(Error(`Rust ${request.phase} worker exited (${code})`)),
      );
      worker.on("message", (message: PhaseMessage) => {
        if (message.kind === "done")
          resolve(message.result as ReturnType<Phases[P]>);
        else reject(Error(message.message));
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    await worker.terminate();
  }
}
