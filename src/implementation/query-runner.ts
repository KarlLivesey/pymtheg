// SPDX-License-Identifier: MIT
import { declarationTypeInventorySchema } from "../studio/declaration-type-protocol.js";
import type { DeclarationTypeInput } from "../studio/declaration-type-inventory.js";
import { Worker } from "node:worker_threads";
import {
  implementationComparisonSchema,
  type ImplementationComparisonQuery,
} from "./comparison-protocol.js";
import { graphPageSchema } from "./protocol.js";
import type {
  readImplementationDocuments,
  implementationPage,
} from "./workspace.js";
export interface QueryWorkingSet {
  phase: string;
  decodedGraphs: number;
  workingNodes: number;
  workingEdges: number;
  heapUsedBytes: number;
}
interface QueryExecution {
  workerURL?: URL;
  onReady?: () => void;
  onWorkingSet?: (sample: QueryWorkingSet) => void;
  /** A test may lower the production 512 MiB cap; it cannot raise it. */
  memoryLimitMb?: number;
}
type Snapshot = NonNullable<
  Awaited<ReturnType<typeof readImplementationDocuments>>
> & {
  designAttention?: import("./design-attention.js").DesignAttention | undefined;
};
export async function queryImplementation(
  plan: Snapshot,
  code: Snapshot | null,
  options: Parameters<typeof implementationPage>[2],
  activeRevision: string | null,
  signal: AbortSignal,
  execution: QueryExecution = {},
) {
  return runQuery(
    { plan, code, options },
    activeRevision,
    signal,
    graphPageSchema,
    execution,
  );
}
export function queryImplementationComparison(
  plan: Snapshot,
  code: Snapshot | null,
  baseline: Snapshot | null,
  options: ImplementationComparisonQuery,
  baselineUnavailable: string | null,
  activeRevision: string | null,
  signal: AbortSignal,
  execution: QueryExecution = {},
) {
  return runQuery(
    { kind: "comparison", plan, code, baseline, options, baselineUnavailable },
    activeRevision,
    signal,
    implementationComparisonSchema,
    execution,
  );
}
export function queryDeclarationTypes(
  root: string,
  inputs: DeclarationTypeInput[],
  warnings: string[],
  signal: AbortSignal,
  execution: QueryExecution = {},
) {
  return runQuery(
    { kind: "type-inventory", root, inputs, warnings },
    null,
    signal,
    declarationTypeInventorySchema,
    execution,
  );
}
function runQuery<T>(
  data: object,
  activeRevision: string | null,
  signal: AbortSignal,
  schema: { parse(value: unknown): T },
  execution: QueryExecution,
): Promise<T> {
  signal.throwIfAborted();
  const memoryLimitMb = execution.memoryLimitMb ?? 512;
  if (
    !Number.isInteger(memoryLimitMb) ||
    memoryLimitMb < 64 ||
    memoryLimitMb > 512
  )
    throw Error("Graph query memory cap must be between 64 and 512 MiB");
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(
      execution.workerURL ?? new URL("./query-worker.js", import.meta.url),
      {
        workerData: { ...data, measureWorkingSet: !!execution.onWorkingSet },
        resourceLimits: { maxOldGenerationSizeMb: memoryLimitMb },
      },
    );
    let finished = false;
    const done = (error: Error | null, value?: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      void worker
        .terminate()
        .then(() => {
          if (error) reject(error);
          else {
            try {
              resolve(
                schema.parse({
                  ...(value as object),
                  activeRevision,
                }),
              );
            } catch (e) {
              reject(e);
            }
          }
        })
        .catch(reject);
    };
    const abort = () => done(Error("Implementation graph query cancelled"));
    worker.on("message", (message) => {
      if (message.kind === "working-set") {
        execution.onWorkingSet?.(message.sample);
        return;
      }
      if (message.kind === "ready") {
        execution.onReady?.();
        return;
      }
      done(message.error ? Error(message.error) : null, message.result);
    });
    worker.on("error", (error) => done(error));
    worker.on("exit", (code) => {
      if (!finished) done(Error("Implementation graph worker exited " + code));
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
