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
 * 1), or in a synchronous stretch the module marks after an await
 * (`synchronousStretch`, src/graph/sections.ts), it may pass no checkpoint
 * for long, so the parent terminates it there, as before C-48, and the
 * session ends with it, unless a toolchain process group is live: then the
 * cancel takes the grace path (graph-jobs.ts `cancel`).
 */
import { operationError } from "./operation-errors.js";
import { parentPort, workerData } from "node:worker_threads";
import { executeGraph, type GraphRequest } from "../graph/commands.js";
import { IndexSession } from "../graph/session.js";
import type { LanguageRegistry } from "../graph/registry.js";
import { GraphView } from "./graph-view.js";
import { agentLimits } from "./limits.js";
import { graphWork, resetGraphWork } from "../graph/work.js";
import { getHeapStatistics, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { CONTROL, SECTION } from "./graph-control.js";
import { useChildGroups } from "../backends/child-groups.js";

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

/**
 * A full collection, then this worker's live heap in bytes (V8's count of
 * bytes in use) and the heap it holds from the system. A size, not a time.
 */
function resting(): { liveBytes: number; heapBytes: number } {
  collect();
  const heap = getHeapStatistics();
  return {
    liveBytes: heap.used_heap_size + heap.external_memory,
    heapBytes: heap.total_heap_size,
  };
}
let collector: (() => void) | undefined;
function collect(): void {
  if (!collector) {
    // The worker runs without --expose-gc; this makes the collector
    // available to a context created after the flag is set.
    setFlagsFromString("--expose-gc");
    collector = runInNewContext("gc") as () => void;
  }
  collector();
}

export function serveGraphRequests(options: GraphWorkerOptions = {}): void {
  const data = workerData as {
    control: SharedArrayBuffer;
    childGroups?: SharedArrayBuffer;
  };
  const control = new Int32Array(data.control);
  // C-54: every child process this worker starts is recorded in the
  // server's registry for it, so the server can kill it whatever this
  // thread does.
  useChildGroups(data.childGroups);
  // The running request's controller: a cancel that finds the worker
  // awaiting a child (its event loop free) aborts through it, so
  // runProcess kills the process groups it waits on and the command
  // unwinds; the worker answers `cancelled` and lives on.
  let current: AbortController | undefined;
  const session = new IndexSession(
    options.registry ? { registry: options.registry } : {},
  );
  let running = false;
  parentPort!.on(
    "message",
    (message: GraphWorkerMessage | { kind: "abort" }) => {
      if (message.kind === "abort") {
        if (current && !current.signal.aborted) current.abort(new Cancelled());
        return;
      }
      if (message.kind !== "request" || running) return;
      running = true;
      void run(message.id, message.request).finally(() => {
        running = false;
      });
    },
  );
  async function run(id: string, request: GraphRequest): Promise<void> {
    // The work counters of this request alone (C-22 observations).
    resetGraphWork();
    const controller = new AbortController();
    current = controller;
    const signal = controller.signal;
    const check = signal.throwIfAborted.bind(signal);
    // Every abort check of the command is a checkpoint; the one that acts
    // on a cancel is reported with the answer.
    let abortedAt: number | undefined;
    signal.throwIfAborted = () => {
      const at = Atomics.add(control, CONTROL.checkpoints, 1) + 1;
      if (Atomics.load(control, CONTROL.cancel) === 1 && !signal.aborted) {
        abortedAt = at;
        controller.abort(new Cancelled());
      }
      check();
    };
    let answer: Record<string, unknown>;
    try {
      const response = await executeGraph(request, {
        signal,
        session,
        progress: (progress) =>
          parentPort!.postMessage({ kind: "progress", id, progress }),
        onModuleCall: (inside) =>
          Atomics.store(
            control,
            CONTROL.section,
            inside === true
              ? SECTION.module
              : inside === "awaiting"
                ? SECTION.awaiting
                : SECTION.core,
          ),
      });
      const view = new GraphView(response);
      if (view.bytes() > agentLimits.graphResultBytes)
        throw Error(
          "Compact result exceeds session retention. Narrow the selector, limit or depth; no complete answer is retained.",
        );
      answer = {
        kind: "result",
        id,
        view,
        session: { ...session.counts },
        work: { counts: graphWork.counts, stages: graphWork.stages },
      };
    } catch (error) {
      answer =
        signal.aborted && Object.is(error, signal.reason)
          ? { kind: "cancelled", id, abortedAt }
          : {
              kind: "error",
              id,
              error: operationError(error, "GRAPH_REQUEST_FAILED"),
            };
    } finally {
      Atomics.store(control, CONTROL.section, 0);
      current = undefined;
    }
    // Between jobs the worker keeps only what its session keeps: the job's
    // own objects are released here, before it answers, and what is still
    // alive afterwards is measured. The server ends a worker that keeps more
    // than its bound (GraphJobs).
    answer.memory = resting();
    parentPort!.postMessage(answer);
  }
  parentPort!.postMessage({ kind: "ready" });
}
