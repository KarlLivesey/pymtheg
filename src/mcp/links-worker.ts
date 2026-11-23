// SPDX-License-Identifier: MIT
import "../shared/quiet-warnings.js";
import { operationError } from "./operation-errors.js";
import { agentLimits } from "./limits.js";
import { parentPort, workerData } from "node:worker_threads";
import * as library from "../architecture/code-links.js";
import { makeLinkView } from "./links-view.js";
import { useChildGroups } from "../backends/child-groups.js";
const { action, input, childGroups } = workerData;
// C-54: every child process this job starts is recorded in the server's
// registry for the job, so the server can kill it whatever this thread does.
useChildGroups(childGroups);
const functions = {
  requirement: library.createRequirement,
  add: library.createCodeLink,
  remove: library.removeCodeLink,
  refresh: library.refreshCodeLink,
  list: library.listCodeLinks,
  check: library.checkCodeLinks,
  requirements_for: library.requirementsFor,
  unlinked: library.unlinkedWork,
  history: library.codeLinkHistory,
} as const;
try {
  parentPort!.postMessage({ kind: "progress", phase: "starting", action });
  const result = await (
    functions[action as keyof typeof functions] as (input: any) => Promise<any>
  )(input);
  const view = makeLinkView(action, result, input);
  // A mutation may already have committed: size errors must never claim rollback.
  if (Buffer.byteLength(JSON.stringify(view)) > agentLimits.linkResultBytes)
    throw Error(
      "Result exceeds retained 8 MiB bound; narrow list by requirement/file/symbol. A mutation may have committed; inspect list/history before retrying it.",
    );
  parentPort!.postMessage({ kind: "result", view });
} catch (error) {
  parentPort!.postMessage({ kind: "error", error: operationError(error) });
}
parentPort!.close();
