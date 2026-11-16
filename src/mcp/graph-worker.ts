// SPDX-License-Identifier: MIT
import { operationError } from "./operation-errors.js";
import { parentPort, workerData } from "node:worker_threads";
import { executeGraph, type GraphRequest } from "../graph/commands.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
try {
  const response = await executeGraph(workerData as GraphRequest, {
    progress: (progress) =>
      parentPort!.postMessage({ kind: "progress", progress }),
  });
  const view = new GraphView(response);
  if (view.bytes() > agentLimits.graphResultBytes)
    throw Error(
      "Compact result exceeds session retention. Narrow the selector, limit or depth; no complete answer is retained.",
    );
  parentPort!.postMessage({ kind: "result", view });
} catch (error) {
  parentPort!.postMessage({
    kind: "error",
    error: operationError(error, "GRAPH_REQUEST_FAILED"),
  });
}
