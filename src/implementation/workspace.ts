// SPDX-License-Identifier: MIT
import { dependencyHashes } from "./dependencies.js";
import type { DesignAttention } from "./design-attention.js";
import { planDisplay } from "./plan-display.js";
import { z } from "zod";
import { json } from "../shared/identity.js";
import { ArchitectureStore } from "../architecture/store.js";
import {
  withNativeDocuments,
  ArchitectureConflict,
} from "../architecture/import-merge.js";
import { prepareAndIndexInWorker } from "../architecture/runner.js";
import type {
  ArchitectureIndex,
  ArchitectureDocument,
} from "../architecture/schema.js";
import { readObservedGraph, type ObservedGraph } from "./schema.js";
import { architectureDetail } from "../architecture/model.js";
import { implementationPlanHashes } from "./plan-hash.js";
import {
  observationDocuments,
  decodeObservation,
  observationPath,
} from "./storage.js";
import { isObservationPart } from "../architecture/limits.js";

export { observationPath } from "./storage.js";
export const bindingsPath = ".pymtheg-implementation-links.json";
import {
  observationSource,
  implementationLinkSource,
  implementationUnlinkSource,
} from "./version-sources.js";
export { observationSource } from "./version-sources.js";
const bindingSchema = z
  .object({
    planId: z.string(),
    planHash: z.string(),
    planHashMode: z.enum(["entity", "intent-v1"]).default("entity"),
    nodeId: z.string(),
    sourceFile: z.string(),
    declarationHash: z.string(),
    bodyHash: z.string().nullable(),
    dependencyHash: z.string().optional(),
    observationId: z.string(),
    reviewedRevision: z.string().min(1).max(256).optional(),
    note: z.string().max(2000),
  })
  .strict();
export const implementationBindingsSchema = z
  .object({
    schema: z.literal("pymtheg.implementation-links/v1"),
    bindings: z.array(bindingSchema).max(100000),
  })
  .strict();
export type ImplementationBinding = z.infer<typeof bindingSchema>;
export type ImplementationState = {
  designAttention?: DesignAttention | undefined;
  index: ArchitectureIndex;
  documents: ArchitectureDocument[];
  graph: ObservedGraph | null;
  bindings: ImplementationBinding[];
};
export function implementationDetail(
  plan: ImplementationState,
  code: ImplementationState | null,
  mode: string,
  id: string,
  offset: number,
) {
  let text: string, file: string;
  let fields: ReturnType<typeof planDisplay>;
  if (mode === "existing") {
    const node = code?.graph?.nodes.find((n) => n.id === id);
    const source = node
      ? code?.graph?.files.find((f) => f.path === node.span.file)
      : null;
    if (!node || source?.text === undefined)
      throw Error(
        "This observation does not retain source for the selected declaration.",
      );
    text = source.text.slice(node.span.start, node.span.end);
    file = node.span.file;
  } else {
    const entities = plan.index.entities.filter((e) => e.id === id);
    if (entities.length !== 1)
      throw Error("Choose an unambiguous planned record.");
    const entity = entities[0]!,
      document = plan.documents.find((d) => d.path === entity.document);
    if (!document) throw Error("The selected plan document is unavailable.");
    const value = architectureDetail(document, entity.pointer);
    fields = entity.planning ? planDisplay(value) : undefined;
    text =
      typeof value === "string"
        ? value
        : value &&
            typeof value === "object" &&
            "source" in value &&
            typeof value.source === "string"
          ? value.source
          : json(value);
    file =
      value &&
      typeof value === "object" &&
      "source" in value &&
      "file" in value &&
      typeof value.file === "string"
        ? value.file
        : entity.document;
  }
  const end = Math.min(text.length, offset + 12000);
  return {
    id,
    file,
    text: text.slice(offset, end),
    characterOffset: offset,
    ...(fields ? { fields } : {}),
    totalCharacters: text.length,
    nextOffset: end < text.length ? end : null,
  };
}
export async function readImplementation(
  store: ArchitectureStore,
  revision?: string,
  includeCode = true,
): Promise<ImplementationState | null> {
  const data = await readImplementationDocuments(store, revision);
  return data ? decodeImplementation(data, includeCode) : null;
}
export async function readImplementationDocuments(
  store: ArchitectureStore,
  revision?: string,
  all = true,
) {
  const index = await store.readAsync(revision);
  if (!index) return null;
  const documents = index.documents
    .filter(
      (d) =>
        all ||
        d.path === observationPath ||
        d.path === bindingsPath ||
        isObservationPart(d.path),
    )
    .map((d) => store.document(index.id, d.path));
  return { index, documents };
}
export function decodeImplementation(
  data: {
    index: ArchitectureIndex;
    documents: ArchitectureDocument[];
    designAttention?: DesignAttention | undefined;
  },
  includeCode = true,
): ImplementationState {
  const { index, documents } = data;
  const links = documents.find((d) => d.path === bindingsPath);
  const bindings = links
    ? implementationBindingsSchema.parse(JSON.parse(links.text)).bindings
    : [];
  if (
    new Set(bindings.map((b) => b.planId + "\0" + b.nodeId)).size !==
    bindings.length
  )
    throw Error("Duplicate implementation bindings");
  return {
    index,
    documents,
    designAttention: data.designAttention,
    graph: includeCode ? decodeObservation(documents) : null,
    bindings,
  };
}
async function commit(
  store: ArchitectureStore,
  previous: ImplementationState | null,
  changes: ArchitectureDocument[],
  label: string,
  source: string,
  signal: AbortSignal,
  replaceObservation = false,
) {
  const paths = new Set(changes.map((d) => d.path));
  const prior = previous?.documents ?? [];
  const documents = withNativeDocuments(
    [
      ...prior.filter(
        (d) =>
          !paths.has(d.path) &&
          !(replaceObservation && isObservationPart(d.path)),
      ),
      ...changes,
    ],
    [...paths],
  );
  const prepared = await prepareAndIndexInWorker(prior, documents, signal);
  signal.throwIfAborted();
  return store.save(
    label,
    source,
    prepared.documents,
    prepared.index,
    previous?.index.id ?? null,
    { skipUnchanged: true },
  );
}
export async function retainObservation(
  store: ArchitectureStore,
  value: unknown,
  expected: string | null,
  signal: AbortSignal,
  planDocument?: ArchitectureDocument,
) {
  const graph = readObservedGraph(value),
    previous = await readImplementation(store, undefined, false);
  if ((previous?.index.id ?? null) !== expected)
    throw new ArchitectureConflict(
      "Architecture changed. Refresh before retaining this code version.",
    );
  const parts = observationDocuments(graph);
  const storage = store.contentStorage(parts);
  const saved = await commit(
    store,
    previous,
    [...parts, ...(planDocument ? [planDocument] : [])],
    graph.version.label,
    observationSource,
    signal,
    true,
  );
  return { ...saved, storage };
}
export async function bindImplementation(
  store: ArchitectureStore,
  request: {
    revision: string;
    planId: string;
    nodeId: string;
    planHash: string;
    observationId: string;
    note: string;
  },
  signal: AbortSignal,
) {
  const state = await readImplementation(store);
  if (!state || state.index.id !== request.revision)
    throw new ArchitectureConflict(
      "Architecture changed. Review the current plan and code before linking.",
    );
  const plan = state.index.entities.filter((e) => e.id === request.planId);
  if (!plan.length)
    throw new ArchitectureConflict(
      `No current planned record has ID ${request.planId}. Choose its exact ID from read_implementation before linking.`,
    );
  if (plan.length !== 1)
    throw new ArchitectureConflict(
      "This planned record ID is ambiguous. Resolve its duplicate definitions before linking.",
    );
  if (implementationPlanHashes(state.documents)(plan[0]!) !== request.planHash)
    throw new ArchitectureConflict(
      "The planned record changed since it was reviewed. Refresh it and use the current planHash before linking.",
    );
  const graph = state.graph;
  if (!graph || graph.snapshotId !== request.observationId)
    throw new ArchitectureConflict(
      "Code observation changed. Review the selected declaration before linking.",
    );
  const node = graph.nodes.find((n) => n.id === request.nodeId);
  if (!node)
    throw new ArchitectureConflict(
      `No observed declaration has ID ${request.nodeId}. Choose its exact ID from read_implementation before linking.`,
    );
  const dependencyHash = dependencyHashes(graph).get(node.id);
  const previous = state.bindings.find(
    (b) => b.planId === request.planId && b.nodeId === request.nodeId,
  );
  const sameReview =
    previous?.planHashMode === "intent-v1" &&
    previous.planHash === request.planHash &&
    previous.observationId === graph.snapshotId &&
    previous.declarationHash === node.declarationHash &&
    previous.bodyHash === node.bodyHash &&
    previous.dependencyHash === dependencyHash &&
    previous.note === request.note;
  const reviewedRevision = sameReview
    ? (previous.reviewedRevision ?? state.index.id)
    : state.index.id;
  const binding = bindingSchema.parse({
    planId: request.planId,
    planHash: request.planHash,
    planHashMode: "intent-v1",
    nodeId: node.id,
    sourceFile: node.span.file,
    declarationHash: node.declarationHash,
    bodyHash: node.bodyHash,
    ...(dependencyHash ? { dependencyHash } : {}),
    observationId: graph.snapshotId,
    reviewedRevision,
    note: request.note,
  });
  if (
    !state.bindings.some(
      (b) => b.planId === request.planId && b.nodeId === request.nodeId,
    ) &&
    state.bindings.filter((b) => b.planId === request.planId).length >= 20
  )
    throw Error(
      "A planned record supports up to 20 implementation declarations. Split a larger component into smaller planned records.",
    );
  const bindings = [
    ...state.bindings.filter(
      (b) => b.planId !== request.planId || b.nodeId !== request.nodeId,
    ),
    binding,
  ];
  return commit(
    store,
    state,
    [
      {
        path: bindingsPath,
        text: json({ schema: "pymtheg.implementation-links/v1", bindings }),
      },
    ],
    `Link ${plan[0]!.name} to code`,
    implementationLinkSource,
    signal,
  );
}
export async function unlinkImplementation(
  store: ArchitectureStore,
  request: { revision: string; planId: string; nodeId: string },
  signal: AbortSignal,
) {
  const state = await readImplementation(store);
  if (!state || state.index.id !== request.revision)
    throw new ArchitectureConflict(
      "Architecture changed. Review the current code links before removing one.",
    );
  const bindings = state.bindings.filter(
    (binding) =>
      binding.planId !== request.planId || binding.nodeId !== request.nodeId,
  );
  if (bindings.length === state.bindings.length)
    throw new ArchitectureConflict(
      "That implementation link is no longer present.",
    );
  return commit(
    store,
    state,
    [
      {
        path: bindingsPath,
        text: json({ schema: "pymtheg.implementation-links/v1", bindings }),
      },
    ],
    "Remove implementation link",
    implementationUnlinkSource,
    signal,
  );
}

export const gapStates = [
  "unlinked",
  "missing",
  "unknown",
  "unparsed",
  "declaration-only",
  "empty",
  "fail-fast",
  "body-present",
  "plan-changed",
  "design-missing",
  "design-changed",
  "design-unknown",
  "code-changed",
  "dependency-changed",
] as const;
export type GapState = (typeof gapStates)[number];
export interface GapRow {
  id: string;
  name: string;
  kind: string;
  status: GapState;
  statuses: GapState[];
  reason: string;
  planHash: string;
  binding: ImplementationBinding | null;
  linkCount: number;
  codeLinks: {
    nodeId: string;
    name: string;
    file: string;
    status: GapState;
    statuses: GapState[];
    reason: string;
    body: string | null;
    reviewedRevision?: string;
  }[];
  code: {
    id: string;
    name: string;
    file: string;
    start: number;
    signature: string;
    body: string;
  } | null;
}
export function compareImplementation(
  plan: ImplementationState,
  code: ImplementationState | null,
): GapRow[] {
  const nodes = new Map(
    code?.graph?.nodes.map((node) => [node.id, node]) ?? [],
  );
  const dependencies = dependencyHashes(code?.graph);
  const unresolvedCalls = new Map<string, number>();
  for (const edge of code?.graph?.edges ?? [])
    if (edge.kind === "calls" && edge.resolution === "unresolved")
      unresolvedCalls.set(edge.from, (unresolvedCalls.get(edge.from) ?? 0) + 1);
  const byPlan = new Map<string, ImplementationBinding[]>();
  for (const binding of plan.bindings) {
    const group = byPlan.get(binding.planId) ?? [];
    group.push(binding);
    byPlan.set(binding.planId, group);
  }
  const designByPlan = new Map<
    string,
    NonNullable<ImplementationState["designAttention"]>["issues"]
  >();
  for (const issue of plan.designAttention?.issues ?? []) {
    const group = designByPlan.get(issue.id) ?? [];
    group.push(issue);
    designByPlan.set(issue.id, group);
  }
  const planHash = implementationPlanHashes(plan.documents);
  const order: GapState[] = [
    "missing",
    "unknown",
    "unparsed",
    "design-missing",
    "design-unknown",
    "design-changed",
    "plan-changed",
    "code-changed",
    "dependency-changed",
    "fail-fast",
    "empty",
    "declaration-only",
    "body-present",
  ];
  return plan.index.entities
    .filter((e) => !["document", "owner", "heading"].includes(e.kind))
    .map((e) => {
      const currentPlanHash = planHash(e);
      const evaluated = (byPlan.get(e.id) ?? []).map((binding) => {
        const node = nodes.get(binding.nodeId);
        const findings: { status: GapState; reason: string }[] = [];
        const add = (status: GapState, reason: string) => {
          findings.push({ status, reason });
        };
        for (const issue of designByPlan.get(e.id) ?? []) {
          add(
            issue.kind === "unknown-link-review"
              ? "design-unknown"
              : issue.kind === "broken-link"
                ? "design-missing"
                : "design-changed",
            issue.message,
          );
        }
        if (
          e.status === "source-snapshot-incomplete" ||
          e.status === "source-snapshot-ambiguous"
        ) {
          add(
            "unknown",
            "The linked design is incomplete or ambiguous. Code presence does not resolve the missing design obligations.",
          );
        }
        if (node && code?.graph?.staleFiles.includes(node.span.file)) {
          add(
            "unknown",
            "This source changed during observation. Capture a consistent code version before reviewing the link.",
          );
        }
        if (
          (binding.planHashMode === "intent-v1"
            ? currentPlanHash
            : e.contentHash) !== binding.planHash
        ) {
          add(
            "plan-changed",
            "The plan changed since this implementation link was reviewed.",
          );
        }
        if (!node) {
          const covered =
            (code?.graph?.files.find((f) => f.path === binding.sourceFile)
              ?.coverage?.declarations ??
              code?.graph?.coverage.declarations) === "complete" &&
            code?.graph?.scope.files.includes(binding.sourceFile) &&
            !code?.graph?.staleFiles.includes(binding.sourceFile);
          add(
            covered ? "missing" : "unknown",
            covered
              ? "The linked declaration is absent in the selected covered code version."
              : "The selected observation cannot establish whether this declaration exists. Check its source scope and coverage.",
          );
        } else {
          if (
            node.declarationHash !== binding.declarationHash ||
            node.bodyHash !== binding.bodyHash
          ) {
            add(
              "code-changed",
              "The linked code changed since it was reviewed. Compare it before accepting the new version.",
            );
          }
          if (
            binding.dependencyHash &&
            dependencies.get(node.id) &&
            binding.dependencyHash !== dependencies.get(node.id)
          ) {
            add(
              "dependency-changed",
              "An observed dependency changed since review. Compare captured bindings and resolved callees before accepting this version; dynamic dependencies remain unknown.",
            );
          }
          if (node.body !== "present") {
            add(
              node.body,
              node.body === "fail-fast"
                ? "Only a fail-fast stub is present."
                : node.body === "unparsed"
                  ? "Source syntax is incomplete; implementation body status cannot be established. Inspect the retained source and parse diagnostics."
                  : node.body === "empty"
                    ? "The code body is empty."
                    : "A signature is declared, with no implementation body.",
            );
          }
        }
        if (!findings.length)
          add(
            "body-present",
            "A code body exists. Its behaviour and conformance to the plan are not established.",
          );
        findings.sort(
          (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
        );
        return {
          binding,
          node,
          status: findings[0]!.status,
          statuses: [...new Set(findings.map((f) => f.status))],
          reason:
            findings.map((f) => f.reason).join(" ") +
            (node && unresolvedCalls.get(node.id)
              ? ` ${unresolvedCalls.get(node.id)} outgoing call${unresolvedCalls.get(node.id) === 1 ? " is" : "s are"} unresolved; changes behind ${unresolvedCalls.get(node.id) === 1 ? "this call" : "these calls"} cannot be tracked by this link.`
              : ""),
        };
      });
      const designFindings = designByPlan.get(e.id) ?? [];
      const primary = [...evaluated].sort(
        (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
      )[0];
      const statuses = [
        ...new Set([
          ...evaluated.flatMap((r) => r.statuses),
          ...designFindings.map((i) =>
            i.kind === "unknown-link-review"
              ? ("design-unknown" as const)
              : i.kind === "broken-link"
                ? ("design-missing" as const)
                : ("design-changed" as const),
          ),
        ]),
      ].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const node = primary?.node;
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        status: statuses[0] ?? "unlinked",
        statuses: statuses.length ? statuses : ["unlinked"],
        reason: primary
          ? (evaluated.length > 1
              ? `${evaluated.length} linked declarations. `
              : "") + primary.reason
          : [
              designFindings.map((i) => i.message).join(" "),
              "No explicit link to observed code. Any implementation status on this record remains an authored claim.",
            ]
              .filter(Boolean)
              .join(" "),
        planHash: currentPlanHash,
        binding: primary?.binding ?? null,
        code: node
          ? {
              id: node.id,
              name: node.qualifiedName,
              file: node.span.file,
              start: node.span.start,
              signature: node.signature,
              body: node.body,
            }
          : null,
        linkCount: evaluated.length,
        codeLinks: evaluated.slice(0, 20).map((result) => ({
          ...(result.binding.reviewedRevision
            ? { reviewedRevision: result.binding.reviewedRevision }
            : {}),
          nodeId: result.binding.nodeId,
          name: result.node?.qualifiedName ?? result.binding.nodeId,
          file: result.node?.span.file ?? result.binding.sourceFile,
          status: result.status,
          statuses: result.statuses,
          reason: result.reason,
          body: result.node?.body ?? null,
        })),
      };
    });
}
export function implementationPage(
  plan: ImplementationState,
  code: ImplementationState | null,
  options: {
    mode: "planned" | "existing" | "gaps";
    query: string;
    offset: number;
    limit: number;
  },
) {
  const { mode, offset, limit } = options,
    query = options.query.toLowerCase();
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw Error("Use an offset of zero or greater and a page size of 1–100.");
  const rows = mode === "existing" ? [] : compareImplementation(plan, code);
  const codeNodes = (code?.graph?.nodes ?? []).filter(
    (n) => n.kind !== "module",
  );
  const all =
    mode === "existing"
      ? codeNodes.map((n) => ({
          id: n.id,
          name: n.qualifiedName,
          kind: n.kind,
          body: n.body,
          file: n.span.file,
          signature: n.signature,
        }))
      : rows;
  const filtered = all.filter((n) =>
    `${n.id} ${n.name}`.toLowerCase().includes(query),
  );
  const items = filtered.slice(offset, offset + limit);
  const ids = new Set(items.map((i) => i.id));
  const names = new Map([
    ...(plan.index.entities ?? []).map((e) => [e.id, e.name] as const),
    ...(code?.graph?.nodes ?? []).map((n) => [n.id, n.qualifiedName] as const),
  ]);
  const rawEdges =
    mode === "existing"
      ? (code?.graph?.edges ?? [])
          .filter((e) => ids.has(e.from))
          .slice(0, 500)
          .map((e) => ({
            from: e.from,
            to: e.to,
            targetName: e.targetName,
            targetKind: e.targetKind ?? (e.to ? "project" : "unknown"),
            kind: e.kind,
            unresolved: e.resolution === "unresolved",
          }))
      : plan.index.edges
          .filter((e) => ids.has(e.from))
          .slice(0, 500)
          .map((e) => ({
            from: e.from,
            to: e.to,
            targetName: e.targetName,
            kind: e.kind,
            unresolved: e.unresolved,
          }));
  const edges = rawEdges.map((e) => ({
    ...e,
    fromName: names.get(e.from) ?? e.from,
    toName: e.to
      ? (names.get(e.to) ?? e.targetName ?? e.to)
      : (e.targetName ?? "Unresolved target"),
  }));
  const edgeCount =
    mode === "existing"
      ? (code?.graph?.edges ?? []).filter((e) => ids.has(e.from)).length
      : plan.index.edges.filter((e) => ids.has(e.from)).length;
  return {
    planRevision: plan.index.id,
    codeRevision: code?.index.id ?? null,
    observationId: code?.graph?.snapshotId ?? null,
    codeLabel: code?.graph?.version.label ?? null,
    coverage: code?.graph?.coverage ?? null,
    limitations: code?.graph?.limitations ?? ["No code observation selected."],
    counts:
      mode === "existing"
        ? codeNodes.reduce<Record<string, number>>((counts, node) => {
            counts[node.body] = (counts[node.body] ?? 0) + 1;
            return counts;
          }, {})
        : Object.fromEntries(
            gapStates.map((s) => [
              s,
              rows.filter((r) => r.statuses.includes(s)).length,
            ]),
          ),
    mode,
    query: options.query,
    offset,
    total: filtered.length,
    nextOffset:
      offset + items.length < filtered.length ? offset + items.length : null,
    items,
    edges,
    edgeCount,
    edgesTruncated: edgeCount > edges.length,
    meaning:
      "Presence and structure only. Neither a link nor a code body proves implementation correctness.",
  };
}
