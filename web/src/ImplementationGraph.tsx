// SPDX-License-Identifier: MIT
import { ImplementationReview } from "./ImplementationReview";
import { VersionPicker } from "./VersionPicker";
import type { ImplementationDraft } from "../../src/studio/implementation-draft";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api } from "./api";
import { ImplementationFilePicker } from "./ImplementationFilePicker";
import {
  graphPageSchema,
  type GraphPage,
} from "../../src/implementation/protocol";
const version = z.object({
  id: z.string(),
  label: z.string(),
  created: z.string(),
});
const versionsSchema = z.object({
  activeRevision: z.string().nullable(),
  plans: z.array(version),
  observations: z.array(version),
  total: z.number(),
  observationTotal: z.number(),
  offset: z.number(),
  nextOffset: z.number().nullable(),
});
const statusLabels: Record<string, string> = {
  unlinked: "No code linked",
  missing: "Linked code missing",
  unknown: "Coverage unknown",
  unparsed: "Syntax incomplete — body unknown",
  "declaration-only": "Signature only",
  empty: "Empty body",
  "fail-fast": "Fail-fast stub",
  "body-present": "Body present",
  present: "Body present",
  "plan-changed": "Plan changed",
  "design-changed": "Design changed",
  "design-missing": "Linked design missing",
  "design-unknown": "Current design unknown",
  "code-changed": "Code changed",
  "dependency-changed": "Dependency changed",
};
function statusText(
  item: {
    statuses?: string[] | undefined;
    status?: string | undefined;
    body?: string | null | undefined;
    kind?: string | undefined;
  },
  compact = false,
) {
  const values = item.statuses?.length
    ? item.statuses
    : [item.status ?? item.body ?? item.kind ?? "unknown"];
  const labels = values.map((s) => statusLabels[s] ?? s);
  return compact && labels.length > 1
    ? `${labels[0]} +${labels.length - 1} more`
    : labels.join(" + ");
}
export function ImplementationGraph({
  runId,
  onChanged,
  drafts = [],
  onDrafts,
  recoverySaved = false,
}: {
  runId?: string | undefined;
  onChanged: () => void;
  drafts?: ImplementationDraft[];
  onDrafts?: ((drafts: ImplementationDraft[]) => void) | undefined;
  recoverySaved?: boolean;
}) {
  const [versions, setVersions] = useState<z.infer<
    typeof versionsSchema
  > | null>(null);
  const [planVersion, setPlanVersion] = useState("");
  const [codeVersion, setCodeVersion] = useState("");
  const [mode, setMode] = useState<"planned" | "existing" | "gaps">("gaps");
  const [page, setPage] = useState<GraphPage | null>(null);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState("");
  const [inspectedLink, setInspectedLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState("");
  const [label, setLabel] = useState("Working implementation");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [codeChoices, setCodeChoices] = useState<GraphPage["items"]>([]);
  const [codeSearch, setCodeSearch] = useState("");
  const [codeOffset, setCodeOffset] = useState(0);
  const [codeNext, setCodeNext] = useState<number | null>(null);
  const draft = drafts.find((d) => d.planId === selected);
  const linkTarget = draft?.nodeId ?? "";
  const note = draft?.note ?? "";
  const pendingSelection = useRef<string | null>(null);
  const recordList = useRef<HTMLDivElement>(null);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const [planDetail, setPlanDetail] = useState<GraphPage["detail"]>(null);
  const [codeDetail, setCodeDetail] = useState<GraphPage["detail"]>(null);
  const [reviewed, setReviewed] = useState(false);
  const [detailOffset, setDetailOffset] = useState(0);
  const [candidateOffset, setCandidateOffset] = useState(0);
  async function reloadVersions() {
    const next = versionsSchema.parse(await api("implementation/versions"));
    setVersions(next);
    setPlanVersion((v) => v || next.activeRevision || "");
    setCodeVersion((v) => v || next.observations[0]?.id || "");
    return next;
  }
  useEffect(() => {
    void reloadVersions().catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (!versions?.activeRevision) return;
    const abort = new AbortController();
    setError("");
    void api(
      "implementation",
      {
        mode,
        query,
        offset,
        limit: 20,
        ...(planVersion ? { planRevision: planVersion } : {}),
        ...(codeVersion ? { codeRevision: codeVersion } : {}),
      },
      abort.signal,
    )
      .then((raw) => {
        if (!abort.signal.aborted) setPage(graphPageSchema.parse(raw));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [
    versions?.activeRevision,
    planVersion,
    codeVersion,
    mode,
    query,
    offset,
    refresh,
  ]);
  useEffect(() => {
    setSelected("");
  }, [mode, planVersion, codeVersion]);
  const item = page?.items.find((i) => i.id === selected);
  useEffect(() => {
    setInspectedLink("");
    setDetailOffset(0);
    setPlanDetail(null);
    setReviewed(false);
  }, [selected, mode, planVersion, codeVersion]);
  useEffect(() => {
    setCandidateOffset(0);
    setCodeDetail(null);
    setReviewed(false);
  }, [linkTarget, codeVersion]);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    void api(
      "implementation",
      {
        mode,
        planRevision: planVersion,
        ...(codeVersion ? { codeRevision: codeVersion } : {}),
        limit: 1,
        detailId: selected,
        characterOffset: detailOffset,
      },
      abort.signal,
    )
      .then((raw) => {
        if (!abort.signal.aborted)
          setPlanDetail(graphPageSchema.parse(raw).detail);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [selected, mode, planVersion, codeVersion, detailOffset]);
  useEffect(() => {
    if (!linkTarget || !codeVersion) return;
    const abort = new AbortController();
    void api(
      "implementation",
      {
        mode: "existing",
        planRevision: planVersion,
        codeRevision: codeVersion,
        limit: 1,
        detailId: linkTarget,
        characterOffset: candidateOffset,
      },
      abort.signal,
    )
      .then((raw) => {
        if (!abort.signal.aborted)
          setCodeDetail(graphPageSchema.parse(raw).detail);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [linkTarget, codeVersion, planVersion, candidateOffset]);
  const currentPage =
    !!page &&
    page.planRevision === planVersion &&
    page.mode === mode &&
    page.offset === offset &&
    page.query === query &&
    (!codeVersion || page.codeRevision === codeVersion);
  useEffect(() => {
    if (!item || mode === "existing" || !codeVersion) return;
    const abort = new AbortController();
    void api(
      "implementation",
      {
        mode: "existing",
        query: codeSearch,
        offset: codeOffset,
        limit: 20,
        codeRevision: codeVersion,
        ...(planVersion ? { planRevision: planVersion } : {}),
      },
      abort.signal,
    )
      .then((raw) => {
        const result = graphPageSchema.parse(raw);
        if (!abort.signal.aborted) {
          setCodeChoices(result.items);
          setCodeNext(result.nextOffset);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [selected, codeSearch, codeOffset, codeVersion, mode, planVersion]);
  function editLink(
    patch: Partial<Pick<ImplementationDraft, "nodeId" | "note">>,
  ) {
    if (!item || !page || !onDrafts) return;
    if (!draft && drafts.length >= 100) {
      setError(
        "There are 100 unfinished links. Finish or discard one before starting another.",
      );
      return;
    }
    const next: ImplementationDraft = {
      planId: item.id,
      planName: item.name,
      planHash: item.planHash ?? "",
      planRevision: page.planRevision,
      codeRevision: page.codeRevision ?? "",
      observationId: page.observationId ?? "",
      nodeId: "",
      note: "",
      ...draft,
      ...patch,
    };
    onDrafts([...drafts.filter((d) => d.planId !== item.id), next]);
  }
  function discardDraft(planId: string) {
    onDrafts?.(drafts.filter((d) => d.planId !== planId));
    setReviewed(false);
  }
  useEffect(() => {
    if (!currentPage || !pendingSelection.current) return;
    const target = pendingSelection.current;
    if (page?.items.some((i) => i.id === target)) {
      setSelected(target);
      Array.from(
        recordList.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-record-id]",
        ) ?? [],
      )
        .find((button) => button.dataset.recordId === target)
        ?.focus();
      pendingSelection.current = null;
    }
  }, [page, currentPage]);
  async function capture() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const receipt = z
        .object({
          storage: z.object({
            newBytes: z.number(),
            reusedBytes: z.number(),
            newParts: z.number(),
            reusedParts: z.number(),
          }),
        })
        .parse(
          await api("implementation/observe", {
            files: files
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
            label,
            expectedRevision: versions?.activeRevision ?? null,
            ...(runId ? { runId } : {}),
          }),
        );
      const v = await reloadVersions();
      setPlanVersion(v.activeRevision ?? "");
      setCodeVersion(v.observations[0]?.id ?? "");
      setCaptureOpen(false);
      setRefresh((r) => r + 1);
      onChanged();
      setMessage(
        `Code version retained: ${receipt.storage.newBytes.toLocaleString()} new bytes; ${receipt.storage.reusedBytes.toLocaleString()} bytes reused. Review a plan record and choose its code declaration to link them.`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function link() {
    if (!page || !item) return;
    setBusy(true);
    setError("");
    try {
      await api("implementation/link", {
        revision: page.activeRevision,
        planId: item.id,
        planHash: item.planHash,
        nodeId: linkTarget,
        observationId: page.observationId,
        note,
      });
      discardDraft(item.id);
      const v = await reloadVersions();
      setPlanVersion(v.activeRevision ?? "");
      setRefresh((r) => r + 1);
      onChanged();
      setMessage(
        "Link saved. Code presence is recorded separately from correctness evidence.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function unlink(nodeId: string) {
    if (!page || !item) return;
    setBusy(true);
    setError("");
    try {
      await api("implementation/unlink", {
        revision: page.activeRevision,
        planId: item.id,
        nodeId,
      });
      const next = await reloadVersions();
      setPlanVersion(next.activeRevision ?? "");
      setRefresh((value) => value + 1);
      onChanged();
      setMessage(
        "That link was removed. Other declarations and earlier versions are preserved.",
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const scoped = page?.items.slice(0, 12) ?? [];
  const choose = (id: string) => {
    setSelected(id);
    setCodeOffset(0);
    setCodeSearch("");
  };
  const positions = new Map(
    scoped.map((n, i) => [
      n.id,
      { x: 24 + (i % 3) * 242, y: 30 + Math.floor(i / 3) * 118 },
    ]),
  );
  const scopedEdges = (page?.edges ?? [])
    .filter((e) => e.to && positions.has(e.from) && positions.has(e.to))
    .slice(0, 36);
  return (
    <section
      className="implementation-workspace"
      aria-label="Planned and existing system"
    >
      <div className="implementation-heading">
        <div>
          <h2>Plan, code and the gap between them</h2>
          <p>
            Keep named versions of what you intend and what exists. Links are
            explicit; a body of code is not proof of correct behaviour.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => setCaptureOpen((v) => !v)}
          disabled={busy || !versions}
        >
          Capture code version
        </button>
      </div>
      {!!drafts.length && (
        <section
          className="message"
          aria-label="Unfinished implementation links"
        >
          <h3>Unfinished links</h3>
          <p role="status">
            {recoverySaved
              ? "Link drafts saved locally."
              : "Saving link drafts locally…"}{" "}
            Review source again before saving a link.
          </p>
          {drafts.map((saved) => (
            <div key={saved.planId}>
              <button
                className="text-link"
                onClick={() => {
                  pendingSelection.current = saved.planId;
                  setMode("gaps");
                  setQuery(saved.planId);
                  setOffset(0);
                  setPlanVersion(versions?.activeRevision ?? "");
                  setCodeVersion(versions?.observations[0]?.id ?? "");
                  setRefresh((r) => r + 1);
                }}
              >
                Resume link: {saved.planName}
              </button>
              <button
                className="text-link"
                onClick={() => discardDraft(saved.planId)}
              >
                Discard link draft: {saved.planName}
              </button>
            </div>
          ))}
        </section>
      )}
      {captureOpen && (
        <form
          className="implementation-capture"
          onSubmit={(e) => {
            e.preventDefault();
            void capture();
          }}
        >
          <h3>Observe existing source</h3>
          <p>
            Read selected TypeScript or JavaScript files without running them.
            Other language readers are not available yet.
          </p>
          <label>
            Version name
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={160}
            />
          </label>
          <ImplementationFilePicker value={files} onChange={setFiles} />
          <label>
            Source files, one project-relative path per line
            <textarea
              value={files}
              onChange={(e) => setFiles(e.target.value)}
              placeholder={"src/service.ts\nsrc/main.ts"}
              required
              rows={4}
            />
          </label>
          {runId && (
            <p>
              The currently checked design snapshot will be retained with this
              version.
            </p>
          )}
          <button
            className="button primary"
            disabled={busy || !versions || !files.trim()}
          >
            {busy ? "Capturing…" : "Read files and retain version"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="message">
          {message}
        </p>
      )}
      {!versions ? (
        <p role="status">Loading retained versions…</p>
      ) : !versions.activeRevision ? (
        <div className="implementation-empty">
          <h3>Start with the plan</h3>
          <p>
            Add a requirement or create a design first. When code exists,
            capture it here and link its declarations to your plan.
          </p>
          <p>
            You can also capture an existing project's source now; no
            implementation is invented for an empty project.
          </p>
        </div>
      ) : (
        <>
          <div className="implementation-controls">
            <button
              className="button secondary"
              onClick={() =>
                void reloadVersions()
                  .then(() => setRefresh((n) => n + 1))
                  .catch((e) => setError(String(e)))
              }
            >
              Refresh versions
            </button>
            <VersionPicker
              kind="plan"
              value={planVersion}
              onChange={(id) => {
                setPlanVersion(id);
                setOffset(0);
              }}
              refresh={`${refresh}:${versions.activeRevision}`}
            />
            <VersionPicker
              kind="code"
              value={codeVersion}
              onChange={(id) => {
                setCodeVersion(id);
                setOffset(0);
              }}
              refresh={`${refresh}:${versions.activeRevision}`}
            />
          </div>
          <div
            className="implementation-tabs"
            role="group"
            aria-label="System graph view"
          >
            {(
              [
                ["planned", "Planned system"],
                ["existing", "Existing code"],
                ["gaps", "Implementation gaps"],
              ] as const
            ).map(([id, title]) => (
              <button
                className="button secondary"
                key={id}
                aria-pressed={mode === id}
                onClick={() => {
                  setMode(id);
                  setOffset(0);
                }}
              >
                {title}
              </button>
            ))}
          </div>
          {!currentPage && (
            <p role="status">
              {error
                ? "No results are available for this selection."
                : "Loading the selected snapshots…"}
            </p>
          )}
          {page && currentPage && (
            <>
              <div className="implementation-counts">
                {Object.entries(page.counts)
                  .filter(([, n]) => n > 0)
                  .map(([s, n]) => (
                    <span key={s}>
                      <b>{n}</b> {statusLabels[s] ?? s}
                    </span>
                  ))}
              </div>
              {mode !== "existing" && (
                <p className="implementation-boundary">
                  Counts show every condition; one record can appear in more
                  than one count.
                </p>
              )}
              <p className="implementation-boundary">
                {page.coverage
                  ? `Code declaration coverage: ${page.coverage.declarations}. Relationship coverage: ${page.coverage.relationships}.`
                  : "No code observed for this comparison."}{" "}
                {page.meaning}
              </p>
              <details className="implementation-limits">
                <summary>Observation limits</summary>
                <ul>
                  {page.limitations.map((limit, i) => (
                    <li key={i}>{limit}</li>
                  ))}
                </ul>
              </details>
              <label className="implementation-search">
                Find a record or declaration
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <div className="implementation-layout">
                <div>
                  <details className="implementation-diagram" open>
                    <summary>
                      {mode === "gaps"
                        ? `This page · ${scoped.length} planned records · ${scoped.reduce((total, n) => total + (n.linkCount ?? 0), 0)} explicit code links`
                        : `Graph of this page · ${scoped.length} nodes · ${scopedEdges.length} visible connections`}
                    </summary>
                    <div
                      className="implementation-canvas"
                      tabIndex={0}
                      role="region"
                      aria-label="Scrollable system diagram"
                    >
                      {mode === "gaps" ? (
                        <svg
                          viewBox={`0 0 750 ${Math.max(155, scoped.length * 108 + 45)}`}
                          role="group"
                          aria-label="Plan to code links; equivalent details are in the selectable list below"
                        >
                          <text x="24" y="23" fontSize="14" fill="#385d68">
                            PLANNED
                          </text>
                          <text x="438" y="23" fontSize="14" fill="#385d68">
                            EXISTING CODE
                          </text>
                          {scoped.map((n, i) => (
                            <g
                              key={n.id}
                              role="button"
                              tabIndex={0}
                              aria-label={`Inspect ${n.name}`}
                              onClick={() => choose(n.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  choose(n.id);
                                }
                              }}
                              transform={`translate(0 ${40 + i * 108})`}
                            >
                              <rect
                                x="20"
                                width="266"
                                height="78"
                                rx="9"
                                fill={selected === n.id ? "#d7efea" : "white"}
                                stroke="#87aea8"
                              />
                              <text x="32" y="29" fontSize="15" fill="#173f49">
                                <title>{n.name}</title>
                                {n.name.length > 27
                                  ? n.name.slice(0, 26) + "…"
                                  : n.name}
                              </text>
                              <text x="32" y="54" fontSize="13" fill="#45636e">
                                <title>{statusText(n)}</title>
                                {statusText(n, true)}
                              </text>
                              <line
                                x1="287"
                                y1="39"
                                x2="427"
                                y2="39"
                                stroke={n.code ? "#468c7f" : "#aabfc5"}
                                strokeDasharray={n.code ? undefined : "5 4"}
                              />
                              <rect
                                x="428"
                                width="298"
                                height="78"
                                rx="9"
                                fill={n.code ? "#eef6f4" : "#f5f7f8"}
                                stroke="#bacdd2"
                                strokeDasharray={n.code ? undefined : "5 4"}
                              />
                              <text x="440" y="29" fontSize="15" fill="#173f49">
                                <title>
                                  {n.codeLinks
                                    ?.map((link) => link.name)
                                    .join(", ") ??
                                    n.code?.name ??
                                    "No confirmed code link"}
                                </title>
                                {(n.linkCount ?? 0) > 1
                                  ? `${n.linkCount} linked declarations`
                                  : n.code
                                    ? n.code.name.length > 28
                                      ? n.code.name.slice(0, 27) + "…"
                                      : n.code.name
                                    : "No confirmed code link"}
                              </text>
                              <text x="440" y="54" fontSize="12" fill="#45636e">
                                {(n.linkCount ?? 0) > 1
                                  ? "Select the record to inspect each link"
                                  : n.code
                                    ? n.code.file.length > 33
                                      ? n.code.file.slice(0, 32) + "…"
                                      : n.code.file
                                    : "Review and link a declaration"}
                              </text>
                            </g>
                          ))}
                        </svg>
                      ) : (
                        <svg
                          viewBox={`0 0 750 ${Math.max(160, Math.ceil(scoped.length / 3) * 118 + 30)}`}
                          role="group"
                          aria-label={`${mode} graph; the selectable record list below provides the same nodes`}
                        >
                          <defs>
                            <marker
                              id="implementation-arrow"
                              viewBox="0 0 10 10"
                              refX="9"
                              refY="5"
                              markerWidth="6"
                              markerHeight="6"
                              orient="auto"
                            >
                              <path d="M 0 0 L 10 5 L 0 10 z" fill="#7b969e" />
                            </marker>
                          </defs>
                          {scopedEdges.map((edge, i) => {
                            const a = positions.get(edge.from)!,
                              b = positions.get(edge.to!)!;
                            return (
                              <line
                                key={i}
                                x1={a.x + 105}
                                y1={a.y + 72}
                                x2={b.x + 105}
                                y2={b.y}
                                stroke="#7b969e"
                                strokeWidth="1.5"
                                markerEnd="url(#implementation-arrow)"
                              />
                            );
                          })}
                          {scoped.map((n) => {
                            const p = positions.get(n.id)!;
                            return (
                              <g
                                key={n.id}
                                role="button"
                                tabIndex={0}
                                aria-label={`Inspect ${n.name}`}
                                onClick={() => choose(n.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    choose(n.id);
                                  }
                                }}
                                transform={`translate(${p.x} ${p.y})`}
                              >
                                <rect
                                  width="210"
                                  height="74"
                                  rx="9"
                                  fill={selected === n.id ? "#d7efea" : "white"}
                                  stroke={
                                    selected === n.id ? "#187366" : "#b4c9cf"
                                  }
                                  strokeWidth="2"
                                />
                                <text
                                  x="12"
                                  y="28"
                                  fontSize="15"
                                  fill="#163e49"
                                >
                                  {n.name.length > 23
                                    ? n.name.slice(0, 22) + "…"
                                    : n.name}
                                </text>
                                <text
                                  x="12"
                                  y="52"
                                  fontSize="12"
                                  fill="#48616b"
                                >
                                  <title>{statusText(n)}</title>
                                  {statusText(n, true)}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      )}
                    </div>
                    <p>
                      Connections outside these nodes are retained in the
                      selected record's relationship list. Use search and pages
                      to explore the full graph.
                    </p>
                  </details>
                  <div
                    className="implementation-list"
                    ref={recordList}
                    role="list"
                    aria-label="System records"
                  >
                    {page.items.map((n) => (
                      <div role="listitem" key={n.id}>
                        <button
                          disabled={busy || !currentPage}
                          className={selected === n.id ? "selected" : ""}
                          data-record-id={n.id}
                          onClick={() => {
                            setSelected(n.id);
                            setCodeOffset(0);
                            setCodeSearch("");
                          }}
                        >
                          <strong>{n.name}</strong>
                          <span>
                            {statusText(n)}
                            {!!n.linkCount &&
                              ` · ${n.linkCount} link${n.linkCount === 1 ? "" : "s"}`}
                          </span>
                          <small>{n.id}</small>
                        </button>
                      </div>
                    ))}
                  </div>
                  {!page.items.length && (
                    <p>No matching records in this version and scope.</p>
                  )}
                  <div className="implementation-pagination">
                    <button
                      className="button secondary"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 20))}
                    >
                      Previous
                    </button>
                    <span>
                      {page.total
                        ? `${offset + 1}–${offset + page.items.length}`
                        : "0"}{" "}
                      of {page.total}
                    </span>
                    <button
                      className="button secondary"
                      disabled={page.nextOffset === null}
                      onClick={() => setOffset(page.nextOffset!)}
                    >
                      Next
                    </button>
                  </div>
                </div>
                <aside
                  className="implementation-detail"
                  aria-label="Selected implementation record"
                >
                  {item ? (
                    <>
                      <span className="eyebrow">{item.kind}</span>
                      <h3>{item.name}</h3>
                      <p>
                        {item.reason ?? `Observed ${item.body} in ${item.file}`}
                      </p>
                      <code>{item.id}</code>
                      {!!item.codeLinks?.length && (
                        <section aria-label="Linked implementation declarations">
                          <h4>Linked code ({item.linkCount})</h4>
                          <ol className="implementation-linked-code">
                            {item.codeLinks.map((link) => (
                              <li key={link.nodeId}>
                                <strong>{link.name}</strong>
                                <span>
                                  {statusText(link)} · {link.file}
                                </span>
                                <p>{link.reason}</p>
                                <button
                                  className="text-link"
                                  onClick={() => setInspectedLink(link.nodeId)}
                                >
                                  Inspect this code
                                </button>
                                <button
                                  className="text-link"
                                  disabled={
                                    busy || planVersion !== page.activeRevision
                                  }
                                  onClick={() => void unlink(link.nodeId)}
                                  aria-label={`Remove implementation link to ${link.name}`}
                                >
                                  Remove this link
                                </button>
                              </li>
                            ))}
                          </ol>
                          {item.linkCount! > item.codeLinks.length && (
                            <p>
                              Showing the first {item.codeLinks.length} retained
                              links.
                            </p>
                          )}
                        </section>
                      )}
                      {inspectedLink && mode !== "existing" && codeVersion && (
                        <ImplementationReview
                          key={
                            selected +
                            ":" +
                            inspectedLink +
                            ":" +
                            planVersion +
                            ":" +
                            codeVersion
                          }
                          planId={selected}
                          nodeId={inspectedLink}
                          planRevision={planVersion}
                          codeRevision={codeVersion}
                          onClose={() => setInspectedLink("")}
                          onRefresh={async () => {
                            pendingSelection.current = selected;
                            const next = await reloadVersions();
                            setInspectedLink("");
                            setPlanVersion(next.activeRevision ?? "");
                            setCodeVersion(next.observations[0]?.id ?? "");
                            setRefresh((r) => r + 1);
                            setMessage(
                              "Current versions loaded. Reopen the link comparison to review them; your unfinished draft is retained.",
                            );
                          }}
                          onAccepted={async () => {
                            pendingSelection.current = selected;
                            const next = await reloadVersions();
                            setPlanVersion(next.activeRevision ?? "");
                            setRefresh((r) => r + 1);
                            onChanged();
                            setMessage(
                              "Reviewed this link. Other links and unfinished drafts are unchanged.",
                            );
                          }}
                        />
                      )}
                      {planDetail?.id === selected && (
                        <section aria-label="Retained plan or code source">
                          <h4>
                            {mode === "existing"
                              ? "Observed code"
                              : "Retained plan"}
                          </h4>
                          {planDetail.fields ? (
                            <>
                              <dl className="implementation-plan-fields">
                                {planDetail.fields.map((field) => (
                                  <div key={field.label}>
                                    <dt>{field.label}</dt>
                                    <dd>
                                      {field.text}
                                      {field.truncated && (
                                        <em>
                                          {" "}
                                          (Shortened; full content below.)
                                        </em>
                                      )}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                              <details>
                                <summary>Original planning record</summary>
                                <pre>{planDetail.text}</pre>
                              </details>
                            </>
                          ) : (
                            <pre>{planDetail.text}</pre>
                          )}
                          <p>
                            {planDetail.characterOffset + 1}–
                            {planDetail.characterOffset +
                              planDetail.text.length}{" "}
                            of {planDetail.totalCharacters} characters
                          </p>
                          <button
                            disabled={detailOffset === 0}
                            onClick={() =>
                              setDetailOffset(Math.max(0, detailOffset - 12000))
                            }
                          >
                            Previous source
                          </button>
                          <button
                            disabled={planDetail.nextOffset === null}
                            onClick={() =>
                              setDetailOffset(planDetail.nextOffset!)
                            }
                          >
                            More source
                          </button>
                        </section>
                      )}
                      {(item.signature || item.code?.signature) && (
                        <pre>{item.signature ?? item.code?.signature}</pre>
                      )}
                      <h4>Connections on this page</h4>
                      <ul>
                        {page.edges
                          .filter((e) => e.from === item.id || e.to === item.id)
                          .slice(0, 30)
                          .map((e, i) => (
                            <li key={i}>
                              {e.kind} {e.from === item.id ? "to" : "from"}:{" "}
                              {e.from === item.id
                                ? (e.toName ??
                                  e.to ??
                                  e.targetName ??
                                  "Unnamed target")
                                : (e.fromName ?? e.from)}
                              {e.unresolved &&
                                " (not resolved in this capture)"}
                              {e.targetKind &&
                                e.targetKind !== "project" &&
                                ` · ${e.targetKind.replaceAll("-", " ")}`}
                            </li>
                          ))}
                      </ul>
                      {page.edges.filter(
                        (e) => e.from === item.id || e.to === item.id,
                      ).length > 30 && (
                        <p>
                          Showing 30 of{" "}
                          {
                            page.edges.filter(
                              (e) => e.from === item.id || e.to === item.id,
                            ).length
                          }{" "}
                          connections for this record on this page. Full
                          relationships remain in the captured graph export.
                        </p>
                      )}
                      {page.edgesTruncated && (
                        <p>
                          Only {page.edges.length} of {page.edgeCount} page
                          connections are shown.
                        </p>
                      )}
                      {mode !== "existing" && (
                        <div className="implementation-link-form">
                          <h4>Link to observed code</h4>
                          <p>
                            Review both definitions. Similar names do not
                            establish a link.
                          </p>
                          <label>
                            Search code declarations
                            <input
                              value={codeSearch}
                              onChange={(e) => {
                                setCodeSearch(e.target.value);
                                setCodeOffset(0);
                              }}
                            />
                          </label>
                          <label>
                            Observed declaration
                            <select
                              aria-label="Observed declaration"
                              value={linkTarget}
                              onChange={(e) =>
                                editLink({ nodeId: e.target.value })
                              }
                            >
                              <option value="">Choose a declaration…</option>
                              {linkTarget &&
                                !codeChoices.some(
                                  (c) => c.id === linkTarget,
                                ) && (
                                  <option value={linkTarget}>
                                    Saved selection · {linkTarget}
                                  </option>
                                )}
                              {codeChoices.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} · {c.file}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div>
                            <button
                              disabled={codeOffset === 0}
                              onClick={() =>
                                setCodeOffset(Math.max(0, codeOffset - 20))
                              }
                            >
                              Previous declarations
                            </button>
                            <button
                              disabled={codeNext === null}
                              onClick={() => setCodeOffset(codeNext!)}
                            >
                              More declarations
                            </button>
                          </div>
                          {codeChoices.find((c) => c.id === linkTarget) && (
                            <pre>
                              {
                                codeChoices.find((c) => c.id === linkTarget)!
                                  .signature
                              }
                            </pre>
                          )}
                          {codeDetail?.id === linkTarget && (
                            <section aria-label="Candidate code source">
                              <h4>Observed source to review</h4>
                              <pre>{codeDetail.text}</pre>
                              <p>
                                {codeDetail.characterOffset + 1}–
                                {codeDetail.characterOffset +
                                  codeDetail.text.length}{" "}
                                of {codeDetail.totalCharacters} characters
                              </p>
                              <button
                                disabled={candidateOffset === 0}
                                onClick={() =>
                                  setCandidateOffset(
                                    Math.max(0, candidateOffset - 12000),
                                  )
                                }
                              >
                                Previous code
                              </button>
                              <button
                                disabled={codeDetail.nextOffset === null}
                                onClick={() =>
                                  setCandidateOffset(codeDetail.nextOffset!)
                                }
                              >
                                More code
                              </button>
                            </section>
                          )}
                          {draft &&
                            (draft.planHash !== item.planHash ||
                              draft.observationId !== page.observationId) && (
                              <p className="message">
                                The plan or observed code changed since this
                                draft began. Your reason is retained; review the
                                current source and choose a current declaration
                                before saving.
                              </p>
                            )}
                          <label>
                            Reason for this link
                            <textarea
                              value={note}
                              onChange={(e) =>
                                editLink({ note: e.target.value })
                              }
                              maxLength={2000}
                              rows={3}
                            />
                          </label>
                          <label className="implementation-review">
                            <input
                              type="checkbox"
                              checked={reviewed}
                              onChange={(e) => setReviewed(e.target.checked)}
                              disabled={
                                planDetail?.id !== selected ||
                                codeDetail?.id !== linkTarget
                              }
                            />
                            I reviewed the plan and this observed source
                          </label>
                          <button
                            className="button primary"
                            disabled={
                              busy ||
                              !reviewed ||
                              !page.linkAllowed ||
                              !linkTarget ||
                              planVersion !== page.activeRevision ||
                              !page.observationId
                            }
                            onClick={() => void link()}
                          >
                            Save explicit link
                          </button>
                          {!page.linkAllowed && (
                            <p>
                              Choose the current plan and latest code version
                              before saving a link. Historical versions remain
                              available for comparison.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <h3>Inspect a connection</h3>
                      <p>
                        Select a record from the list to see its source
                        identity, relationships and implementation gap.
                      </p>
                    </>
                  )}
                </aside>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
