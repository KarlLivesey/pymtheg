import type { Report, AnalysisResult } from "./report.js";
export function exitStatus(r: Report): number {
  if (
    r.session.state === "Cancelled" ||
    r.results.some((x) => x.completion === "cancelled")
  )
    return 130;
  if (
    r.session.state === "Failed" ||
    r.results.some((x) => x.completion === "failed")
  )
    return 3;
  if (
    r.diagnostics.some((d) => d.severity === "error") ||
    r.results.some((x) => x.outcome === "counterexample")
  )
    return 1;
  if (
    r.session.staleFiles.length ||
    r.results.some((x) => x.completion !== "complete")
  )
    return 2;
  return 0;
}

export function reportStatus(report: Report): string {
  const status = exitStatus(report);
  if (report.session.staleFiles.length) return "Earlier source snapshot";
  return status === 130
    ? "Cancelled"
    : status === 3
      ? "Run could not complete"
      : status === 1
        ? "Needs attention"
        : status === 2
          ? "Not fully checked"
          : "Requested checks finished";
}
export function outcomeLabel(result: AnalysisResult): string {
  if (result.completion === "cancelled") return "Cancelled";
  if (result.completion === "timed_out") return "Time budget exhausted";
  if (result.completion === "unsupported")
    return "Outside the supported subset";
  if (result.completion === "failed") return "Check failed to run";
  if (result.outcome === "counterexample") return "Problem found";
  if (result.completion === "incomplete") return "Still unresolved";
  if (result.outcome === "established") return "Established for this check";
  if (result.outcome === "no_counterexample")
    return result.method === "simulation"
      ? "No violation in sampled runs"
      : "No violation in this finite model";
  return result.outcome === "not_run" ? "Not checked" : "Not established";
}
export function propertyLabel(result: AnalysisResult): string {
  const id = result.propertyId.split("#").at(-1) ?? result.propertyId;
  const owner = id.split("/")[0] ?? id;
  if (result.analysisKind === "behaviour") {
    const property = id.split("/").at(-1) ?? id;
    const names: Record<string, string> = {
      environmentInvariantsHold: "Provider safety conditions",
      resourcesSettled: "Resource cleanup",
      assertionsHold: "Declared assertions",
      callContractsHold: "Call requirements",
      postconditionsHold: "Result conditions",
      executionSafe: "Supported execution only",
    };
    return `${owner} · ${names[property] ?? property}`;
  }
  const kind: Record<string, string> = {
    "types-effects-outcomes": "Interfaces, outcomes and effects",
    ownership: "Resource ownership and cleanup",
    "ownership-lifecycle": "Resource ownership and cleanup",
    feasibility: "Entry conditions",
    contracts: "Result conditions",
    "call-contract": "Call requirements",
    "scope-validation": "Scenario scope entries",
    cost: "Work count",
    behaviour: "Behaviour",
  };
  return `${owner} · ${kind[result.analysisKind] ?? result.analysisKind}`;
}
