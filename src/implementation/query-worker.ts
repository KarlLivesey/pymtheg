import type { ObservedGraph } from "./schema.js";
import { errorMessage } from "../shared/error-message.js";
import { declarationTypeInventory } from "../studio/declaration-type-inventory.js";
import { parentPort, workerData } from "node:worker_threads";
import {
  decodeImplementation,
  implementationPage,
  implementationDetail,
} from "./workspace.js";
import {
  compareImplementationLink,
  comparisonWorkingGraph,
} from "./comparison.js";
let decodedGraphs = 0;
const sample = (
  phase: string,
  graphs: (ObservedGraph | null | undefined)[] = [],
) => {
  const unique = [...new Set(graphs.filter((g): g is ObservedGraph => !!g))];
  if (workerData.measureWorkingSet)
    parentPort!.postMessage({
      kind: "working-set",
      sample: {
        phase,
        decodedGraphs,
        workingNodes: unique.reduce((n, g) => n + g.nodes.length, 0),
        workingEdges: unique.reduce((n, g) => n + g.edges.length, 0),
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
    });
};
try {
  parentPort!.postMessage({ kind: "ready" });
  if (workerData.kind === "type-inventory") {
    parentPort!.postMessage({
      result: declarationTypeInventory(
        workerData.root,
        workerData.inputs,
        workerData.warnings,
      ),
    });
  } else {
    const plan = decodeImplementation(workerData.plan, false);
    const code = workerData.code ? decodeImplementation(workerData.code) : null;
    if (code?.graph) decodedGraphs++;
    if (workerData.kind === "comparison" && code)
      code.graph = comparisonWorkingGraph(
        code.graph,
        workerData.options.nodeId,
      );
    sample("code-decoded", [code?.graph]);
    if (workerData.kind === "comparison") {
      // The selected revision and baseline often contain identical observation
      // parts. Reuse only exact path/text equality; matching revision IDs alone
      // cannot establish equality or justify skipping validation.
      const sameObservation =
        code &&
        workerData.baseline &&
        workerData.code.documents.length ===
          workerData.baseline.documents.length &&
        workerData.code.documents.every(
          (d: { path: string; text: string }, i: number) => {
            const other = workerData.baseline.documents[i];
            return d.path === other.path && d.text === other.text;
          },
        );
      const baseline = workerData.baseline
        ? sameObservation
          ? {
              ...decodeImplementation(workerData.baseline, false),
              graph: code!.graph,
            }
          : decodeImplementation(workerData.baseline)
        : null;
      if (baseline?.graph && !sameObservation) decodedGraphs++;
      if (baseline && !sameObservation)
        baseline.graph = comparisonWorkingGraph(
          baseline.graph,
          workerData.options.nodeId,
        );
      sample("baseline-decoded", [code?.graph, baseline?.graph]);
      const result = compareImplementationLink(
        plan,
        code,
        baseline,
        workerData.options,
        workerData.baselineUnavailable,
      );
      sample("comparison-complete", [code?.graph, baseline?.graph]);
      parentPort!.postMessage({ result: { ...result, reviewAllowed: false } });
    } else {
      const result = implementationPage(plan, code, workerData.options);
      const detail = workerData.options.detailId
        ? implementationDetail(
            plan,
            code,
            workerData.options.mode,
            workerData.options.detailId,
            workerData.options.characterOffset ?? 0,
          )
        : null;
      parentPort!.postMessage({ result: { ...result, detail } });
    }
  }
} catch (error) {
  parentPort!.postMessage({ error: errorMessage(error) });
}
