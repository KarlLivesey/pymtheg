// SPDX-License-Identifier: MIT
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { graphPageSchema } from "../../src/implementation/protocol";
import {
  implementationComparisonSchema,
  type ImplementationComparison,
} from "../../src/implementation/comparison-protocol";
const bodyLabel: Record<string, string> = {
  present: "Body present",
  unparsed: "Syntax incomplete — body unknown",
  "fail-fast": "Fail-fast stub",
  empty: "Empty body",
  "declaration-only": "Signature only",
};
export function ImplementationReview({
  planId,
  nodeId,
  planRevision,
  codeRevision,
  onAccepted,
  onRefresh,
  onClose,
}: {
  planId: string;
  nodeId: string;
  planRevision: string;
  codeRevision: string;
  onAccepted: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.showModal();
    return () => {
      element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const [result, setResult] = useState<ImplementationComparison | null>(null);
  const [offset, setOffset] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<{
    side: "before" | "after";
    offset: number;
  } | null>(null);
  const [sourcePage, setSourcePage] =
    useState<ReturnType<typeof graphPageSchema.parse>["detail"]>(null);
  useEffect(() => {
    setOffset(0);
    setSource(null);
  }, [planId, nodeId, planRevision, codeRevision]);
  useEffect(() => {
    const abort = new AbortController();
    setResult(null);
    setReviewed(false);
    setError("");
    void api(
      "implementation/compare",
      { planId, nodeId, planRevision, codeRevision, offset, limit: 20 },
      abort.signal,
    )
      .then((raw) => {
        if (!abort.signal.aborted)
          setResult(implementationComparisonSchema.parse(raw));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [planId, nodeId, planRevision, codeRevision, offset]);
  useEffect(() => {
    setSourcePage(null);
    if (!source || !result) return;
    const revision = result[source.side].revision;
    if (!revision) return;
    const abort = new AbortController();
    void api(
      "implementation",
      {
        mode: "existing",
        planRevision,
        codeRevision: revision,
        detailId: nodeId,
        limit: 1,
        characterOffset: source.offset,
      },
      abort.signal,
    )
      .then((raw) => {
        if (!abort.signal.aborted)
          setSourcePage(graphPageSchema.parse(raw).detail);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [source, result, planRevision, nodeId]);
  async function accept() {
    if (!result || !reviewed || !result.reviewAllowed) return;
    setBusy(true);
    setError("");
    try {
      await api("implementation/link", {
        revision: result.activeRevision,
        planId,
        nodeId,
        planHash: result.planHash,
        observationId: result.after.observationId,
        note: result.note,
      });
      await onAccepted();
    } catch (e) {
      setError(String(e));
      setReviewed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="implementation-review-dialog"
      aria-label="Compare linked implementation"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <section
        className="implementation-review-panel"
        aria-label="Review linked code changes"
      >
        <div className="implementation-review-heading">
          <h4>What changed in this link?</h4>
          <button onClick={onClose} disabled={busy}>
            Close comparison
          </button>
        </div>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              disabled={busy}
              onClick={() => void onRefresh().catch((e) => setError(String(e)))}
            >
              Load current versions
            </button>
          </>
        )}
        {!result && !error && (
          <p role="status">Loading retained source comparison…</p>
        )}
        {result && (
          <>
            <section aria-label="Plan being reviewed">
              <h5>{result.plan.name}</h5>
              {result.plan.fields.length ? (
                <dl className="implementation-plan-fields">
                  {result.plan.fields.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>
                        {field.text}
                        {field.truncated && (
                          <em>
                            {" "}
                            (Shortened; open the full plan to read more.)
                          </em>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <pre>{result.plan.text}</pre>
              )}
              {result.plan.truncated && (
                <p>
                  Plan display is shortened. Open the full retained plan before
                  accepting.
                </p>
              )}
            </section>
            <section aria-label="Current design changes">
              <h5>Retained design and current source</h5>
              <p>{result.design.meaning}</p>
              {result.design.issues.map((issue, i) => (
                <p key={i} className="message">
                  {issue.message}
                </p>
              ))}
              {result.design.current.map((entry) => (
                <section key={entry.id}>
                  <h6>{entry.id}</h6>
                  <pre>{entry.source}</pre>
                  <details>
                    <summary>Design source identity</summary>
                    <dl>
                      <dt>File hash</dt>
                      <dd>{entry.fileHash ?? entry.sourceHash}</dd>
                      <dt>Declaration hash</dt>
                      <dd>
                        {entry.declarationHash ??
                          "Unavailable in this response"}
                      </dd>
                    </dl>
                  </details>
                  {entry.truncated && (
                    <p>
                      Current declaration is shortened. Open its source to read
                      more.
                    </p>
                  )}
                </section>
              ))}
            </section>
            <div className="implementation-review-versions">
              {(["before", "after"] as const).map((side) => (
                <section
                  key={side}
                  aria-label={
                    side === "before"
                      ? "Reviewed code version"
                      : "Selected code version"
                  }
                >
                  <h5>
                    {side === "before"
                      ? "Previously reviewed"
                      : "Selected version"}
                  </h5>
                  <strong>
                    {result[side].label ?? "Baseline unavailable"}
                  </strong>
                  <p>{result[side].file}</p>
                  <p>
                    {bodyLabel[result[side].body ?? ""] ??
                      "Declaration unavailable"}
                  </p>
                  {result[side].reason && (
                    <p className="message">{result[side].reason}</p>
                  )}
                  {result[side].signature && (
                    <pre>{result[side].signature}</pre>
                  )}
                  {result[side].signatureTruncated && (
                    <p>
                      Signature display is shortened; inspect the retained
                      source.
                    </p>
                  )}
                  {result[side].available && (
                    <button onClick={() => setSource({ side, offset: 0 })}>
                      Read {side === "before" ? "reviewed" : "selected"} source
                    </button>
                  )}
                  <details>
                    <summary>Source identity</summary>
                    <dl>
                      <dt>Checkpoint</dt>
                      <dd>{result[side].revision ?? "Unavailable"}</dd>
                      <dt>Observation</dt>
                      <dd>{result[side].observationId ?? "Unavailable"}</dd>
                      <dt>File hash</dt>
                      <dd>{result[side].sourceHash ?? "Unavailable"}</dd>
                    </dl>
                  </details>
                </section>
              ))}
            </div>
            <section aria-label="Observed dependency changes">
              <h5>Observed dependency changes</h5>
              <p>{result.dependencies.meaning}</p>
              {!result.dependencies.available ? (
                <p>
                  This comparison has no dependency baseline. Capture and
                  explicitly review a new code version to start tracking it.
                </p>
              ) : (
                <>
                  <p>
                    {result.dependencies.total} changed dependencies
                    {result.dependencies.truncated ? " (first 100 shown)" : ""}.
                  </p>
                  {result.dependencies.items.map((item) => (
                    <details key={item.id}>
                      <summary>
                        {item.name} — {item.change} ({item.file})
                      </summary>
                      <p>Before</p>
                      <pre>{item.before ?? "Not captured"}</pre>
                      <p>After</p>
                      <pre>{item.after ?? "Not captured"}</pre>
                      {item.truncated && (
                        <p>
                          Source excerpt limited to 2,000 characters per side;
                          inspect the retained declaration for the rest.
                        </p>
                      )}
                    </details>
                  ))}
                </>
              )}
            </section>
            {result.source ? (
              <section aria-label="Source changes">
                <h5>Source changes</h5>
                <p>Line numbers start at the beginning of this declaration.</p>
                {result.source.equal ? (
                  <p>
                    {result.source.lineEndingsDiffer
                      ? "Only line endings differ. Original source bytes are retained."
                      : "No source text changes in this declaration."}
                  </p>
                ) : (
                  <>
                    {result.source.lineEndingsNormalized && (
                      <p>
                        Line endings are normalized for this display; original
                        bytes are retained.
                      </p>
                    )}
                    {!result.source.complete && (
                      <p className="message">
                        This is a shortened diff. Read both retained sources
                        before reviewing the full change.{" "}
                        {result.source.omittedBeforeLines} earlier-source lines
                        and {result.source.omittedAfterLines} current-source
                        lines are omitted from the changed region. Individual
                        long lines may also be shortened.
                      </p>
                    )}
                    {result.source.coarse && (
                      <p>
                        Large changed region shown as a replacement; lines are
                        not individually aligned.
                      </p>
                    )}
                    <div
                      className="implementation-diff-scroll"
                      tabIndex={0}
                      aria-label="Scrollable source differences"
                    >
                      <table className="implementation-diff">
                        <thead>
                          <tr>
                            <th>Old line</th>
                            <th>New line</th>
                            <th>Change</th>
                            <th>Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.source.entries.map((row, i) => (
                            <tr key={i} className={`diff-${row.kind}`}>
                              <td>{row.beforeLine ?? "—"}</td>
                              <td>{row.afterLine ?? "—"}</td>
                              <td>
                                {row.kind === "context"
                                  ? "Unchanged"
                                  : row.kind === "added"
                                    ? "Added"
                                    : "Removed"}
                              </td>
                              <td>
                                <code>{row.text || " "}</code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            ) : (
              <p>
                Source comparison is unavailable. The missing evidence above
                must not be read as “unchanged”.
              </p>
            )}
            {source && (
              <section aria-label="Full retained source">
                <h5>
                  {source.side === "before" ? "Reviewed" : "Selected"} source
                </h5>
                {sourcePage ? (
                  <>
                    <pre>{sourcePage.text}</pre>
                    <p>
                      Characters {sourcePage.characterOffset + 1}–
                      {sourcePage.characterOffset + sourcePage.text.length} of{" "}
                      {sourcePage.totalCharacters}
                    </p>
                    <button
                      disabled={source.offset === 0}
                      onClick={() =>
                        setSource({
                          ...source,
                          offset: Math.max(0, source.offset - 12000),
                        })
                      }
                    >
                      Previous source page
                    </button>
                    <button
                      disabled={sourcePage.nextOffset === null}
                      onClick={() =>
                        setSource({ ...source, offset: sourcePage.nextOffset! })
                      }
                    >
                      Next source page
                    </button>
                  </>
                ) : (
                  <p role="status">Loading source…</p>
                )}
              </section>
            )}
            {result.relationships && (
              <section aria-label="Relationship changes">
                <h5>Relationship changes</h5>
                <p>{result.relationships.meaning}</p>
                {!result.relationships.coverageComplete && (
                  <p className="message">
                    Relationship coverage is incomplete. No listed difference
                    does not mean no relationship changed.
                  </p>
                )}
                <ul>
                  {result.relationships.items.map((edge, i) => (
                    <li key={i}>
                      <strong>
                        {edge.kind}: {edge.target}
                      </strong>{" "}
                      — {edge.beforeCount} → {edge.afterCount}{" "}
                      {edge.kind === "references"
                        ? "observed dependency pairs"
                        : "source sites"}
                      {edge.resolution === "unresolved"
                        ? " (target unresolved)"
                        : ""}
                      {edge.displayTruncated ? " (name shortened)" : ""}
                    </li>
                  ))}
                </ul>
                {!result.relationships.total && (
                  <p>No observed relationship changes.</p>
                )}
                <div className="version-pages">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    Previous relationships
                  </button>
                  <span>
                    {result.relationships.total} changed relationships
                  </span>
                  <button
                    disabled={result.relationships.nextOffset === null}
                    onClick={() => setOffset(result.relationships!.nextOffset!)}
                  >
                    More relationships
                  </button>
                </div>
              </section>
            )}
            {!!result.note && (
              <p>
                <strong>Retained reason for this link:</strong> {result.note}
              </p>
            )}
            <p>{result.meaning}</p>
            <label className="implementation-review">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!result.reviewAllowed || busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed this plan and the selected code version
            </label>
            <button
              className="button primary"
              disabled={!reviewed || !result.reviewAllowed || busy}
              onClick={() => void accept()}
            >
              Accept this version for this link
            </button>
            {!result.reviewAllowed && (
              <p>
                Review acceptance requires the current plan and latest
                consistent code capture. Historical comparisons remain
                read-only.
              </p>
            )}
          </>
        )}
      </section>
    </dialog>
  );
}
