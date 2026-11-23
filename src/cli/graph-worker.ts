// SPDX-License-Identifier: MIT
// C-50: the protocol of the worker thread that runs one CLI graph command
// (its entry is graph-worker-main.ts). The store is opened, written and
// closed here, so only the response crosses to the main thread.
//
// Cancellation has the shape of C-48's MCP graph worker. Memory shared with
// the coordinator (graph-runner.ts) holds a cancel flag and the section the
// worker is in: the graph command itself, or a language module's
// synchronous code. The coordinator sets the flag and then reads the
// section; the worker sets the section and then reads the flag (both
// sequentially consistent), so one of them always sees the other. Inside a
// module the coordinator terminates the worker; anywhere else it sends a
// `cancel` message, which aborts the command at its next checkpoint, as a
// signal on the main thread did before.
import { parentPort } from "node:worker_threads";
import {
  executeGraph,
  type GraphExecutionOptions,
  type GraphRequest,
} from "../graph/commands.js";

/** Indexes into the shared control memory. */
export const CONTROL = { cancel: 0, section: 1 } as const;
export const controlLength = 2;
/** Section values: in the graph command itself, or inside a module's call. */
export const SECTION = { core: 0, module: 1 } as const;

/** The messages a graph worker posts to its coordinator. */
export type GraphWorkerMessage =
  | {
      kind: "progress";
      progress: Parameters<NonNullable<GraphExecutionOptions["progress"]>>[0];
    }
  | { kind: "result"; response: Awaited<ReturnType<typeof executeGraph>> }
  | { kind: "error"; message: string; cancelled: boolean };

/**
 * Runs `request` with `options` and posts progress and the response. Test
 * workers call it with their own options (a registry whose module cannot
 * finish), so the protocol is the production one.
 */
export async function serveGraphRequest(
  request: GraphRequest,
  control: SharedArrayBuffer,
  options: Omit<
    GraphExecutionOptions,
    "progress" | "signal" | "onModuleCall"
  > = {},
): Promise<void> {
  const shared = new Int32Array(control);
  const cancel = new AbortController();
  const post = (message: GraphWorkerMessage) =>
    parentPort!.postMessage(message);
  const onMessage = (message: { kind?: string }) => {
    if (message?.kind === "cancel") cancel.abort();
  };
  parentPort!.on("message", onMessage);
  try {
    const response = await executeGraph(request, {
      ...options,
      signal: cancel.signal,
      progress: (progress) => post({ kind: "progress", progress }),
      onModuleCall: (inside) => {
        Atomics.store(
          shared,
          CONTROL.section,
          inside ? SECTION.module : SECTION.core,
        );
        if (inside && Atomics.load(shared, CONTROL.cancel) === 1) {
          cancel.abort();
          cancel.signal.throwIfAborted();
        }
      },
    });
    post({ kind: "result", response });
  } catch (error) {
    post({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      cancelled: cancel.signal.aborted,
    });
  } finally {
    parentPort!.off("message", onMessage);
  }
}
