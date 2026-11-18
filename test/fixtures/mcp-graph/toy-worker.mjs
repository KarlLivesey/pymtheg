// The production graph worker's steps with the test-only toy registry:
// executeGraph, then the same GraphView projection and size check.
import { parentPort, workerData } from "node:worker_threads";
import { executeGraph } from "../../../dist/graph/commands.js";
import { LanguageRegistry } from "../../../dist/graph/index.js";
import { GraphView } from "../../../dist/mcp/graph-view.js";
import { agentLimits } from "../../../dist/mcp/limits.js";
import toy from "../../../dist/graph/languages/toy/index.js";
try {
  const response = await executeGraph(workerData, {
    registry: new LanguageRegistry([toy]),
    progress: (progress) => parentPort.postMessage({ kind: "progress", progress }),
  });
  const view = new GraphView(response);
  if (view.bytes() > agentLimits.graphResultBytes) throw Error("Compact result exceeds session retention");
  parentPort.postMessage({ kind: "result", view });
} catch (error) {
  parentPort.postMessage({ kind: "error", message: error instanceof Error ? error.message : String(error) });
}
