import type { Snapshot } from "../language/project.js";
import type { ProjectIR } from "../semantic/core.js";
import {
  blockedSymbols,
  callable,
  diagnosticsBySymbol,
} from "../semantic/core.js";
import { feasibility } from "../analysis/feasibility.js";
import { mayReportEstablished } from "../shared/judgements.js";
import {
  identity,
  hash,
  type Finding,
  json,
  type Span,
} from "../shared/identity.js";
export interface AnalysisResult {
  propertyId: string;
  propertyHash: string;
  analysisKind: string;
  outcome:
    | "counterexample"
    | "no_counterexample"
    | "established"
    | "inconclusive"
    | "not_run";
  method:
    | "structural"
    | "abstract_interpretation"
    | "simulation"
    | "finite_model_check"
    | "heuristic";
  /**
   * Behaviour results only: true when every reachable state was searched (a
   * completed `verify`); false for every `simulate` result and every search
   * that stopped early. A sampled run is never a proof.
   */
  exhaustive?: boolean;
  completion:
    | "complete"
    | "incomplete"
    | "unsupported"
    | "timed_out"
    | "cancelled"
    | "failed";
  scope: {
    snapshotHash: string;
    configurationHash: string;
    modelHash?: string;
    bounds?: Record<string, string>;
    seed?: string;
  };
  assumptions: string[];
  outstandingObligations: string[];
  witnessOrDerivation: unknown;
  witnessValidation:
    | "source_replayed"
    | "backend_only"
    | "unvalidated"
    | "not_applicable";
  diagnostics: Finding[];
  toolVersions: Record<string, string>;
  measurements: Record<string, number>;
}
export interface Report {
  consumers?: {
    selectedFiles: string[];
    incompleteFiles?: string[];
    symbolIds: string[];
    diagnostics: Finding[];
    results: AnalysisResult[];
  };
  schemaVersion: typeof identity.schema;
  semanticVersion: string;
  snapshot: {
    id: string;
    files: { file: string; hash: string; text: string }[];
  };
  session: {
    state: "Completed" | "Cancelled" | "Failed";
    requested: string;
    staleFiles: string[];
  };
  diagnostics: Finding[];
  results: AnalysisResult[];
  dependencies: ProjectIR["edges"];
  measurements: Record<string, number>;
  artifacts: string[];
}
export function result(
  ir: ProjectIR,
  propertyId: string,
  analysisKind: string,
  options: Partial<
    Omit<AnalysisResult, "propertyId" | "analysisKind" | "scope">
  > & { scope?: Partial<AnalysisResult["scope"]> } = {},
): AnalysisResult {
  const { scope, ...rest } = options;
  const r: AnalysisResult = {
    propertyId,
    propertyHash: hash(propertyId + ir.snapshot.id),
    analysisKind,
    outcome: "established",
    method: "structural",
    completion: "complete",
    scope: {
      snapshotHash: ir.snapshot.id,
      configurationHash: hash("local-v0"),
      ...scope,
    },
    assumptions: [],
    outstandingObligations: [],
    witnessOrDerivation: null,
    witnessValidation: "not_applicable",
    diagnostics: [],
    toolVersions: { pymtheg: identity.version, node: process.versions.node },
    measurements: {},
    ...rest,
  };
  if (r.outcome === "established" && !mayReportEstablished(r))
    r.outcome = "inconclusive";
  return r;
}
export function localReport(ir: ProjectIR): Report {
  const blocked = blockedSymbols(ir),
    bySymbol = diagnosticsBySymbol(ir);
  const results: AnalysisResult[] = [];
  for (const d of ir.declarations)
    if (callable(d) || d.kind === "machine") {
      const ds = bySymbol.get(d.id) ?? [];
      results.push(
        result(ir, d.id + "/types-effects-outcomes", "types-effects-outcomes", {
          outcome: ds.some((x) => x.severity === "error")
            ? "counterexample"
            : blocked.has(d.id)
              ? "inconclusive"
              : "established",
          completion: blocked.has(d.id) ? "incomplete" : "complete",
          outstandingObligations: blocked.has(d.id)
            ? [`Resolve holes/errors in dependency closure of ${d.name}`]
            : [],
          diagnostics: ds,
        }),
      );
      if (callable(d)) results.push(...feasibility(ir, d, blocked.has(d.id)));
    }
  const diagnostics = [
    ...ir.diagnostics,
    ...results
      .flatMap((r) => r.diagnostics)
      .filter((d) => !ir.diagnostics.includes(d)),
  ];
  return {
    schemaVersion: identity.schema,
    semanticVersion: identity.semantics,
    snapshot: {
      id: ir.snapshot.id,
      files: ir.snapshot.sources.map((s) => ({
        file: s.file,
        hash: s.hash,
        text: s.text,
      })),
    },
    session: { state: "Completed", requested: "check", staleFiles: [] },
    diagnostics,
    results,
    dependencies: ir.edges,
    measurements: { ...ir.snapshot.measurements, ...ir.measurements },
    artifacts: [],
  };
}
export { exitStatus } from "./status.js";
export function location(snapshot: Snapshot, s: Span): string {
  const src = snapshot.sources.find((x) => x.file === s.file);
  if (!src) return s.file;
  let lo = 0,
    hi = src.lines.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (src.lines[mid]! <= s.start) lo = mid;
    else hi = mid;
  }
  return `${s.file}:${lo + 1}:${s.start - src.lines[lo]! + 1}`;
}
function derivation(r: AnalysisResult): string {
  const w = r.witnessOrDerivation;
  if (typeof w !== "object" || w === null) return "";
  const v = w as Record<string, unknown>;
  if (r.analysisKind === "cost")
    return `${v.classification}: ${v.expression} ${v.metric}${v.maximum === null ? "" : `; upper value ${v.maximum}`}${Array.isArray(v.contributors) ? "\n  contributors: " + v.contributors.join(", ") : ""}`;
  if (r.analysisKind === "behaviour") {
    if (Array.isArray(v.events))
      return (
        "source replay: " +
        v.events
          .map((e: unknown) =>
            typeof e === "object" && e !== null && "operation" in e
              ? String(e.operation)
              : "?",
          )
          .join(" -> ")
      );
    return (
      String(v.engine ?? "") +
      (v.distinctStates ? `; ${v.distinctStates} distinct states` : "")
    );
  }
  if (r.analysisKind === "feasibility")
    return json(w).trimEnd().replaceAll("\n", "\n  ");
  return "";
}
export function renderText(r: Report, snapshot: Snapshot): string {
  const lines = r.diagnostics.map(
    (d) =>
      `${location(snapshot, d.span)} ${d.severity} ${d.code}: ${d.message}${d.path.length ? "\n  path: " + d.path.join(" -> ") : ""}${
        d.related.length
          ? "\n  related: " +
            d.related
              .slice(0, 3)
              .map((s) => location(snapshot, s))
              .join(", ") +
            (d.related.length > 3
              ? ` (and ${d.related.length - 3} more in JSON)`
              : "")
          : ""
      }`,
  );
  if (r.consumers?.diagnostics.length) {
    lines.push(
      `Related files: ${r.consumers.diagnostics.length} separate findings (excluded from selected-file status)`,
    );
    for (const d of r.consumers.diagnostics)
      lines.push(
        `${location(snapshot, d.span)} ${d.severity} ${d.code}: ${d.message}`,
      );
  }
  for (const x of r.results) {
    const detail = derivation(x);
    lines.push(
      `${x.propertyId.split("#").at(-1)}: ${x.outcome === "counterexample" && x.analysisKind !== "behaviour" ? "finding" : x.outcome} (${x.method}, ${x.method === "simulation" && x.outcome === "no_counterexample" && x.completion === "complete" ? "sampled, not exhaustive" : x.completion})${detail ? "\n  " + detail : ""}${
        x.scope.bounds
          ? "\n  scope: " +
            Object.entries(x.scope.bounds)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ") +
            (x.scope.seed ? `; seed=${x.scope.seed}` : "")
          : ""
      }${x.assumptions.length ? "\n  assumptions: " + x.assumptions.join("; ") : ""}${x.outstandingObligations.length ? "\n  pending: " + x.outstandingObligations.join("; ") : ""}`,
    );
  }
  if (r.session.staleFiles.length)
    lines.push("STALE: " + r.session.staleFiles.join(", "));
  lines.push(
    `snapshot ${r.snapshot.id.slice(0, 12)}; ${r.results.length} scoped results`,
  );
  return lines.join("\n") + "\n";
}

export const emptyReport = (requested: string): Report => ({
  schemaVersion: identity.schema,
  semanticVersion: identity.semantics,
  snapshot: { id: "unavailable", files: [] },
  session: { state: "Failed", requested, staleFiles: [] },
  diagnostics: [],
  results: [],
  dependencies: [],
  measurements: {},
  artifacts: [],
});
