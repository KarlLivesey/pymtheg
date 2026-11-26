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
import { useChildGroups } from "../backends/child-groups.js";
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
  childGroups?: SharedArrayBuffer,
): Promise<void> {
  // Child process groups go into the coordinator's registry (C-54), so the
  // coordinator can kill them after terminating this worker.
  useChildGroups(childGroups);
  const shared = new Int32Array(control);
  const cancel = new AbortController();
  const post = (message: GraphWorkerMessage) =>
    parentPort!.postMessage(message);
  const onMessage = (message: { kind?: string }) => {
    if (message?.kind === "cancel") cancel.abort();
  };
  parentPort!.on("message", onMessage);
  // C-50 review: every checkpoint of the command (each abort check) also
  // reads the cancel flag the coordinator sets before it sends `cancel`, as
  // the MCP worker does. Synchronous work does not let this thread read the
  // message, so once the flag is set no later checkpoint passes.
  const flagged = () => {
    if (Atomics.load(shared, CONTROL.cancel) === 1 && !cancel.signal.aborted)
      cancel.abort();
  };
  const check = cancel.signal.throwIfAborted.bind(cancel.signal);
  cancel.signal.throwIfAborted = () => {
    flagged();
    check();
  };
  try {
    const response = await executeGraph(request, {
      ...options,
      signal: cancel.signal,
      progress: (progress) => post({ kind: "progress", progress }),
      // Only a module's synchronous call is the module section: while its
      // promise is awaited ("awaiting"), the abort signal reaches the module
      // (Rust's phase worker, a toolchain's processes), so a cancel there is
      // cooperative.
      onModuleCall: (inside) => {
        Atomics.store(
          shared,
          CONTROL.section,
          inside === true ? SECTION.module : SECTION.core,
        );
        // C-50 review: entering module code (a call, or a stretch the module
        // marks while its promise is awaited) re-reads the flag after the
        // section is set, and refuses once it is set. A cancel taken
        // cooperatively in the awaited call's unmarked code must not then
        // let the module run a whole marked stretch: the coordinator saw the
        // section as not the module's and will not terminate it.
        if (inside === true) cancel.signal.throwIfAborted();
      },
    });
    // The last checkpoint. A stop set before here answers as cancelled,
    // unless it is an index whose completion is already written: the index
    // is complete, so that is its answer, and the CLI says the stop came
    // after it (C-50 review). A signal after this may still see the result.
    if (!(request.command === "index" && response.sync.complete))
      cancel.signal.throwIfAborted();
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
