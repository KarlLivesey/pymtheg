import { agentLimits } from "./limits.js";
import { parentPort, workerData } from "node:worker_threads";
import * as library from "../architecture/code-links.js";
import { makeLinkView } from "./links-view.js";
const { action, input } = workerData;
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
  const view = makeLinkView(action, result);
  // A mutation may already have committed: size errors must never claim rollback.
  if (Buffer.byteLength(JSON.stringify(view)) > agentLimits.linkResultBytes)
    throw Error(
      "Result exceeds retained 8 MiB bound; narrow list by requirement/file/symbol. A mutation may have committed; inspect list/history before retrying it.",
    );
  parentPort!.postMessage({ kind: "result", view });
} catch (error) {
  const e = error as { code?: string; errcode?: number; message?: string };
  parentPort!.postMessage({
    kind: "error",
    error: {
      code: e.errcode === 5 || e.errcode === 6 ? "locked" : (e.code ?? "error"),
      message: e.message ?? String(error),
      action:
        "Correct the input or retry after releasing the named lock. For interrupted mutations inspect list/history before retrying; commits are not undone.",
    },
  });
}
parentPort!.close();
