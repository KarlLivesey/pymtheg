import { sourceFileName } from "../../src/shared/identity-values";
import { useEffect, useState, useRef, useCallback } from "react";
import type { z } from "zod";
import type { PlanItem } from "../../src/architecture/schema";
import {
  sourceContractPageSchema,
  sourceContractDetailSchema,
  sourceSelectionSchema,
} from "../../src/shared/source-contracts";
import { api } from "./api";

type Page = z.infer<typeof sourceContractPageSchema>;
type Detail = z.infer<typeof sourceContractDetailSchema>;
export function SourcePlanLinks({
  item,
  revision,
  onChange,
  onOpenSource,
  onBusyChange,
}: {
  item: PlanItem;
  revision: string;
  onChange: (item: PlanItem) => void;
  onOpenSource?: ((file: string) => void) | undefined;
  onBusyChange?: ((busy: boolean) => void) | undefined;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [reviewChecks, setReviewChecks] = useState<
    Record<string, { snapshotId: string; available: boolean | null }>
  >({});
  const onReviewableChange = useCallback(
    (id: string, snapshotId: string, available: boolean | null) => {
      setReviewChecks((checks) => ({
        ...checks,
        [id]: { snapshotId, available },
      }));
    },
    [],
  );
  const itemRef = useRef(item);
  itemRef.current = item;
  const [selecting, setSelecting] = useState(false);
  const readChoice = async (
    snapshotId: string,
    targets: string[],
    signal?: AbortSignal,
  ) =>
    sourceSelectionSchema.parse(
      await api(
        "architecture/source-selection",
        { snapshotId, targets },
        signal,
      ),
    );
  const [query, setQuery] = useState("");
  const [finderOpen, setFinderOpen] = useState(
    () => !item.links.some((link) => link.target.startsWith("source:")),
  );
  useEffect(() => {
    setFinderOpen(
      !item.links.some((link) => link.target.startsWith("source:")),
    );
  }, [item.id]);
  const [scopeFile, setScopeFile] = useState("");
  const [repairTarget, setRepairTarget] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [request, setRequest] = useState({
    query: "",
    offset: 0,
    snapshot: "",
    generation: 0,
    file: "",
    browseAll: false,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const cancel = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      q: request.query,
      offset: String(request.offset),
      limit: "10",
    });
    if (request.snapshot) params.set("snapshotId", request.snapshot);
    else if (request.file) params.set("file", request.file);
    else if (
      !request.browseAll &&
      item.links.some((l) => l.target.startsWith("source:"))
    )
      params.set(
        "targets",
        JSON.stringify(
          item.links
            .filter((l) => l.target.startsWith("source:"))
            .map((l) => l.target),
        ),
      );
    void api(
      "architecture/source-contracts?" + params,
      undefined,
      cancel.signal,
    )
      .then(async (value) => {
        const next = sourceContractPageSchema.parse(value);
        setPage(next);
        if (request.generation > 0 && !request.snapshot && !request.file) {
          const targets = itemRef.current.links
            .filter(
              (link) =>
                link.target.startsWith("source:") &&
                (!itemRef.current.sourceExpectations?.[link.target] ||
                  !!itemRef.current.sourceSelections?.[link.target]),
            )
            .map((link) => link.target);
          const choices = await Promise.all(
            targets.map(
              async (target) =>
                [
                  target,
                  await readChoice(next.snapshotId, [target], cancel.signal),
                ] as const,
            ),
          );
          if (!cancel.signal.aborted)
            onChange({
              ...itemRef.current,
              sourceSelections: {
                ...itemRef.current.sourceSelections,
                ...Object.fromEntries(choices),
              },
              sourceSelectionSnapshot: undefined,
              sourceReviewSnapshot: undefined,
              sourceReviewSelection: undefined,
            });
        }
      })
      .catch((e) => {
        if (!cancel.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!cancel.signal.aborted) setLoading(false);
      });
    return () => cancel.abort();
  }, [request]);
  const links = item.links.filter((l) => l.target.startsWith("source:"));
  const reviewable =
    !!page &&
    links.every(
      (link) =>
        reviewChecks[link.target]?.snapshotId === page.snapshotId &&
        reviewChecks[link.target]?.available === true,
    );
  const unavailable =
    !!page &&
    links.some(
      (link) =>
        reviewChecks[link.target]?.snapshotId === page.snapshotId &&
        reviewChecks[link.target]?.available === false,
    );
  useEffect(() => {
    onBusyChange?.(selecting || (loading && links.length > 0));
    return () => onBusyChange?.(false);
  }, [selecting, loading, links.length, onBusyChange]);
  return (
    <section className="source-plan-links" aria-label="Link checked source">
      <h3>Connect to a checked component</h3>
      <p>
        Link the actual function, type or flow this plan concerns. Later changes
        to it or its dependencies will need review. A link does not prove the
        requirement.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={loading || selecting}
        onClick={() =>
          setRequest((r) => ({
            query,
            offset: 0,
            snapshot: "",
            generation: r.generation + 1,
            file: "",
            browseAll: !!repairTarget,
          }))
        }
      >
        Refresh checked components
      </button>
      {loading && <p role="status">Checking saved source…</p>}
      {selecting && <p role="status">Keeping the selected source details…</p>}
      {error && <p role="alert">{error}</p>}
      {repairTarget && (
        <p role="status">
          Choose a replacement for {repairTarget}. Compare both sources below;
          your saved link stays unchanged until you replace it and save.
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setRepairTarget(null);
              setReplacement(null);
            }}
          >
            Cancel replacement
          </button>
        </p>
      )}
      <details
        open={finderOpen || !!repairTarget}
        onToggle={(event) => setFinderOpen(event.currentTarget.open)}
      >
        <summary>Choose a source component</summary>
        <details>
          <summary>Choose a source file in a large project</summary>
          <label>
            Source file path
            <input
              className="text-input"
              value={scopeFile}
              placeholder={sourceFileName("design/payments")}
              onChange={(e) => setScopeFile(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={loading || !scopeFile.trim()}
            onClick={() =>
              setRequest((r) => ({
                query: "",
                offset: 0,
                snapshot: "",
                generation: r.generation + 1,
                file: scopeFile.trim(),
                browseAll: !!repairTarget,
              }))
            }
          >
            Load source file
          </button>
        </details>
        <label>
          Find a source component
          <input
            className="text-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Component name or source file"
          />
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={() =>
            setRequest((r) => ({
              ...r,
              query,
              offset: 0,
              snapshot: page?.snapshotId ?? "",
            }))
          }
        >
          Find components
        </button>
        {page && !loading && (
          <>
            {!page.complete && (
              <p role="status">
                This source check has scope limits or incomplete information.
                These choices do not establish a passing check.{" "}
                {page.notices.map((n) => `${n.file}: ${n.message}`).join(" ")}
              </p>
            )}
            {!page.total && (
              <p>
                No matching source components. Create a design in the source
                workspace, save it, then refresh these choices.
              </p>
            )}
            {page.items.map((entry) => (
              <div className="source-link-choice" key={entry.id}>
                <div>
                  <code>{entry.signature}</code>
                  <p>
                    {entry.file} ·{" "}
                    {entry.modelStatus === "checked"
                      ? "Typed source"
                      : entry.modelStatus}
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    entry.modelStatus === "ambiguous" ||
                    selecting ||
                    loading ||
                    item.links.some((l) => l.target === entry.id)
                  }
                  onClick={() => {
                    if (repairTarget) {
                      setReplacement(entry.id);
                      return;
                    }
                    setSelecting(true);
                    setError("");
                    void readChoice(page.snapshotId, [entry.id])
                      .then((choice) => {
                        const latest = itemRef.current;
                        if (
                          latest.links.some((link) => link.target === entry.id)
                        )
                          return;
                        onChange({
                          ...latest,
                          sourceSelectionSnapshot: undefined,
                          sourceSelections: {
                            ...latest.sourceSelections,
                            [entry.id]: choice,
                          },
                          links: [
                            ...latest.links,
                            { kind: "depends-on", target: entry.id },
                          ],
                        });
                      })
                      .catch((error) => setError(String(error)))
                      .finally(() => setSelecting(false));
                  }}
                >
                  {repairTarget ? "Compare " : "Link "}
                  {entry.name}
                </button>
              </div>
            ))}
            <p>
              {page.total
                ? `${page.offset + 1}–${page.offset + page.items.length} of ${page.total} matching components`
                : ""}
            </p>
            {page.offset > 0 && (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setRequest((r) => ({
                    ...r,
                    offset: Math.max(0, page.offset - 10),
                    snapshot: page.snapshotId,
                  }))
                }
              >
                Previous components
              </button>
            )}
            {page.nextOffset !== null && (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setRequest((r) => ({
                    ...r,
                    offset: page.nextOffset!,
                    snapshot: page.snapshotId,
                  }))
                }
              >
                More components
              </button>
            )}
          </>
        )}
      </details>
      {page &&
        links.map((link) => (
          <SourcePlanLink
            key={link.target}
            id={link.target}
            page={page}
            revision={revision}
            item={item}
            onReviewableChange={onReviewableChange}
            onOpenSource={onOpenSource}
            onFindReplacement={() => {
              setRepairTarget(link.target);
              setReplacement(null);
              setRequest((r) => ({
                ...r,
                query: "",
                offset: 0,
                snapshot: "",
                file: "",
                generation: 0,
                browseAll: true,
              }));
            }}
            onPreviewReplacement={(candidate) => {
              setRepairTarget(link.target);
              setReplacement(candidate);
            }}
          />
        ))}
      {repairTarget && replacement && page && (
        <section aria-label="Compare source replacement">
          <h4>Proposed replacement</h4>
          <p>
            Compare this source with the retained source above. A matching shape
            does not establish that it is the same component.
          </p>
          <SourcePlanLink
            id={replacement}
            page={page}
            revision={revision}
            item={item}
            onOpenSource={onOpenSource}
            showDependencies={false}
          />
          <button
            type="button"
            className="button primary"
            disabled={
              loading ||
              selecting ||
              item.links.some((l) => l.target === replacement)
            }
            onClick={() => {
              setSelecting(true);
              setError("");
              const old = repairTarget,
                next = replacement;
              void readChoice(page.snapshotId, [next])
                .then((choice) => {
                  const latest = itemRef.current;
                  if (!latest.links.some((l) => l.target === old))
                    throw Error(
                      "The original link changed. Select a replacement again.",
                    );
                  onChange({
                    ...latest,
                    links: latest.links.map((l) =>
                      l.target === old ? { ...l, target: next } : l,
                    ),
                    sourceSelections: {
                      ...latest.sourceSelections,
                      [next]: choice,
                    },
                    sourceReviewSelection: undefined,
                    sourceReviewSnapshot: undefined,
                  });
                  setRepairTarget(null);
                  setReplacement(null);
                })
                .catch((e) => setError(String(e)))
                .finally(() => setSelecting(false));
            }}
          >
            Replace source link
          </button>
        </section>
      )}
      {!!links.length && page && (
        <>
          {unavailable && (
            <p role="status">
              A linked component is missing, ambiguous, or could not be checked.
              Remove or replace missing links before reviewing the current
              source. You can save the record with its historical links without
              a new source review.
            </p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={loading || selecting || !!error || !reviewable}
            onClick={() => {
              const targets = itemRef.current.links
                .filter((link) => link.target.startsWith("source:"))
                .map((link) => link.target);
              setSelecting(true);
              setError("");
              void readChoice(page.snapshotId, targets)
                .then((choice) => {
                  const latest = itemRef.current;
                  const currentTargets = latest.links
                    .filter((link) => link.target.startsWith("source:"))
                    .map((link) => link.target);
                  if (
                    JSON.stringify(currentTargets) !== JSON.stringify(targets)
                  )
                    throw Error(
                      "Links changed during review; inspect the current links and review again.",
                    );
                  onChange({
                    ...latest,
                    sourceReviewSelection: choice,
                    sourceReviewSnapshot: undefined,
                    sourceSelectionSnapshot: undefined,
                  });
                })
                .catch((error) => setError(String(error)))
                .finally(() => setSelecting(false));
            }}
          >
            I reviewed these source components and dependencies
          </button>
          {item.sourceReviewSelection && (
            <p>
              Source review is ready to save. Saving rechecks that this source
              has not changed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function SourcePlanLink({
  id,
  page,
  revision,
  item,
  onOpenSource,
  showDependencies = true,
  onFindReplacement,
  onPreviewReplacement,
  onReviewableChange,
}: {
  id: string;
  page: Page;
  revision: string;
  item: PlanItem;
  onOpenSource?: ((file: string) => void) | undefined;
  showDependencies?: boolean;
  onFindReplacement?: (() => void) | undefined;
  onPreviewReplacement?: ((id: string) => void) | undefined;
  onReviewableChange?:
    | ((id: string, snapshotId: string, available: boolean | null) => void)
    | undefined;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState("");
  const [inspecting, setInspecting] = useState<string | null>(null);
  const changes = detail?.changedDependencies ?? [];
  useEffect(() => {
    const cancel = new AbortController();
    setDetail(null);
    setError("");
    onReviewableChange?.(id, page.snapshotId, null);
    void api(
      "architecture/source-contract",
      {
        id,
        snapshotId: page.snapshotId,
        revision: revision || undefined,
        expectations: item.sourceExpectations,
        sourceHashes: item.sourceHashes,
      },
      cancel.signal,
    )
      .then((value) => {
        const next = sourceContractDetailSchema.parse(value);
        setDetail(next);
        onReviewableChange?.(
          id,
          page.snapshotId,
          !!next.current && next.current.modelStatus !== "ambiguous",
        );
      })
      .catch((e) => {
        if (!cancel.signal.aborted) {
          setError(String(e));
          onReviewableChange?.(id, page.snapshotId, false);
        }
      });
    return () => cancel.abort();
  }, [
    id,
    page.snapshotId,
    revision,
    item.sourceExpectations,
    item.sourceHashes,
    onReviewableChange,
  ]);
  return (
    <section className="source-plan-card" aria-label={`Source link ${id}`}>
      <h4>{id.slice(id.lastIndexOf("#") + 1)}</h4>
      <p className="source-plan-location">{id.slice(7, id.lastIndexOf("#"))}</p>
      {error && <p role="alert">{error}</p>}
      {detail && (
        <>
          {!detail.current && (
            <div>
              <p role="alert">
                This component is unavailable in the checked source. If it was
                renamed or moved, find its replacement and compare both versions
                before changing this link.
              </p>
              {onFindReplacement && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={onFindReplacement}
                >
                  Find a renamed or moved component
                </button>
              )}
              {detail.replacements.length > 0 && (
                <section aria-label="Suggested source replacements">
                  <p>{detail.replacementScope}</p>
                  {detail.replacements.map((candidate) => (
                    <div key={candidate.id}>
                      <code>{candidate.signature}</code>
                      <p>
                        {candidate.file} · {candidate.reason}
                      </p>
                      {onPreviewReplacement && (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => onPreviewReplacement(candidate.id)}
                        >
                          Compare with {candidate.name}
                        </button>
                      )}
                    </div>
                  ))}
                  {detail.replacementCount > detail.replacements.length && (
                    <p>
                      Showing {detail.replacements.length} of{" "}
                      {detail.replacementCount} suggestions. Use the component
                      search to inspect other candidates.
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
          {!!changes.length && (
            <p role="status">
              This component or a current dependency changed since this plan was
              saved: {changes.join(", ")}
            </p>
          )}
          {detail.dependencyPaths.map((path) => (
            <p key={path.target}>
              Why this affects this component: {path.truncated ? "… → " : ""}
              {path.via
                .map((id) => id.slice(id.lastIndexOf("#") + 1))
                .join(" → ")}
              {path.truncated ? " (path shortened)" : ""}
            </p>
          ))}
          {showDependencies &&
            changes
              .filter((target) => target !== id)
              .map((target) => (
                <button
                  key={target}
                  className="text-link"
                  type="button"
                  onClick={() => setInspecting(target)}
                >
                  Inspect {target}
                </button>
              ))}
          {showDependencies && inspecting && (
            <SourcePlanLink
              id={inspecting}
              page={page}
              revision={revision}
              item={item}
              onOpenSource={onOpenSource}
              showDependencies={false}
            />
          )}
          {detail.recorded &&
            detail.current?.source === detail.recorded.source &&
            !!changes.length && (
              <p>
                The displayed declaration text is unchanged. Inspect the changed
                dependency or binding above before accepting the new design.
              </p>
            )}
          {detail.current && (
            <>
              <p>
                Current saved source · {detail.current.file} ·{" "}
                {detail.current.modelStatus === "checked"
                  ? "Typed source"
                  : detail.current.modelStatus}
              </p>
              <pre>{detail.current.source}</pre>
              {detail.current.sourceTruncated && (
                <p>
                  Source preview shortened. Open the file to read the complete
                  component.
                </p>
              )}
              {onOpenSource && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => onOpenSource(detail.current!.file)}
                >
                  Open {detail.current.file} in source editor
                </button>
              )}
            </>
          )}
          {detail.recorded && (
            <details>
              <summary>
                {detail.recordedAtReview
                  ? "Source when this plan was last reviewed"
                  : "Previously retained source (exact review version unavailable)"}
              </summary>
              <pre>{detail.recorded.source}</pre>
              {detail.recorded.sourceTruncated && (
                <p>Recorded source preview shortened.</p>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
