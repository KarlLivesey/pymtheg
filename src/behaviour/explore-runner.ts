// SPDX-License-Identifier: MIT
import { Worker } from "node:worker_threads";
import type { ProjectIR } from "../semantic/core.js";
import type { GeneratedModel } from "./model.js";
import {
  unresolved,
  type ExploreOptions,
  type SampleOptions,
  type ExploreResult,
} from "./explore.js";
export type ExploreRequest = { model: GeneratedModel; ir?: ProjectIR } & (
  | { method: "exhaustive"; options?: ExploreOptions }
  | { method: "sample"; options: SampleOptions }
);
export interface ExploreClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface RunExploreOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  clock?: ExploreClock;
  onReady?: () => void;
}
const realClock: ExploreClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export interface ExploreRunResult {
  result: ExploreResult;
  elapsedMs: number;
}
/** Owns the real CPU worker through termination, including cancellation at readiness. */
export async function runExplore(
  request: ExploreRequest,
  options: RunExploreOptions = {},
): Promise<ExploreRunResult> {
  const clock = options.clock ?? realClock,
    start = clock.now();
  const failure = (completion: ExploreResult["completion"], error?: string) =>
    unresolved(request.model, request.method, completion, error);
  if (options.signal?.aborted)
    return { result: failure("cancelled"), elapsedMs: clock.now() - start };
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    return {
      result: failure("engine_error", "timeoutMs must be finite and >= 0"),
      elapsedMs: clock.now() - start,
    };
  let worker: Worker;
  try {
    worker = new Worker(new URL("./explore-worker.js", import.meta.url), {
      workerData: request,
    });
  } catch (error) {
    return {
      result: failure("engine_error", String(error)),
      elapsedMs: clock.now() - start,
    };
  }
  let timer: unknown;
  let cancel: () => void = () => {};
  try {
    const result = await new Promise<ExploreResult>((resolve) => {
      let settled = false;
      const finish = (value: ExploreResult) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      cancel = () => finish(failure("cancelled"));
      worker.on("error", (error) =>
        finish(failure("engine_error", String(error))),
      );
      worker.on("exit", (code) =>
        finish(
          failure("engine_error", `Worker exited without result (${code})`),
        ),
      );
      worker.on("message", (message) => {
        if (settled) return;
        if (message.type === "ready") {
          try {
            options.onReady?.();
          } catch (error) {
            finish(failure("engine_error", String(error)));
          }
          if (!settled) worker.postMessage({ type: "start" });
        } else if (message.type === "result")
          finish(message.result as ExploreResult);
        else finish(failure("engine_error", "Unknown worker message"));
      });
      options.signal?.addEventListener("abort", cancel, { once: true });
      timer = clock.setTimeout(() => finish(failure("timed_out")), timeoutMs);
      if (options.signal?.aborted) cancel();
    });
    return { result, elapsedMs: clock.now() - start };
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    clock.clearTimeout(timer);
    await worker.terminate();
  }
}
