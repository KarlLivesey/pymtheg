// SPDX-License-Identifier: MIT
import "../shared/quiet-warnings.js";
import { parentPort, workerData } from "node:worker_threads";
import { explore, sample } from "./explore.js";
import type { ExploreRequest } from "./explore-runner.js";
const data = workerData as ExploreRequest;
// Wait for the coordinator's acknowledgement: onReady may cancel synchronously.
parentPort!.once("message", () => {
  const result =
    data.method === "exhaustive"
      ? explore(data.model, data.options, data.ir)
      : sample(data.model, data.options, data.ir);
  parentPort!.postMessage({ type: "result", result });
  parentPort!.close();
});
parentPort!.postMessage({ type: "ready" });
