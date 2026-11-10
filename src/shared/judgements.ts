import type { AnalysisResult } from "../reporting/report.js";
export const mayReportEstablished = (
  r: Pick<AnalysisResult, "completion" | "outstandingObligations" | "method">,
): boolean =>
  r.completion === "complete" &&
  r.outstandingObligations.length === 0 &&
  r.method !== "simulation" &&
  r.method !== "heuristic";
export const effectCovered = (
  declared: readonly string[],
  effect: string,
  pure: boolean,
): boolean => !pure && declared.includes(effect);
export const outcomeHandled = (
  alternatives: Iterable<string>,
  handlers: ReadonlySet<string>,
): boolean => [...alternatives].every((x) => handlers.has(x));
export const obligationDischarged = (
  states: Iterable<string>,
  terminals: readonly string[],
  verifiedTransfer: boolean,
): boolean =>
  verifiedTransfer || [...states].every((s) => terminals.includes(s));
export const safeToSuggestHoist = (
  stable: boolean,
  stableInputs: boolean,
  noRelevantMutation: boolean,
): boolean => stable && stableInputs && noRelevantMutation;
