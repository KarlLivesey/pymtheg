import { scopeIssueResult } from "../reporting/scope-issues.js";
import { readFile, stat } from "node:fs/promises";
import { hash, finding, json, identity } from "../shared/identity.js";
import type { ProjectIR } from "../semantic/core.js";
import { result, type AnalysisResult } from "../reporting/report.js";
import {
  displayTrace,
  replay,
  sourceMappingValid,
} from "../behaviour/model.js";
import {
  runExplore,
  type RunExploreOptions,
} from "../behaviour/explore-runner.js";
import { lowerInWorker } from "../behaviour/runner.js";
export interface BackendOptions {
  entry: string;
  method?: "exhaustive" | "sample";
  stateBudget?: number;
  seed: string;
  maxSteps: number;
  maxSamples: number;
  timeoutMs: number;
  scopeFile: string | null;
  scope?: unknown;
}
async function readJson(file: string): Promise<unknown> {
  if ((await stat(file)).size > 16 * 1024 * 1024)
    throw Error("Scope file exceeds 16 MiB limit");
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}
/** Runs `verify` (exhaustive) or `simulate` (sample) on the built-in engines. */
export async function runBackend(
  ir: ProjectIR,
  options: BackendOptions,
  signal: AbortSignal,
  exploreOptions: RunExploreOptions = {},
): Promise<AnalysisResult[]> {
  const d = ir.declarations.find((d) => d.name === options.entry),
    id = d?.id ?? options.entry,
    span = d?.span ?? { file: ir.snapshot.sources[0]!.file, start: 0, end: 0 };
  const failed = (
    category: string,
    message: string,
    completion: AnalysisResult["completion"] = "failed",
  ): AnalysisResult[] => [
    result(ir, id + "/backend", "behaviour", {
      outcome: "inconclusive",
      completion,
      method: options.method === "sample" ? "simulation" : "finite_model_check",
      exhaustive: false,
      outstandingObligations: [message],
      diagnostics: [
        finding(
          category,
          message,
          span,
          completion === "failed" ? "error" : "warning",
        ),
      ],
      witnessValidation: "unvalidated",
      scope: { configurationHash: hash(json(options)) },
    }),
  ];
  if (signal.aborted) return failed("B130", "User cancelled", "cancelled");
  let scopeData: unknown = options.scope;
  try {
    if (options.scopeFile) scopeData = await readJson(options.scopeFile);
  } catch (e) {
    return failed("B101", String(e));
  }
  const plan = await lowerInWorker(ir, options.entry, scopeData ?? {}, signal);
  if (signal.aborted) return failed("B130", "User cancelled", "cancelled");
  if (plan.kind !== "supported")
    return failed(
      "B001",
      plan.reasons.join("; "),
      plan.kind === "unsupported" ? "unsupported" : "incomplete",
    );
  const model = plan.model;
  if (!sourceMappingValid(model, ir))
    return failed("B106", "Snapshot/model/source-map identity mismatch");
  const method = options.method ?? "exhaustive";
  const { result: search, elapsedMs } = await runExplore(
    method === "sample"
      ? {
          model,
          ir,
          method,
          options: {
            seed: options.seed,
            maxSteps: options.maxSteps,
            maxSamples: options.maxSamples,
          },
        }
      : {
          model,
          ir,
          method,
          options: { stateBudget: options.stateBudget ?? 1_000_000 },
        },
    { ...exploreOptions, signal, timeoutMs: options.timeoutMs },
  );
  const scopeIssue = scopeIssueResult(ir, model);
  const reason =
    search.completion === "state_budget"
      ? `State budget stateBudget=${options.stateBudget ?? 1_000_000} exhausted. This property remains unresolved.`
      : search.completion === "timed_out"
        ? `Time budget timeoutMs=${options.timeoutMs} exhausted. This property remains unresolved.`
        : search.completion === "cancelled"
          ? "Checking was cancelled. This property remains unresolved."
          : search.completion === "engine_error"
            ? `Built-in worker/engine error: ${search.error}. This property remains unresolved.`
            : "Search reached a source domain boundary. This property remains unresolved.";
  const records = [...search.properties, search.domain].map((verdict) => {
    const domain = verdict === search.domain;
    const property = model.properties.find(
      (p) => p.source === verdict.property,
    );
    const violation = verdict.verdict === "violated";
    const unresolved =
      verdict.verdict === "incomplete" || (!!scopeIssue && !violation);
    const validation = verdict.trace ? replay(model, verdict.trace, ir) : null;
    const completion: AnalysisResult["completion"] = !unresolved
      ? "complete"
      : search.completion === "cancelled"
        ? "cancelled"
        : search.completion === "timed_out"
          ? "timed_out"
          : search.completion === "engine_error"
            ? "failed"
            : "incomplete";
    const message =
      verdict.verdict === "incomplete"
        ? reason
        : "Resolve the unused scope entries before treating this property as checked";
    return result(
      ir,
      id + (domain ? "/" : "/invariant/") + verdict.property,
      "behaviour",
      {
        propertyHash: hash(
          json(
            domain
              ? model.machine.states
              : model.machine.invariants.find(
                  (p) => p.name === verdict.property,
                ),
          ),
        ),
        outcome: violation
          ? "counterexample"
          : unresolved
            ? "inconclusive"
            : "no_counterexample",
        completion,
        method: method === "sample" ? "simulation" : "finite_model_check",
        exhaustive: method === "exhaustive" && search.completion === "complete",
        scope: {
          snapshotHash: ir.snapshot.id,
          modelHash: model.hash,
          configurationHash: hash(json({ options, scope: scopeData })),
          bounds: {
            ...model.bounds,
            ...(method === "sample"
              ? {
                  maxSteps: String(options.maxSteps),
                  maxSamples: String(options.maxSamples),
                }
              : { stateBudget: String(options.stateBudget ?? 1_000_000) }),
          },
          ...(method === "sample" ? { seed: options.seed } : {}),
        },
        assumptions: model.assumptions,
        outstandingObligations: unresolved ? [message] : [],
        witnessValidation: violation ? "source_replayed" : "not_applicable",
        witnessOrDerivation: {
          engine:
            method === "sample"
              ? "Built-in seeded sampler"
              : "Built-in exhaustive breadth-first search",
          verdict: verdict.verdict,
          searchCompletion: search.completion,
          distinctStates: search.measurements?.statesVisited ?? null,
          ...(search.sampling ? { sampling: search.sampling } : {}),
          ...(violation
            ? {
                events: validation!.events,
                states: displayTrace(model, verdict.trace!),
                sourceReplay: true,
                ...(domain
                  ? { domainViolations: validation!.domainViolations }
                  : {}),
              }
            : {}),
        },
        diagnostics: violation
          ? domain
            ? validation!.domainViolations.map((d) =>
                finding(
                  "B011",
                  `Event ${d.event} assigns ${d.value} to ${d.state}, outside its declared range ${d.minimum}..${d.maximum}. Guard the event or revise the declared range.`,
                  d.span,
                  "error",
                  [d.declarationSpan],
                  validation!.events.map((e) => e.operation),
                ),
              )
            : [
                finding(
                  "B010",
                  `Invariant ${verdict.property} violated${validation!.domainViolations.length ? " in a state outside its declared range. Fix the event's range violation first; do not weaken the invariant to hide it." : ""}`,
                  property!.span,
                  "error",
                  validation!.events.map((e) => e.span),
                  validation!.events.map((e) => e.operation),
                ),
              ]
          : unresolved
            ? [
                finding(
                  search.completion === "cancelled"
                    ? "B130"
                    : search.completion === "timed_out"
                      ? "B124"
                      : search.completion === "engine_error"
                        ? "B104"
                        : "B108",
                  message,
                  property?.span ?? model.machine.span,
                  search.completion === "engine_error" ? "error" : "warning",
                ),
              ]
            : [],
        toolVersions: {
          pymtheg: identity.version,
          engine: "builtin",
          node: process.versions.node,
        },
        measurements: {
          backendMs: elapsedMs,
          ...(search.measurements
            ? {
                ...search.measurements,
                distinctStates: search.measurements.statesVisited,
              }
            : {}),
        },
      },
    );
  });
  return scopeIssue ? [...records, scopeIssue] : records;
}
