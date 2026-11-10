import { z } from "zod";
import { documentSchema } from "./schema.js";
import { maxStoredDocuments, documentCountsWithinLimits } from "./limits.js";
import { historySchema } from "./history.js";
import { Worker } from "node:worker_threads";
import {
  indexSchema,
  type ArchitectureDocument,
  type ArchitectureIndex,
} from "./model.js";
export function indexInWorker(
  documents: ArchitectureDocument[],
  signal: AbortSignal,
) {
  return runArchitectureWorker(documents, signal, indexSchema);
}
export function prepareAndIndexInWorker(
  current: ArchitectureDocument[],
  next: ArchitectureDocument[],
  signal: AbortSignal,
) {
  return runArchitectureWorker(
    { kind: "prepare", current, next },
    signal,
    z
      .object({
        documents: z
          .array(documentSchema)
          .min(1)
          .max(maxStoredDocuments)
          .refine(documentCountsWithinLimits),
        index: indexSchema,
      })
      .strict(),
  );
}
export function historyInWorker(archive: unknown, signal: AbortSignal) {
  return runArchitectureWorker({ archive }, signal, historySchema);
}
function runArchitectureWorker<T>(
  data: unknown,
  signal: AbortSignal,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: data,
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let finished = false;
    const done = (error: Error | null, value?: T) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      void worker
        .terminate()
        .then(() => (error ? reject(error) : resolve(value!)));
    };
    const abort = () => done(Error("Architecture import cancelled"));
    worker.on("message", (message) => {
      if (message?.kind === "indexed") {
        try {
          done(null, schema.parse(message.value));
        } catch (error) {
          done(Error("Invalid architecture worker output: " + String(error)));
        }
      } else done(Error(message?.message ?? "Architecture indexing failed"));
    });
    worker.on("error", (error) => done(error));
    worker.on("exit", (code) => {
      if (!finished) done(Error("Architecture worker exited " + code));
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
