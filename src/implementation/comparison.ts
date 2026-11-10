import {
  dependencyChanges,
  dependencyHashes,
  dependencyEdge,
} from "./dependencies.js";
import { architectureDetail } from "../architecture/model.js";
import { planDisplay } from "./plan-display.js";
import type { ImplementationComparisonQuery } from "./comparison-protocol.js";
import { codeDifference } from "./code-difference.js";
import { relationshipDifference } from "./relationship-difference.js";
import type {
  ImplementationState,
  ImplementationBinding,
} from "./workspace.js";
import { implementationPlanHashes } from "./plan-hash.js";
import type { ObservedGraph } from "./schema.js";

/** Internal query working set, after full input validation. Preserve the complete
 * dependency closure and every direct relationship of the selected declaration.
 * This is never retained/exported as an observation or used for graph paging. */
export function comparisonWorkingGraph(
  graph: ObservedGraph | null,
  id: string,
): ObservedGraph | null {
  if (!graph) return null;
  const outgoing = new Map<string, ObservedGraph["edges"]>();
  for (const edge of graph.edges) {
    if (!dependencyEdge(edge) && edge.from !== id) continue;
    const edges = outgoing.get(edge.from) ?? [];
    edges.push(edge);
    outgoing.set(edge.from, edges);
  }
  const kept = new Set([id]),
    queue = [id];
  while (queue.length)
    for (const edge of outgoing.get(queue.pop()!) ?? []) {
      if (dependencyEdge(edge) && !kept.has(edge.to!)) {
        kept.add(edge.to!);
        queue.push(edge.to!);
      }
    }
  const nodes = graph.nodes.filter((n) => kept.has(n.id));
  const files = new Set(nodes.map((n) => n.span.file));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(
      (e) => kept.has(e.from) && (dependencyEdge(e) || e.from === id),
    ),
    files: graph.files.map((f) =>
      files.has(f.path) ? f : { ...f, text: undefined },
    ),
  };
}

function inspect(
  state: ImplementationState | null,
  binding: ImplementationBinding,
  baseline: boolean,
  unavailable: string | null,
) {
  const graph = state?.graph;
  const node = graph?.nodes.find((n) => n.id === binding.nodeId);
  const file = graph?.files.find(
    (f) => f.path === (node?.span.file ?? binding.sourceFile),
  );
  let reason = unavailable;
  if (!reason && (!graph || !node))
    reason = baseline
      ? "The retained baseline does not contain this declaration."
      : (graph?.files.find((f) => f.path === binding.sourceFile)?.coverage
            ?.declarations ?? graph?.coverage.declarations) === "complete" &&
          graph?.scope.files.includes(binding.sourceFile) &&
          !graph?.staleFiles.includes(binding.sourceFile)
        ? "The declaration is absent from this covered code version."
        : "This observation cannot establish whether the declaration exists.";
  if (
    !reason &&
    baseline &&
    (graph!.snapshotId !== binding.observationId ||
      node!.declarationHash !== binding.declarationHash ||
      node!.bodyHash !== binding.bodyHash ||
      (binding.dependencyHash !== undefined &&
        dependencyHashes(graph).get(binding.nodeId) !== binding.dependencyHash))
  )
    reason =
      "The retained baseline does not match the reviewed hashes. No comparison was inferred.";
  if (!reason && graph!.staleFiles.includes(node!.span.file))
    reason =
      "This source changed during capture; capture a consistent version before reviewing.";
  if (!reason && file?.text === undefined)
    reason = "This observation did not retain source text.";
  return {
    metadata: {
      revision: state?.index.id ?? null,
      label: graph?.version.label ?? null,
      observationId: graph?.snapshotId ?? null,
      file: node?.span.file ?? binding.sourceFile,
      available: !reason,
      reason,
      body: node?.body ?? null,
      signature: node?.signature.slice(0, 4000) ?? null,
      signatureTruncated: (node?.signature.length ?? 0) > 4000,
      declarationHash: node?.declarationHash ?? null,
      bodyHash: node?.bodyHash ?? null,
      sourceHash: file?.hash ?? null,
      fileHash: file?.hash ?? null,
    },
    text: !reason ? file!.text!.slice(node!.span.start, node!.span.end) : null,
  };
}
export function compareImplementationLink(
  plan: ImplementationState,
  code: ImplementationState | null,
  baseline: ImplementationState | null,
  query: ImplementationComparisonQuery,
  baselineUnavailable: string | null,
) {
  const matches = plan.index.entities.filter((e) => e.id === query.planId);
  const binding = plan.bindings.find(
    (b) => b.planId === query.planId && b.nodeId === query.nodeId,
  );
  if (matches.length !== 1 || !binding)
    throw Error("Choose one retained plan/declaration link to compare.");
  const entity = matches[0]!;
  const document = plan.documents.find((d) => d.path === entity.document);
  if (!document) throw Error("The retained plan content is unavailable.");
  const value = architectureDetail(document, entity.pointer);
  const fields = entity.planning ? planDisplay(value) : undefined;
  const text =
    typeof value === "string"
      ? value
      : value &&
          typeof value === "object" &&
          "source" in value &&
          typeof value.source === "string"
        ? value.source
        : JSON.stringify(value, null, 2);
  const before = inspect(baseline, binding, true, baselineUnavailable);
  const after = inspect(code, binding, false, null);
  const source =
    before.text !== null && after.text !== null
      ? codeDifference(before.text, after.text)
      : null;
  const relationships =
    before.metadata.available && after.metadata.available
      ? relationshipDifference(
          baseline!.graph!,
          code!.graph!,
          query.nodeId,
          query.offset,
          query.limit,
        )
      : null;
  return {
    design: {
      meaning:
        "Retained design belongs to the selected checkpoint. Current checked source is compared without accepting changes.",
      issues: (plan.designAttention?.issues ?? []).filter(
        (i) => i.id === query.planId,
      ),
      current: (plan.designAttention?.current ?? []).filter((e) =>
        (plan.designAttention?.issues ?? []).some(
          (i) => i.id === query.planId && i.target === e.id,
        ),
      ),
    },
    plan: {
      name: entity.name,
      fields: fields ?? [],
      text: fields ? "" : text.slice(0, 4000),
      truncated: !fields && text.length > 4000,
    },
    planId: query.planId,
    nodeId: query.nodeId,
    planRevision: plan.index.id,
    codeRevision: query.codeRevision,
    planHash: implementationPlanHashes(plan.documents)(matches[0]!),
    note: binding.note,
    before: before.metadata,
    after: after.metadata,
    source,
    relationships,
    dependencies: dependencyChanges(baseline?.graph, code?.graph, query.nodeId),
    limitations: [
      ...new Set([
        ...(baseline?.graph?.limitations ?? []),
        ...(code?.graph?.limitations ?? []),
      ]),
    ].slice(0, 50),
    meaning:
      "Source and relationship differences are observations. Reviewing a link does not prove correctness or conformance to the plan.",
  };
}
