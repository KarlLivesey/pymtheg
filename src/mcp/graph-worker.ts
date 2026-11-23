// SPDX-License-Identifier: MIT
import { operationError } from "./operation-errors.js";
import { parentPort, workerData } from "node:worker_threads";
import { executeGraph, type GraphRequest } from "../graph/commands.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
import { liveChildGroups, useChildGroups } from "../backends/child-groups.js";

const { childGroups, ...request } = workerData as GraphRequest & {
  childGroups?: SharedArrayBuffer;
};
// Every child process this job starts is recorded in the server's registry
// for this job, so the server can kill it whatever this thread does.
useChildGroups(childGroups);
const controller = new AbortController();
// C-43 review: a cancel first asks the job to abort. Its signal kills the
// process groups it is waiting on (runProcess), and the toolchain route
// removes its run folder as the command unwinds. When the command has
// settled the worker answers `aborted`, and the server terminates it.
parentPort!.on("message", (message: { kind?: string }) => {
  if (message?.kind === "abort" && !controller.signal.aborted)
    controller.abort(Error("Indexing was cancelled"));
});
// The message listener must not keep a finished worker alive.
parentPort!.unref();
try {
  const response = await executeGraph(request as GraphRequest, {
    progress: (progress) =>
      parentPort!.postMessage({ kind: "progress", progress }),
    signal: controller.signal,
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
} finally {
  if (controller.signal.aborted)
    parentPort!.postMessage({
      kind: "aborted",
      live: liveChildGroups().length,
    });
}
