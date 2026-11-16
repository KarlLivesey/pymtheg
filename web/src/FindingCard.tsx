// SPDX-License-Identifier: MIT
import type {
  ExplainedFinding,
  SourceLocation,
} from "../../src/reporting/explain";
import type { Span } from "../../src/shared/identity";
const place = (s: SourceLocation) =>
  `${s.file.split("/").at(-1)}${s.line === null ? " (location not recorded)" : ":" + s.line}${s.column === null ? "" : ":" + s.column}`;
export function FindingCard({
  finding,
  onJump,
}: {
  finding: ExplainedFinding;
  onJump: (span: Span) => void;
}) {
  return (
    <article className={`finding-card ${finding.severity}`}>
      <span className="finding-symbol" aria-hidden="true">
        {finding.severity === "error"
          ? "!"
          : finding.severity === "warning"
            ? "△"
            : "i"}
      </span>
      <div className="finding-body">
        <button className="finding-open" onClick={() => onJump(finding.span)}>
          <span className="finding-topline">
            <b>{finding.code}</b>
            <span>
              {finding.severity === "error"
                ? "Needs attention"
                : finding.severity === "warning"
                  ? "Worth reviewing"
                  : "Information"}
            </span>
          </span>
          <strong>{finding.title}</strong>
          <span className="finding-problem">{finding.message}</span>
          <small>
            {place(finding.location)}
            {finding.path.length
              ? " · " + finding.path.map((s) => s.split("#").at(-1)).join(" → ")
              : ""}{" "}
            ↗
          </small>
        </button>
        <p className="finding-why">{finding.why}</p>
        <details className="finding-details">
          <summary>What to do next &amp; evidence</summary>
          <h4>What to consider</h4>
          <p>{finding.nextStep}</p>
          <h4>Source</h4>
          {finding.location.excerpt ? (
            <pre>{finding.location.excerpt}</pre>
          ) : (
            <p>No source excerpt is available for this location.</p>
          )}
          {finding.relatedLocations.length > 0 && (
            <>
              <h4>Related declarations</h4>
              <ul>
                {finding.relatedLocations.slice(0, 10).map((s, i) => (
                  <li key={i}>
                    <button className="text-link" onClick={() => onJump(s)}>
                      {place(s)} ↗
                    </button>
                    {s.excerpt && <pre>{s.excerpt}</pre>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>What the evidence says</h4>
          <p>{finding.evidenceNote}</p>
        </details>
      </div>
    </article>
  );
}
