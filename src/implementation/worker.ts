import { parentPort, workerData } from "node:worker_threads";
import { observeTypescript } from "./typescript.js";
try {
  parentPort!.postMessage({
    graph: observeTypescript(
      workerData.files,
      workerData.version,
      workerData.options,
    ),
  });
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : String(error),
  });
}
