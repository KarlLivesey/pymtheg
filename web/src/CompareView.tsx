// SPDX-License-Identifier: MIT
import { useState } from "react";
import { compareCost, compareReports } from "../../src/reporting/compare";
import type { StudioRun } from "../../src/studio/protocol";
import type { Span } from "../../src/shared/identity";
export function CompareView({
  current,
  runs,
  baseline,
  onBaseline,
  onInspect,
}: {
  current: StudioRun | null;
  runs: StudioRun[];
  baseline: string;
  onBaseline: (id: string) => void;
  onInspect: (run: StudioRun, span: Span) => void;
}) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const previous = runs.find((r) => r.id === baseline && r.id !== current?.id),
    a = current?.report,
    b = previous?.report;
  const comparison = a && b ? compareReports(a, b) : null;
  const unfinished =
    !!a &&
    !!b &&
    (current?.status !== "completed" || previous?.status !== "completed");
  const previousCosts = new Map(
    (b?.results ?? [])
      .filter((r) => r.analysisKind === "cost")
      .map((r) => [r.propertyId, r]),
  );
  const work = (a?.results ?? [])
    .filter((r) => r.analysisKind === "cost" && previousCosts.has(r.propertyId))
    .map((r) => ({ r, c: compareCost(r, previousCosts.get(r.propertyId)!) }));
  const shown = work.filter(
    ({ c }) => showUnchanged || !c.comparable || c.difference !== "0",
  );
  return (
    <>
      <div className="view-intro">
        <h2>What changed between runs?</h2>
        <p>
          Compare captured evidence. A disappearing finding does not prove the
          underlying problem is fixed.
        </p>
        <label>
          Previous run
          <select
            aria-label="Previous run"
            value={previous?.id ?? ""}
            onChange={(e) => onBaseline(e.target.value)}
          >
            <option value="">Choose a run</option>
            {runs
              .filter((r) => r.id !== current?.id && r.report)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.request.file.split("/").at(-1)} · {r.request.kind} ·{" "}
                  {r.status} · {r.report?.snapshot.id.slice(0, 8)}
                </option>
              ))}
          </select>
        </label>
      </div>
      {!comparison ? (
        <div className="empty-state">
          <h3>Select two runs to compare</h3>
          <p>
            Check a design, change it, and check it again. Each run keeps its
            own source snapshot.
          </p>
        </div>
      ) : (
        <>
          <div className="comparison-summary">
            <span>
              <strong>{comparison.changedFiles.length}</strong> changed source
              files
            </span>
            <span>
              <strong>{comparison.added.length}</strong> newly reported findings
            </span>
            <span>
              <strong>{comparison.notReported.length}</strong> findings no
              longer reported
            </span>
          </div>
          {(comparison.hasIncomplete ||
            unfinished ||
            comparison.requestChanged ||
            comparison.coverageChanged ||
            comparison.scopeChanged) && (
            <p className="comparison-warning">
              {comparison.hasIncomplete || unfinished
                ? "At least one run has incomplete checks. "
                : ""}
              {comparison.requestChanged
                ? "The requested kinds of analysis differ. "
                : ""}
              {comparison.coverageChanged
                ? "Different source files were checked. "
                : ""}
              {comparison.scopeChanged
                ? "Scopes, seeds, tool versions or assumptions differ. "
                : ""}
              Treat this as a comparison of reports, not proof that every
              missing finding was fixed.
            </p>
          )}
          <h3>Work changes and scope differences</h3>
          <label className="compare-toggle">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
            />{" "}
            Show unchanged work estimates (
            {
              work.filter(({ c }) => c.comparable && c.difference === "0")
                .length
            }
            )
          </label>
          {!shown.length && (
            <p>
              {!work.length
                ? "No matching work estimates are available in both runs."
                : "No changed work bounds under matching assumptions."}
            </p>
          )}
          {shown.slice(0, 100).map(({ r, c }) => {
            return (
              <article className="comparison-cost" key={r.propertyId}>
                <h4>
                  {r.propertyId.split("#").at(-1)?.split("/cost/")[0]} ·{" "}
                  {c.metric}
                </h4>
                <div className="compare-values">
                  <span>
                    <small>Previous</small>
                    <b>{c.previousExpression}</b>
                    <span>{c.previousMaximum ?? "unknown"} maximum</span>
                  </span>
                  <span aria-hidden="true">→</span>
                  <span>
                    <small>Current</small>
                    <b>{c.currentExpression}</b>
                    <span>{c.currentMaximum ?? "unknown"} maximum</span>
                  </span>
                </div>
                {c.comparable ? (
                  <p>
                    {c.difference === "0"
                      ? "The numeric bound is unchanged."
                      : `The upper bound changed by ${c.difference} ${c.metric}.`}{" "}
                    Input bounds and cost assumptions match.
                  </p>
                ) : (
                  <p className="comparison-warning">
                    Not directly comparable: {c.reasons.join("; ")}. No
                    reduction is claimed.
                  </p>
                )}
              </article>
            );
          })}
          <h3>New findings</h3>
          {comparison.added.length ? (
            comparison.added.slice(0, 100).map((d, i) => (
              <button
                key={i}
                className="comparison-finding"
                onClick={() => onInspect(current!, d.span)}
              >
                {d.code}: {d.message} <span>View current source ↗</span>
              </button>
            ))
          ) : (
            <p>No new findings in this report.</p>
          )}
          <h3>No longer reported</h3>
          {comparison.notReported.length ? (
            comparison.notReported.slice(0, 100).map((d, i) => (
              <button
                key={i}
                className="comparison-finding"
                onClick={() => onInspect(previous!, d.span)}
              >
                {d.code}: {d.message} <span>View previous source ↗</span>
              </button>
            ))
          ) : (
            <p>No findings disappeared from this report.</p>
          )}
        </>
      )}
    </>
  );
}
