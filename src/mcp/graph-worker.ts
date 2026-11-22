// SPDX-License-Identifier: MIT
/**
 * C-48: the MCP server's graph worker. One worker lives for as long as the
 * server keeps it (see GraphJobs), runs one graph request at a time, and
 * keeps an IndexSession between requests: the language modules are loaded
 * once, and module state proved valid is reused (src/graph/session.ts).
 *
 * Cancellation uses memory shared with the parent (`workerData.control`):
 * a cancel flag, the section the worker is in, and a count of checkpoints.
 * A checkpoint is each point where the graph command checks its abort
 * signal: before each store call, before each language module call and at
 * each captured file. At a checkpoint the worker counts it and, if the flag
 * is set, aborts the request and answers `cancelled`; it then stays alive
 * with its session. While it is inside a language module's call (section
 * 1) it may pass no checkpoint for long, so the parent terminates it there,
 * as before C-48, and the session ends with it.
 */
import { operationError } from "./operation-errors.js";
import { parentPort, workerData } from "node:worker_threads";
import { executeGraph, type GraphRequest } from "../graph/commands.js";
import { IndexSession } from "../graph/session.js";
import type { LanguageRegistry } from "../graph/registry.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
import { graphWork, resetGraphWork } from "../graph/work.js";
import { CONTROL } from "./graph-control.js";

export interface GraphWorkerOptions {
  /** Tests run the worker with their own modules. */
  registry?: LanguageRegistry;
}
/** A request from the parent. */
export interface GraphWorkerMessage {
  kind: "request";
  id: string;
  request: GraphRequest;
}

class Cancelled extends Error {
  constructor() {
    super("Graph request cancelled");
  }
}

export function serveGraphRequests(options: GraphWorkerOptions = {}): void {
  const control = new Int32Array(
    (workerData as { control: SharedArrayBuffer }).control,
  );
  const session = new IndexSession(
    options.registry ? { registry: options.registry } : {},
  );
  let running = false;
  parentPort!.on("message", (message: GraphWorkerMessage) => {
    if (message.kind !== "request" || running) return;
    running = true;
    void run(message.id, message.request).finally(() => {
      running = false;
    });
  });
  async function run(id: string, request: GraphRequest): Promise<void> {
    // The work counters of this request alone (C-22 observations).
    resetGraphWork();
    const controller = new AbortController();
    const signal = controller.signal;
    const check = signal.throwIfAborted.bind(signal);
    // Every abort check of the command is a checkpoint.
    signal.throwIfAborted = () => {
      Atomics.add(control, CONTROL.checkpoints, 1);
      if (Atomics.load(control, CONTROL.cancel) === 1 && !signal.aborted)
        controller.abort(new Cancelled());
      check();
    };
    try {
      const response = await executeGraph(request, {
        signal,
        session,
        progress: (progress) =>
          parentPort!.postMessage({ kind: "progress", id, progress }),
        onModuleCall: (inside) =>
          Atomics.store(control, CONTROL.section, inside ? 1 : 0),
      });
      const view = new GraphView(response);
      if (view.bytes() > agentLimits.graphResultBytes)
        throw Error(
          "Compact result exceeds session retention. Narrow the selector, limit or depth; no complete answer is retained.",
        );
      parentPort!.postMessage({
        kind: "result",
        id,
        view,
        session: { ...session.counts },
        work: { counts: graphWork.counts, stages: graphWork.stages },
      });
    } catch (error) {
      if (signal.aborted && Object.is(error, signal.reason))
        parentPort!.postMessage({ kind: "cancelled", id });
      else
        parentPort!.postMessage({
          kind: "error",
          id,
          error: operationError(error, "GRAPH_REQUEST_FAILED"),
        });
    } finally {
      Atomics.store(control, CONTROL.section, 0);
    }
  }
  parentPort!.postMessage({ kind: "ready" });
}
