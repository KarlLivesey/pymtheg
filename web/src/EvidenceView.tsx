import { useMemo, useState } from "react";
import type { Report } from "../../src/reporting/report";
import type { SymbolView } from "../../src/studio/protocol";
import type { Span } from "../../src/shared/identity";
import { outcomeLabel, propertyLabel } from "../../src/reporting/status";
import { displayProjectPaths } from "../../src/shared/display-paths";
export function EvidenceView({
  report,
  symbols,
  onJump,
  projectRoot,
}: {
  report: Report | null;
  symbols: SymbolView[];
  onJump: (span: Span) => void;
  projectRoot: string;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const rows = useMemo(() => {
    const list = (report?.results ?? []).filter(
      (r) =>
        (filter === "all" ||
          (filter === "unresolved" && r.completion !== "complete") ||
          (filter === "problems" && r.outcome === "counterexample") ||
          (filter === "finished" && r.completion === "complete")) &&
        `${r.propertyId} ${r.analysisKind} ${r.outstandingObligations.join(" ")} ${r.assumptions.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    return [...list].sort(
      (a, b) =>
        Number(b.outcome === "counterexample") -
          Number(a.outcome === "counterexample") ||
        Number(a.completion === "complete") -
          Number(b.completion === "complete") ||
        a.propertyId.localeCompare(b.propertyId),
    );
  }, [report, query, filter]);
  const owners = useMemo(
    () => new Map(symbols.map((s) => [s.id, s])),
    [symbols],
  );
  return (
    <>
      <div className="view-intro">
        <h2>Know what was actually checked</h2>
        <p>
          Each claim keeps its method, scope, assumptions and unresolved work. A
          finished check is not a proof of the whole program.
        </p>
        <details>
          <summary>What do the methods mean?</summary>
          <ul>
            <li>
              Structural checks inspect declared signatures, control flow and
              contracts.
            </li>
            <li>
              Conservative analysis can identify a possible risk that needs
              closer investigation.
            </li>
            <li>Simulation samples runs within its recorded limits.</li>
            <li>
              Finite checking explores the selected model. It does not cover
              larger or different models.
            </li>
          </ul>
        </details>
      </div>
      <div className="filter-bar">
        <input
          className="search"
          aria-label="Search evidence"
          placeholder="Search a component, assumption or unresolved decision…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Evidence status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All checks</option>
          <option value="unresolved">Unresolved checks</option>
          <option value="problems">Problems found</option>
          <option value="finished">Finished checks</option>
        </select>
      </div>
      <p className="muted">
        {rows.length} matching checks
        {rows.length > 200 ? " · showing the first 200" : ""}
      </p>
      {rows.slice(0, 200).map((r) => {
        const hash = r.propertyId.lastIndexOf("#"),
          end = r.propertyId.indexOf("/", hash),
          owner = owners.get(
            end < 0 ? r.propertyId : r.propertyId.slice(0, end),
          ),
          span = r.diagnostics[0]?.span ?? owner?.span;
        return (
          <article className="evidence-card" key={r.propertyId}>
            <h3>{propertyLabel(r)}</h3>
            <div className="badge-row">
              <span
                className={`badge ${r.completion !== "complete" ? "pending" : ""}`}
              >
                {outcomeLabel(r)}
              </span>
              <span className="badge">{r.method.replaceAll("_", " ")}</span>
            </div>
            {span && (
              <button className="text-link" onClick={() => onJump(span)}>
                Open related source ↗
              </button>
            )}
            {r.outstandingObligations.length > 0 && (
              <>
                <h4>Still to resolve</h4>
                <ul className="obligations">
                  {r.outstandingObligations.slice(0, 20).map((o, i) => (
                    <li key={i}>{displayProjectPaths(o, projectRoot)}</li>
                  ))}
                </ul>
                {r.outstandingObligations.length > 20 && (
                  <p>More obligations are retained in the exported report.</p>
                )}
              </>
            )}
            <details>
              <summary>Scope, assumptions and provenance</summary>
              <p>
                Snapshot <code>{r.scope.snapshotHash.slice(0, 12)}</code>
              </p>
              <pre>{JSON.stringify(r.scope.bounds ?? {}, null, 2)}</pre>
              {r.scope.seed && <p>Seed: {r.scope.seed}</p>}
              <ul>
                {r.assumptions.slice(0, 30).map((a, i) => (
                  <li key={i}>{displayProjectPaths(a, projectRoot)}</li>
                ))}
              </ul>
              {r.assumptions.length > 30 && (
                <p>More assumptions are retained in the exported report.</p>
              )}
              <p>
                {Object.entries(r.toolVersions)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}
              </p>
            </details>
          </article>
        );
      })}
      {!rows.length && (
        <div className="empty-state">
          <h3>No matching checks</h3>
          <p>Change the search or status filter to inspect other evidence.</p>
        </div>
      )}
    </>
  );
}
