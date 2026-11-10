import { Worker } from "node:worker_threads";
import type { Snapshot } from "../language/project.js";
import type { ProjectIR } from "../semantic/core.js";
import { emptyReport, type Report } from "../reporting/report.js";
import { finding, assertNever } from "../shared/identity.js";
import type { WorkerMessage } from "../shared/protocol.js";
export async function analyseInWorker(options: {
  file: string;
  signal: AbortSignal;
  onProgress?: (message: WorkerMessage) => void;
  workerURL?: URL;
  workerData?: Record<string, unknown>;
}): Promise<{
  snapshot: Snapshot;
  report: Report;
  ir: ProjectIR | null;
  sourceCatalogue?: import("../shared/source-contracts.js").SourceCatalogue;
}> {
  let sourceCatalogue:
    | import("../shared/source-contracts.js").SourceCatalogue
    | undefined;
  let snapshot: Snapshot = {
      id: "unavailable",
      sources: [],
      diagnostics: [],
      measurements: { bytes: 0, files: 0, tokens: 0, parses: 0 },
    },
    report = emptyReport("check"),
    ir: ProjectIR | null = null;
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(
      options.workerURL ?? new URL("./worker.js", import.meta.url),
      {
        workerData: { ...options.workerData, file: options.file },
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      },
    );
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", abort);
      void worker.terminate().then(() => resolve(), reject);
    };
    const fail = (message: string): void => {
      report.session.state = "Failed";
      report.diagnostics.push(
        finding("I001", message, { file: options.file, start: 0, end: 0 }),
      );
      finish();
    };
    const abort = (): void => {
      report.session.state = "Cancelled";
      report.snapshot = {
        id: snapshot.id,
        files: snapshot.sources.map((s) => ({
          file: s.file,
          hash: s.hash,
          text: s.text,
        })),
      };
      finish();
    };
    worker.on("message", (message: WorkerMessage) => {
      if (settled) return;
      switch (message.kind) {
        case "snapshot":
          snapshot = message.value;
          break;
        case "partial":
          report = message.value;
          break;
        case "done":
          sourceCatalogue = message.value.sourceCatalogue;
          ir = message.value.ir;
          report = message.value.report;
          finish();
          break;
        case "failed":
          fail(message.value);
          break;
        default:
          assertNever(message);
      }
      options.onProgress?.(message);
    });
    worker.on("error", (e) => fail(String(e)));
    worker.on("exit", (code) => {
      if (!settled) fail(`Analysis worker exited ${code}`);
    });
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
  });
  return {
    snapshot,
    report,
    ir,
    ...(sourceCatalogue ? { sourceCatalogue } : {}),
  };
}
