// SPDX-License-Identifier: MIT
import { identity as publicIdentity } from "../../src/shared/identity-values";
import type { ImplementationDraft } from "../../src/studio/implementation-draft";
import { BranchWithdrawals } from "./BranchWithdrawals";
import { ImplementationGraph } from "./ImplementationGraph";
import { DocumentReader } from "./DocumentReader";
import { acknowledgementPageSchema } from "../../src/architecture/acknowledgements";
import { branchReview } from "../../src/architecture/branches";
import { ImportConflicts } from "./ImportConflicts";
import {
  folderInventory,
  withImportInventory,
} from "../../src/architecture/import-policy";
import { proposeContractChange } from "../../src/architecture/planning";
import { decodeUtf8 } from "../../src/shared/text";
import { useArchitectureDraft } from "./useArchitectureDraft";
import { useEffect, useMemo, useState, useRef } from "react";
import { ArchitectureConflictReview } from "./ArchitectureConflictReview";
import { api, ApiError } from "./api";
import { PlanEditor } from "./PlanEditor";
import {
  revisionSchema,
  importPreviewSchema,
  impactSchema,
  workIssuesSchema,
  type importSourceSchema,
  planItemSchema,
  type PlanItem,
  overviewSchema,
  differenceSchema,
  searchSchema,
  searchPageSchema,
  entitySchema,
  documentSchema,
  type ArchitectureEntity,
  type ArchitectureIndex,
} from "../../src/architecture/schema";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const status = (s: string) => s.replaceAll("_", " ").replaceAll("-", " ");
interface Detail {
  entity: ArchitectureEntity;
  data: unknown;
  dependents: string[];
  impact: import("zod").infer<typeof impactSchema>;
}
export function ArchitectureView({
  refresh = 0,
  onOpenSource,
  checkedRunId,
  implementationDrafts = [],
  onImplementationDrafts,
  recoverySaved = false,
}: {
  refresh?: number;
  onOpenSource?: ((file: string) => void) | undefined;
  checkedRunId?: string | undefined;
  implementationDrafts?: ImplementationDraft[];
  onImplementationDrafts?:
    | ((drafts: ImplementationDraft[]) => void)
    | undefined;
  recoverySaved?: boolean;
} = {}) {
  const [implementationOpen, setImplementationOpen] = useState(false);
  const draft = useArchitectureDraft();
  const [workLoading, setWorkLoading] = useState(false);
  const [workRevision, setWorkRevision] = useState<string | null>(null);
  const [workError, setWorkError] = useState("");
  const [workRetry, setWorkRetry] = useState(0);
  const [work, setWork] = useState<
    import("zod").infer<typeof workIssuesSchema>
  >([]);
  const [naming, setNaming] = useState(false),
    [versionName, setVersionName] = useState("");
  const [documentConflict, setDocumentConflict] = useState(false);
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const [draftBase, setDraftBase] = useState("");
  const [activeRevision, setActiveRevision] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [branchAudit, setBranchAudit] = useState<
    import("zod").infer<typeof acknowledgementPageSchema> | null
  >(null);
  const [sources, setSources] = useState<
    import("zod").infer<typeof importSourceSchema>[]
  >([]);
  const [refreshSource, setRefreshSource] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const [historyPreview, setHistoryPreview] = useState<{
    token: string;
    revisions: number;
    documents: number;
    hasDraft: boolean;
    keepsCurrent: boolean;
  } | null>(null);
  const [importPreview, setImportPreview] = useState<
    import("zod").infer<typeof importPreviewSchema> | null
  >(null);
  const [index, setIndex] = useState<ArchitectureIndex | null>(null),
    [overviewPending, setOverviewPending] = useState(true),
    [revisions, setRevisions] = useState<
      import("zod").infer<typeof revisionSchema>[]
    >([]),
    [queries, setQueries] = useState<Record<string, string>>({}),
    [owner, setOwner] = useState(""),
    [kind, setKind] = useState(""),
    [stateFilter, setStateFilter] = useState(""),
    [conflictsOnly, setConflictsOnly] = useState(false),
    [view, setView] = useState("records"),
    [detail, setDetail] = useState<Detail | null>(null),
    [openedDocument, setDocument] = useState<{
      path: string;
      text: string;
      fragment?: string;
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [label, setLabel] = useState("Architecture snapshot"),
    [files, setFiles] = useState<File[]>([]),
    [folderMode, setFolderMode] = useState(false),
    [editing, setEditing] = useState(false),
    [createOnly, setCreateOnly] = useState(true),
    [path, setPath] = useState("notes/decision.md"),
    [text, setText] = useState(
      "# New decision\n\nStatus: proposed\n\nReason and consequences:\n",
    ),
    [baseline, setBaseline] = useState(""),
    [difference, setDifference] = useState<
      import("zod").infer<typeof differenceSchema> | null
    >(null);
  const query = queries[view] ?? "";
  const setQuery = (value: string) =>
    setQueries((previous) => ({ ...previous, [view]: value }));
  useEffect(() => {
    setImportPreview(null);
    setHistoryPreview(null);
  }, [files, label, folderMode, refreshSource, sourceName]);
  const folderSelection = useMemo(() => {
    if (!folderMode || !files.length) return null;
    try {
      const root = files[0]!.webkitRelativePath.split("/")[0];
      if (
        !root ||
        files.some(
          (file) =>
            !file.webkitRelativePath.includes("/") ||
            file.webkitRelativePath.split("/")[0] !== root,
        )
      )
        throw Error("Choose one folder, or switch to individual files.");
      const candidates = files.map((file) => ({
        file,
        path: file.webkitRelativePath.split("/").slice(1).join("/"),
      }));
      const inventory = folderInventory(
          candidates.map(({ file, path }) => ({ path, bytes: file.size })),
          sources.find((source) => source.id === refreshSource)?.selection,
        ),
        included = new Set(inventory.included);
      return {
        kind: "ready" as const,
        root,
        inventory,
        selected: candidates.filter((item) => included.has(item.path)),
      };
    } catch (error) {
      return { kind: "error" as const, message: String(error) };
    }
  }, [files, folderMode, sources, refreshSource]);
  const [visibleCount, setVisibleCount] = useState(100);
  const [impactCount, setImpactCount] = useState(30);
  useEffect(
    () => setVisibleCount(100),
    [query, owner, kind, stateFilter, view, index?.id],
  );
  const [planTarget, setPlanTarget] = useState<
    | { document: string; originalId: string; itemIndex?: number | undefined }
    | undefined
  >();
  const [planning, setPlanning] = useState(false),
    [planInitial, setPlanInitial] = useState<PlanItem | undefined>();
  const loading = useRef<AbortController | null>(null);
  const selection = useRef<AbortController | null>(null);
  const comparison = useRef<AbortController | null>(null);
  async function load(revision?: string) {
    loading.current?.abort();
    selection.current?.abort();
    comparison.current?.abort();
    const request = new AbortController();
    loading.current = request;
    setDetail(null);
    setDocument(null);
    setDifference(null);
    setBaseline("");
    setOverviewPending(true);
    try {
      const data = overviewSchema.parse(
        await api(
          "architecture" +
            (revision ? "?revision=" + encodeURIComponent(revision) : ""),
          undefined,
          request.signal,
        ),
      );
      if (request.signal.aborted) return data;
      selection.current?.abort();
      setIndex(data.index);
      setRevisions(data.revisions);
      setActiveRevision(data.activeRevision ?? data.index?.id ?? "");
      setSources(data.sources ?? []);
      return data;
    } finally {
      if (!request.signal.aborted) setOverviewPending(false);
    }
  }
  useEffect(() => {
    void load().catch((e) => {
      if (e.name !== "AbortError") setError(String(e));
    });
    return () => {
      loading.current?.abort();
      selection.current?.abort();
      comparison.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (editing && draft.ready)
      draft.persist({
        kind: "document",
        createOnly,
        baseRevision: draftBase,
        label,
        document: { path, text },
      });
  }, [editing, path, text, label, draft.ready, draftBase, createOnly]);
  useEffect(() => {
    if (!index || view !== "work") return;
    const controller = new AbortController();
    setWork([]);
    setWorkRevision(null);
    setWorkError("");
    setWorkLoading(true);
    void api(
      "architecture/work?revision=" + index.id,
      undefined,
      controller.signal,
    )
      .then((raw) => {
        if (!controller.signal.aborted) {
          setWork(workIssuesSchema.parse(raw));
          setWorkRevision(index.id);
          setWorkLoading(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setWorkError(String(error));
          setWorkRevision(index.id);
          setWorkLoading(false);
        }
      });
    return () => controller.abort();
  }, [index?.id, view, workRetry]);
  const owners = useMemo(() => {
    const result = new Map<string, number>();
    for (const e of index?.entities ?? [])
      if (e.kind !== "owner")
        result.set(e.owner, (result.get(e.owner) ?? 0) + 1);
    return [...result].sort(([a], [b]) => a.localeCompare(b));
  }, [index]);
  const entities = useMemo(
    () =>
      (index?.entities ?? []).filter(
        (e) =>
          e.kind !== "owner" &&
          (!owner || e.owner === owner) &&
          (kind ? e.kind === kind : e.kind !== "document") &&
          (!stateFilter || e.status === stateFilter) &&
          (!conflictsOnly || !!e.conflictOf) &&
          `${e.name} ${e.key} ${e.summary} ${e.status} ${e.searchText ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [index, owner, kind, query, stateFilter, conflictsOnly],
  );
  const conflictCount = new Set(
    index?.entities.filter((e) => e.conflictOf).map((e) => e.conflictOf) ?? [],
  ).size;
  const planningEntities = (index?.entities ?? []).filter((e) =>
    e.id.startsWith("plan:"),
  );
  const importedSections = (index?.entities ?? []).filter(
    (e) => e.kind === "heading",
  );
  const selectedRevision = revisions.find((r) => r.id === index?.id);
  const branchCandidates = branchReview(revisions, activeRevision);
  const otherBranches = branchCandidates.filter(
    (b) => b.lineage === "recorded" && !b.reviewed,
  );
  const unknownHistory = branchCandidates.filter(
    (b) => b.lineage === "unknown",
  );
  const displayedBranch = branchCandidates.find(
    (b) => b.id === index?.id && b.lineage === "recorded",
  );
  useEffect(() => {
    setBranchAudit(null);
    if (!displayedBranch) return;
    const controller = new AbortController();
    void api(
      "architecture/review-history?revision=" +
        encodeURIComponent(displayedBranch.id),
      undefined,
      controller.signal,
    )
      .then((raw) => {
        if (!controller.signal.aborted)
          setBranchAudit(acknowledgementPageSchema.parse(raw));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [selectedRevision]);
  const planningDocuments = new Set(
    (index?.entities ?? []).filter((e) => e.planning).map((e) => e.document),
  );
  const designDocumentCount = (index?.entities ?? []).filter(
    (e) => e.kind === "document" && !planningDocuments.has(e.document),
  ).length;
  const hasContracts = (index?.entities ?? []).some(
    (e) => e.kind === "function" || e.kind === "type",
  );
  function clearFilters() {
    selection.current?.abort();
    setOwner("");
    setKind("");
    setStateFilter("");
    setConflictsOnly(false);
    setQuery("");
    setDetail(null);
  }
  const workspaceFiles = (index?.documents ?? []).filter(
    (d) => d.path.startsWith(".pymtheg") || planningDocuments.has(d.path),
  );
  const workspacePaths = new Set(workspaceFiles.map((d) => d.path));
  const docs = (index?.documents ?? []).filter(
    (d) =>
      !workspacePaths.has(d.path) &&
      d.path.toLowerCase().includes(query.toLowerCase()),
  );
  const [documentMatches, setDocumentMatches] = useState<
    import("zod").infer<typeof searchSchema>
  >([]);
  const [documentTotal, setDocumentTotal] = useState<number | null>(null);
  const [documentNext, setDocumentNext] = useState<number | null>(null);
  const [searchPending, setSearchPending] = useState(false);
  const [workspaceFileLimit, setWorkspaceFileLimit] = useState(100);
  const searchRequest = useRef<AbortController | null>(null);
  async function searchDocuments(offset: number) {
    if (!index) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearchPending(true);
    try {
      const result = searchPageSchema.parse(
        await api(
          "architecture/search-page?revision=" +
            index.id +
            "&q=" +
            encodeURIComponent(query) +
            "&offset=" +
            offset,
          undefined,
          controller.signal,
        ),
      );
      if (!controller.signal.aborted) {
        setDocumentMatches((previous) =>
          offset === 0 ? result.matches : [...previous, ...result.matches],
        );
        setDocumentTotal(result.total);
        setDocumentNext(result.nextOffset);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(String(error));
    } finally {
      if (!controller.signal.aborted) setSearchPending(false);
    }
  }
  useEffect(() => {
    setDocumentMatches([]);
    setDocumentTotal(null);
    setDocumentNext(null);
    searchRequest.current?.abort();
    setSearchPending(false);
    if (!index || view !== "documents" || !query.trim()) return;
    void searchDocuments(0);
    return () => searchRequest.current?.abort();
  }, [index?.id, view, query]);
  const visibleDocuments = query.trim()
    ? documentMatches.map((m) => ({
        ...m,
        bytes: index?.documents.find((d) => d.path === m.path)?.bytes ?? 0,
      }))
    : docs.map((d) => ({ ...d, snippet: "" }));
  const matchCount =
    view === "records"
      ? entities.length
      : query.trim()
        ? documentTotal
        : visibleDocuments.length;
  const byId = useMemo(
    () => new Map(index?.entities.map((e) => [e.id, e]) ?? []),
    [index],
  );
  async function inspect(id: string, selectedIndex = index) {
    if (!selectedIndex) return;
    selection.current?.abort();
    const request = new AbortController();
    selection.current = request;
    try {
      setError("");
      const raw = await api(
        "architecture/record?revision=" +
          selectedIndex.id +
          "&id=" +
          encodeURIComponent(id),
        undefined,
        request.signal,
      );
      if (
        !object(raw) ||
        !Object.hasOwn(raw, "data") ||
        !Array.isArray(raw.dependents) ||
        !raw.dependents.every((v) => typeof v === "string")
      )
        throw Error("Invalid architecture record response");
      if (request.signal.aborted) return;
      setImpactCount(30);
      setDetail({
        entity: entitySchema.parse(raw.entity),
        data: raw.data,
        dependents: raw.dependents as string[],
        impact: impactSchema.parse(raw.impact),
      });
      setDocument(null);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(String(e));
    }
  }
  async function openDocument(name: string, fragment = "") {
    if (!index) return;
    selection.current?.abort();
    const request = new AbortController();
    selection.current = request;
    try {
      const doc = documentSchema.parse(
        await api(
          "architecture/document?revision=" +
            index.id +
            "&path=" +
            encodeURIComponent(name),
          undefined,
          request.signal,
        ),
      );
      if (request.signal.aborted) return;
      setDocument({ ...doc, fragment });
      setDetail(null);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(String(e));
    }
  }
  async function importFiles(
    resolutions: import("zod").infer<
      typeof import("../../src/architecture/schema").importResolutionSchema
    >[] = [],
  ) {
    setBusy(true);
    setError("");
    try {
      let selected = files.map((file) => ({ file, path: file.name }));
      if (folderMode) {
        if (folderSelection?.kind !== "ready")
          throw Error(folderSelection?.message ?? "Choose a folder first");
        selected = folderSelection.selected;
      } else {
        if (
          files.length > 4096 ||
          files.reduce((n, f) => n + f.size, 0) > 70 * 1024 * 1024
        )
          throw Error(
            "Select at most 4,096 files and 70 MiB of uploaded data.",
          );
        if (files.length > 1 && files.some((f) => f.size > 16 * 1024 * 1024))
          throw Error("Each architecture document must be at most 16 MiB.");
      }
      let documents = await Promise.all(
        selected.map(async ({ file, path }) => ({
          path,
          text: decodeUtf8(await file.arrayBuffer(), file.name),
        })),
      );
      if (folderMode && folderSelection?.kind === "ready")
        documents = withImportInventory(
          documents,
          folderSelection.root,
          folderSelection.inventory.excluded,
          refreshSource || "upload:" + uploadId,
        );
      let bundle: unknown;
      let history: unknown;
      if (
        !folderMode &&
        documents.length === 1 &&
        documents[0]!.path.toLowerCase().endsWith(".json")
      ) {
        try {
          const candidate: unknown = JSON.parse(
            documents[0]!.text.replace(/^\uFEFF/, ""),
          );
          if (
            object(candidate) &&
            [
              "pymtheg.architecture-bundle/v1",
              "pymtheg.architecture-bundle/v2",
              "pymtheg.architecture-bundle/v3",
            ].includes(String(candidate.schema))
          )
            bundle = candidate;
          if (
            object(candidate) &&
            [
              "pymtheg.architecture-history/v1",
              "pymtheg.architecture-history/v2",
              "pymtheg.architecture-history/v3",
            ].includes(String(candidate.schema))
          )
            history = candidate;
        } catch {
          /* Plain documents can include invalid JSON. */
        }
      }
      if (history) {
        const raw = await api("architecture/history-preview", history);
        if (
          !object(raw) ||
          typeof raw.token !== "string" ||
          typeof raw.revisions !== "number" ||
          typeof raw.documents !== "number" ||
          typeof raw.hasDraft !== "boolean" ||
          typeof raw.keepsCurrent !== "boolean"
        )
          throw Error("Invalid history preview");
        setHistoryPreview({
          token: raw.token,
          revisions: raw.revisions,
          documents: raw.documents,
          hasDraft: raw.hasDraft,
          keepsCurrent: raw.keepsCurrent,
        });
        return;
      }
      const source = sources.find((s) => s.id === refreshSource) ?? {
        id: "upload:" + uploadId,
        label:
          sourceName.trim() ||
          (folderMode
            ? folderSelection?.kind === "ready"
              ? folderSelection.root
              : "Folder"
            : files
                .map((f) => f.name)
                .join(", ")
                .slice(0, 160)),
        kind: folderMode ? "folder" : "upload",
      };
      setImportPreview(
        importPreviewSchema.parse(
          await api("architecture/import-preview", {
            label,
            ...(bundle ? { bundle } : { documents }),
            source,
            mode: refreshSource ? "refresh" : "add",
            resolutions,
          }),
        ),
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function commitImport() {
    if (!importPreview) return;
    setBusy(true);
    setError("");
    try {
      await api("architecture/import-commit", { token: importPreview.token });
      await load();
      setImporting(false);
      setUploadId(crypto.randomUUID());
      setSourceName("");
      setImportPreview(null);
      setNotice(
        "Architecture updated. Native planning work was retained; imported claims remain unverified.",
      );
    } catch (error) {
      setError(String(error));
      setImportPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function commitHistory() {
    if (!historyPreview) return;
    setBusy(true);
    setError("");
    try {
      await api("architecture/history-commit", { token: historyPreview.token });
      await load();
      setImporting(false);
      setHistoryPreview(null);
      draft.refresh();
      setNotice(
        "History imported. Revisions and original labels were retained. Any imported unfinished draft is available to recover below.",
      );
    } catch (error) {
      setError(String(error));
      setHistoryPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function exportHistory() {
    try {
      const archive = await api("architecture/history"),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(archive, null, 2)], {
            type: "application/json",
          }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = "pymtheg-architecture-history.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setError(String(error));
    }
  }
  async function finishSavedEdit(message: string, id?: string) {
    // Persistence is already confirmed. Close the saved form regardless of
    // follow-up recovery/network failures, and never label it an unsaved edit.
    setPlanning(false);
    setEditing(false);
    setDocument(null);
    setNotice(message);
    setError("");
    setRecoveryWarning("");
    const warning = await draft.afterCommit();
    try {
      const loaded = await load();
      if (id) {
        clearFilters();
        setView("records");
        await inspect(id, loaded.index);
      }
      if (warning) setRecoveryWarning(warning);
    } catch (error) {
      setError(
        "The design was saved, but this view could not refresh. Reload to view it. " +
          String(error),
      );
    }
  }
  async function saveDocument() {
    if (!index) return;
    setBusy(true);
    setError("");
    try {
      await api("architecture/document", {
        revision: draftBase,
        label,
        path,
        text,
        createOnly,
      });
      await finishSavedEdit(
        "Saved a new architecture revision. The previous revision remains available.",
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(String(e));
      if (e instanceof ApiError && e.status === 409) setDocumentConflict(true);
    } finally {
      setBusy(false);
    }
  }
  async function exportBundle() {
    if (!index) return;
    try {
      const bundle = await api("architecture/export?revision=" + index.id),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(bundle, null, 2)], {
            type: "application/json",
          }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = "architecture-" + index.id.slice(0, 8) + ".json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(String(e));
    }
  }
  const planningActionHelp = !draft.ready
    ? "Loading draft recovery before starting another record."
    : draft.restored
      ? "Restore or discard the recovered draft below before adding another planning record."
      : planning || editing || naming
        ? "Finish or close the current edit before adding another planning record."
        : "";
  const data = detail && object(detail.data) ? detail.data : {};
  const calls = detail
    ? (index?.edges ?? []).filter((e) => e.from === detail.entity.id)
    : [];
  return (
    <section className="architecture-workspace" aria-busy={overviewPending}>
      <header className="architecture-heading">
        <div>
          <span className="eyebrow">THE WHOLE DESIGN</span>
          <h1>Architecture workspace</h1>
          <p>
            Keep contracts, decisions, source documents and review history
            together. Importing information does not prove it correct.
          </p>
        </div>
        <div className="architecture-actions">
          <button
            className="button secondary"
            aria-pressed={implementationOpen}
            disabled={planning || editing || naming}
            onClick={() => setImplementationOpen((v) => !v)}
          >
            {implementationOpen ? "Back to architecture" : "Plan & code graphs"}
          </button>
          <button
            className="button primary"
            disabled={
              !draft.ready || !!draft.restored || planning || editing || naming
            }
            aria-describedby={
              planningActionHelp ? "planning-action-help" : undefined
            }
            title={planningActionHelp || undefined}
            onClick={() => {
              setDraftBase(index?.id ?? "");
              setPlanInitial(undefined);
              setPlanTarget(undefined);
              setPlanning(true);
            }}
          >
            Add planning record
          </button>
          <button
            className="button secondary"
            disabled={planning || editing || naming || busy || !!draft.restored}
            onClick={() => setImporting((v) => !v)}
          >
            Import documents
          </button>
          {index && (
            <>
              <button
                className="button secondary"
                disabled={
                  !draft.ready ||
                  !!draft.restored ||
                  planning ||
                  editing ||
                  naming
                }
                onClick={() => {
                  setDraftBase(index.id);
                  setEditing(true);
                  setCreateOnly(true);
                  setDocumentConflict(false);
                  let number = 1,
                    candidate = "notes/decision.md";
                  while (index.documents.some((d) => d.path === candidate))
                    candidate = `notes/decision-${++number}.md`;
                  setPath(candidate);
                  setText(
                    "# New decision\n\nStatus: proposed\n\nReason and consequences:\n",
                  );
                  setLabel("Record architecture decision");
                }}
              >
                Add document
              </button>
              <button
                className="button secondary"
                disabled={
                  busy ||
                  planning ||
                  editing ||
                  !!draft.restored ||
                  index.id !== activeRevision
                }
                onClick={() => {
                  setNaming(true);
                  setVersionName("");
                }}
              >
                Name current version
              </button>
              <button
                className="button secondary"
                onClick={() => void exportBundle()}
              >
                Export this revision
              </button>
              <button
                className="button secondary"
                onClick={() => void exportHistory()}
              >
                Export all history
              </button>
            </>
          )}
        </div>
      </header>
      {planningActionHelp && (
        <p id="planning-action-help" className="muted">
          {planningActionHelp}
        </p>
      )}
      {index && index.id !== activeRevision && (
        <p role="status" className="message notice-message">
          You are viewing a historical revision. Edits are applied to the
          current architecture only if the edited record has not changed.{" "}
          <button onClick={() => void load().catch((e) => setError(String(e)))}>
            Return to current architecture
          </button>
        </p>
      )}
      {(planning || editing) && (
        <p>Closing the editor keeps your unfinished draft for recovery.</p>
      )}
      {error && (
        <p className="message error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message notice-message" role="status">
          {notice}
        </p>
      )}
      {recoveryWarning && (
        <p
          className="message recovery-warning"
          role="status"
          aria-label="Recovery cleanup warning"
        >
          <strong>Recovery note: </strong>
          {recoveryWarning}
          <button
            aria-label="Dismiss recovery note"
            onClick={() => setRecoveryWarning("")}
          >
            Dismiss
          </button>
        </p>
      )}
      {(planning || editing) && <p role="status">{draft.status}</p>}
      {conflictCount > 0 && (
        <p className="message error-message" role="alert">
          {conflictCount} conflicting record{" "}
          {conflictCount === 1 ? "identity" : "identities"}. All definitions are
          shown; references to those identities are unresolved.{" "}
          <button
            onClick={() => {
              clearFilters();
              setConflictsOnly(true);
              setView("records");
            }}
          >
            Show conflicting records
          </button>
        </p>
      )}
      {draft.error && (
        <p className="message error-message" role="alert">
          {draft.error}{" "}
          <button onClick={draft.download}>Download local draft</button>
        </p>
      )}
      {draft.restored && !planning && !editing && (
        <section className="architecture-import">
          <h2>Recover an unfinished architecture edit</h2>
          <p>
            Your stored draft is available. It has not been applied to the
            architecture.
          </p>
          <p>
            Started from{" "}
            {revisions.find((r) => r.id === draft.restored?.baseRevision)
              ?.label ?? "an earlier retained version"}{" "}
            ·{" "}
            {revisions.find((r) => r.id === draft.restored?.baseRevision)
              ?.source ?? "origin not recorded"}
            .{" "}
            {draft.restored.kind === "document"
              ? `Document: ${draft.restored.document.path}.`
              : `${status(draft.restored.item.kind)}: ${draft.restored.item.title.trim() || "Untitled " + status(draft.restored.item.kind)}.`}
          </p>
          {draft.restored.baseRevision !== activeRevision && (
            <p>
              The current architecture is a different revision. Restoring does
              not apply this draft or overwrite current work.
            </p>
          )}
          <button className="button secondary" onClick={draft.download}>
            Download recovered draft
          </button>
          {draft.restored.kind === "document" && (
            <button
              className="button secondary"
              onClick={() => {
                const saved = draft.restored;
                if (!saved || saved.kind !== "document" || !activeRevision)
                  return;
                void load(activeRevision)
                  .then((current) => {
                    if (!current.index)
                      throw Error(
                        "Open a current architecture before restoring a document.",
                      );
                    const existing = new Set(
                      current.index.documents.map((d) => d.path),
                    );
                    const suffix = saved.document.path.lastIndexOf(".");
                    const base =
                        suffix < 0
                          ? saved.document.path
                          : saved.document.path.slice(0, suffix),
                      ext =
                        suffix < 0 ? ".md" : saved.document.path.slice(suffix);
                    let path = base + "-recovered" + ext,
                      n = 2;
                    while (existing.has(path))
                      path = base + "-recovered-" + n++ + ext;
                    setPath(path);
                    setText(saved.document.text);
                    setLabel(saved.label || "Recovered document");
                    setDraftBase(current.index.id);
                    setCreateOnly(true);
                    setEditing(true);
                    draft.dismiss();
                    setRecoveryWarning(
                      "Recovered text is a new document. Review its path and save explicitly; existing architecture documents have not changed.",
                    );
                  })
                  .catch((e) => setError(String(e)));
              }}
            >
              Restore as new document
            </button>
          )}
          <button
            className="button primary"
            onClick={() => {
              const saved = draft.restored!;
              setDraftBase(saved.baseRevision);
              if (saved.kind === "plan") {
                setPlanInitial(saved.item);
                setPlanTarget(saved.target);
                setPlanning(true);
              } else {
                setCreateOnly(saved.createOnly ?? false);
                setPath(saved.document.path);
                setText(saved.document.text);
                setLabel(saved.label);
                setEditing(true);
              }
              draft.dismiss();
            }}
          >
            Restore architecture draft
          </button>
          <button
            className="button secondary"
            onClick={() => void draft.clear().catch((e) => setError(String(e)))}
          >
            Discard recovered draft
          </button>
        </section>
      )}
      {planning && (
        <PlanEditor
          onOpenSource={onOpenSource}
          revision={draftBase}
          entitiesRevision={index?.id ?? draftBase}
          revisions={revisions}
          entities={index?.entities ?? []}
          initial={planInitial}
          targetRecord={planTarget}
          onBaseChanged={setDraftBase}
          onCancel={() => {
            draft.keep();
            setPlanning(false);
          }}
          onDraft={(item) =>
            draft.persist({
              kind: "plan",
              baseRevision: draftBase,
              item,
              ...(planTarget ? { target: planTarget } : {}),
            })
          }
          onSaved={(id) =>
            finishSavedEdit("Planning record saved in a new revision.", id)
          }
        />
      )}
      {naming && index && (
        <form
          className="architecture-import"
          aria-label="Name current version"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void api("architecture/checkpoint", {
              revision: index.id,
              label: versionName,
            })
              .then(async () => {
                await load();
                setNaming(false);
                setNotice(
                  `Saved named version “${versionName}”. Its design documents are unchanged.`,
                );
              })
              .catch((error) => setError(String(error)))
              .finally(() => setBusy(false));
          }}
        >
          <h2>Save a named version</h2>
          <p>
            Keep a checkpoint of the currently saved architecture. Existing
            versions stay available and unchanged document content is stored
            only once.
          </p>
          <label>
            Version name
            <input
              className="text-input"
              autoFocus
              maxLength={160}
              value={versionName}
              onChange={(event) => setVersionName(event.target.value)}
              placeholder="For example: Ready for API review"
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !versionName.trim()}
            type="submit"
          >
            Save named version
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => setNaming(false)}
          >
            Cancel naming
          </button>
        </form>
      )}
      {importing && (
        <section className="architecture-import">
          <h2>Bring the existing design with you</h2>
          <p>
            Select a catalogue and any supporting Markdown, JSON or text
            documents. All selected content is retained, including fields this
            tool does not understand. Existing revisions remain available.
          </p>
          <label>
            Import action
            <select
              aria-label="Import action"
              value={refreshSource}
              onChange={(e) => setRefreshSource(e.target.value)}
            >
              <option value="">
                Add documents (keep existing sources and plans)
              </option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  Refresh {source.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            Refreshing replaces or removes only that source’s documents. Local
            plans and other sources stay. Review the exact changes before
            saving.
          </p>
          {!refreshSource && (
            <label>
              Source name
              <input
                className="text-input"
                value={sourceName}
                maxLength={160}
                placeholder="For example: Storage architecture"
                onChange={(e) => setSourceName(e.target.value)}
              />
            </label>
          )}
          <label>
            Revision name
            <input
              className="text-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={folderMode}
              onChange={(e) => {
                setFolderMode(e.target.checked);
                setFiles([]);
                setError("");
              }}
            />{" "}
            Choose a folder
          </label>
          <label>
            {folderMode ? "Architecture folder" : "Architecture files"}
            <input
              key={folderMode ? "folder" : "files"}
              type="file"
              multiple
              {...(folderMode
                ? { webkitdirectory: "" }
                : {
                    accept: `.json,.md,.txt,.svg,.dot,.html,${publicIdentity.extension}`,
                  })}
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []));
                setError("");
              }}
            />
          </label>
          {folderMode && folderSelection?.kind === "error" ? (
            <p role="alert">{folderSelection.message}</p>
          ) : folderMode && folderSelection?.kind === "ready" ? (
            <>
              <p>
                {folderSelection.inventory.included.length} documents will be
                retained · {folderSelection.inventory.excluded.length} file
                entries excluded. The complete inventory will be stored
                alongside the documents.
              </p>
              <details>
                <summary>Review folder selection</summary>
                <p>
                  {folderSelection.inventory.bytes.toLocaleString()} bytes of
                  document content. Generated/private directories and
                  unsupported file formats are excluded.
                </p>
                <ul>
                  {folderSelection.inventory.excluded
                    .slice(0, 50)
                    .map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                </ul>
                {folderSelection.inventory.excluded.length > 50 && (
                  <p>
                    Showing the first 50 exclusions; all entries are retained in
                    the inventory.
                  </p>
                )}
              </details>
            </>
          ) : (
            <p>
              {files.length} {files.length === 1 ? "file" : "files"} selected
            </p>
          )}
          <button
            className="button primary"
            disabled={
              !files.length ||
              busy ||
              (folderMode &&
                (folderSelection?.kind !== "ready" ||
                  !folderSelection.inventory.included.length))
            }
            onClick={() => void importFiles()}
          >
            {busy ? "Preparing preview…" : "Preview import"}
          </button>
          {historyPreview && (
            <section aria-label="History import preview">
              <h3>Review history archive</h3>
              <p>
                {historyPreview.revisions} named revisions ·{" "}
                {historyPreview.documents} unique documents ·{" "}
                {historyPreview.hasDraft
                  ? "unfinished draft included"
                  : "no unfinished draft"}
              </p>
              <p>
                {historyPreview.keepsCurrent
                  ? "Your current architecture stays active. Archived revisions become available in history."
                  : "The archive’s current revision becomes active."}{" "}
                Conflicting revision metadata or recovery text will stop the
                import without discarding either version.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void commitHistory()}
              >
                Import reviewed history
              </button>
            </section>
          )}
          {importPreview && (
            <section aria-label="Import preview">
              <h3>Review before saving</h3>
              {importPreview.conflicts.length > 0 && (
                <ImportConflicts
                  key={importPreview.token}
                  conflicts={importPreview.conflicts}
                  busy={busy}
                  onReview={(choices) => void importFiles(choices)}
                />
              )}
              <p>
                {importPreview.summary.added.length} added ·{" "}
                {importPreview.summary.changed.length} changed ·{" "}
                {importPreview.summary.removed.length} removed ·{" "}
                {importPreview.summary.keptNative.length} native documents
                retained
              </p>
              <p>
                {importPreview.unresolvedLinks} unresolved links in the
                resulting architecture. Existing revisions stay available.
              </p>
              {importPreview.warnings.length > 0 && (
                <section aria-label="Import identity warnings">
                  <h4>Identity and coverage notices</h4>
                  {importPreview.warnings.slice(0, 100).map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                </section>
              )}
              {importPreview.newlyBrokenAuthoredLinks.length > 0 && (
                <div role="alert">
                  <h4>New broken links in your plans</h4>
                  <ul>
                    {importPreview.newlyBrokenAuthoredLinks.map((link, i) => (
                      <li key={i}>
                        {link.name}: {link.target}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(
                [
                  ["Added", importPreview.summary.added],
                  ["Changed", importPreview.summary.changed],
                  ["Removed from this source", importPreview.summary.removed],
                  ["Native work retained", importPreview.summary.keptNative],
                  ["Local edits retained", importPreview.summary.keptLocal],
                  [
                    "Shared source documents retained",
                    importPreview.summary.keptShared,
                  ],
                  [
                    "Existing documents adopted by source",
                    importPreview.summary.adopted,
                  ],
                ] as const
              ).map(
                ([title, paths]) =>
                  paths.length > 0 && (
                    <details key={title}>
                      <summary>
                        {title} ({paths.length})
                      </summary>
                      <ul>
                        {paths.map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                      </ul>
                    </details>
                  ),
              )}
              <button
                className="button primary"
                disabled={busy || importPreview.conflicts.length > 0}
                onClick={() => void commitImport()}
              >
                Save reviewed import
              </button>
            </section>
          )}
        </section>
      )}
      {editing && (
        <section className="architecture-import">
          <h2>Record a decision, requirement or plan</h2>
          <p>
            This edits the stored architecture copy and keeps the previous
            revision. It does not modify the original imported project.
          </p>
          <label>
            Document path
            <input
              className="text-input"
              value={path}
              readOnly={!createOnly}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <label>
            Revision name
            <input
              className="text-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            Decision or document text
            <textarea
              aria-label="Decision or document text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
            />
          </label>
          {documentConflict && (
            <ArchitectureConflictReview
              path={path}
              baseRevision={draftBase}
              local={text}
              onChoose={(revision, current, useCurrent) => {
                setDraftBase(revision);
                setCreateOnly(current === null);
                if (useCurrent && typeof current === "string") setText(current);
                setDocumentConflict(false);
                setError("");
              }}
            />
          )}
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void saveDocument()}
          >
            Save new architecture revision
          </button>
          <button
            className="button secondary"
            onClick={() => {
              draft.keep();
              setEditing(false);
            }}
          >
            Cancel edit
          </button>
        </section>
      )}
      {implementationOpen && (
        <ImplementationGraph
          runId={checkedRunId}
          drafts={implementationDrafts}
          onDrafts={onImplementationDrafts}
          recoverySaved={recoverySaved}
          onChanged={() => {
            void load().catch((e) => setError(String(e)));
          }}
        />
      )}
      {!implementationOpen &&
        (!index ? (
          <div className="empty-state">
            {overviewPending ? (
              <p role="status">Loading saved architecture…</p>
            ) : error ? (
              <p>
                Architecture could not be loaded. Your saved records have not
                been replaced.
              </p>
            ) : draft.restored ? (
              <>
                <h2>Continue your unfinished architecture work</h2>
                <p>
                  Restore or discard the recovered draft above. Its fields are
                  kept until you choose.
                </p>
              </>
            ) : (
              <>
                <h2>Start with a requirement or decision</h2>
                <p>
                  Use <strong>Add planning record</strong> to describe what this
                  project needs, why it matters, and how you will check it. You
                  can connect it to components and add documents as the design
                  grows.
                </p>
                <p>
                  Already have documentation? Choose{" "}
                  <strong>Import documents</strong>, then{" "}
                  <strong>Choose a folder</strong> to preview it. You can start
                  without importing anything.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {hasContracts && (
              <div className="architecture-summary">
                <span>
                  <strong>{designDocumentCount}</strong> source documents
                </span>
                <span>
                  <strong>
                    {index.entities.filter((e) => e.kind === "function").length}
                  </strong>{" "}
                  function contracts
                </span>
                <span>
                  <strong>
                    {index.entities.filter((e) => e.kind === "type").length}
                  </strong>{" "}
                  type contracts
                </span>
                <span>
                  <strong>
                    {
                      index.edges.filter(
                        (e) =>
                          e.binding === "missing" || e.binding === "partial",
                      ).length
                    }
                  </strong>{" "}
                  catalogue call relationships with unrecorded or partial
                  argument bindings
                </span>
              </div>
            )}
            {planningEntities.length > 0 && (
              <section
                className="planning-overview"
                aria-label="Planning overview"
              >
                <div>
                  <h2>Planning overview</h2>
                  <p>
                    {planningEntities.length} planning{" "}
                    {planningEntities.length === 1 ? "record" : "records"}{" "}
                    alongside {designDocumentCount} design{" "}
                    {designDocumentCount === 1 ? "document" : "documents"}.
                    Select a category to see the work it describes.
                  </p>
                </div>
                <div className="planning-counts">
                  {(
                    [
                      ["requirement", "Requirements"],
                      ["decision", "Decisions"],
                      ["risk", "Risks"],
                      ["component", "Components"],
                      ["milestone", "Milestones"],
                      ["test", "Tests"],
                      ["evidence", "Evidence"],
                    ] as const
                  ).map(([id, label]) => {
                    const count = planningEntities.filter(
                      (e) => e.kind === id,
                    ).length;
                    return (
                      count > 0 && (
                        <button
                          key={id}
                          aria-pressed={kind === id && view === "records"}
                          onClick={() => {
                            clearFilters();
                            setKind(id);
                            setView("records");
                          }}
                        >
                          <strong>{count}</strong>{" "}
                          {count === 1 && id !== "evidence"
                            ? label.slice(0, -1)
                            : label}
                        </button>
                      )
                    );
                  })}
                </div>
              </section>
            )}
            {importedSections.length > 0 && (
              <section
                className="planning-overview"
                aria-label="Imported design context"
              >
                <h2>Imported design context</h2>
                <p>
                  {importedSections.length} document{" "}
                  {importedSections.length === 1 ? "section" : "sections"}{" "}
                  retained, including requirements and decisions where recorded.
                  These are imported claims, not checked native plans.
                </p>
                <div className="planning-counts">
                  {importedSections.slice(0, 4).map((section) => (
                    <button
                      key={section.id}
                      onClick={() => {
                        setView("records");
                        void inspect(section.id);
                      }}
                    >
                      {section.name}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      clearFilters();
                      setKind("heading");
                      setView("records");
                    }}
                  >
                    Browse all imported sections
                  </button>
                </div>
              </section>
            )}
            <details className="architecture-import-scope">
              <summary>What was retained and what can be checked?</summary>
              <p>
                All {index.documents.length} selected documents are retained in
                full. The structured view indexes supported catalogues and
                native planning records. Original text remains authoritative for
                fields the index does not understand.
              </p>
              <ul>
                {index.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </details>
            <div className="architecture-revisions">
              <label>
                Stored revision
                <select
                  aria-label="Stored revision"
                  value={index.id}
                  onChange={(e) => {
                    setDetail(null);
                    setDocument(null);
                    void load(e.target.value).catch((e) => {
                      if (e.name !== "AbortError") setError(String(e));
                    });
                  }}
                >
                  {revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id === activeRevision
                        ? "Current · "
                        : otherBranches.some((b) => b.id === r.id)
                          ? "Separate branch · "
                          : branchCandidates.some(
                                (b) => b.id === r.id && b.reviewed,
                              )
                            ? "Reviewed branch · "
                            : unknownHistory.some((b) => b.id === r.id)
                              ? "Unknown lineage · "
                              : ""}
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="architecture-revision-context">
                <strong>
                  {revisions.find((r) => r.id === index.id)?.label}
                </strong>
                <div>
                  {index.id === activeRevision
                    ? "Current saved version"
                    : otherBranches.some((b) => b.id === index.id)
                      ? "Separate saved branch — review before using"
                      : displayedBranch?.reviewed
                        ? "Separate branch — reviewed; current design retained"
                        : unknownHistory.some((b) => b.id === index.id)
                          ? "Earlier version — lineage was not recorded"
                          : "Historical version"}{" "}
                  ·{" "}
                  {new Date(
                    revisions.find((r) => r.id === index.id)?.created ?? "",
                  ).toLocaleString()}
                </div>
                <div>
                  Stored claims are unverified · {index.id.slice(0, 12)}
                </div>
                <div>
                  {selectedRevision?.parentId === undefined ? (
                    "Earlier history: parent was not recorded"
                  ) : selectedRevision.parentId === null ? (
                    "First saved version in this history"
                  ) : (
                    <>
                      Saved after:{" "}
                      {revisions.find((r) => r.id === selectedRevision.parentId)
                        ?.label ?? selectedRevision.parentId.slice(0, 12)}
                    </>
                  )}
                </div>
                {revisions.filter((r) => r.parentId === index.id).length >
                  1 && (
                  <div>
                    Separate branches continue from this version. Import order
                    does not imply a single edit sequence.
                  </div>
                )}
              </div>
            </div>
            {!!otherBranches.length && (
              <section
                className="message notice-message"
                aria-label="Branches needing review"
              >
                <h3>
                  {otherBranches.length} separate saved{" "}
                  {otherBranches.length === 1
                    ? "branch needs"
                    : "branches need"}{" "}
                  review
                </h3>
                <p>
                  These versions are outside the current version's recorded
                  history. Importing them did not merge their decisions into the
                  current design.
                </p>
                {otherBranches.map((branch) => (
                  <button
                    key={branch.id}
                    onClick={() =>
                      void load(branch.id).catch((e) => setError(String(e)))
                    }
                  >
                    Review {branch.label}
                    {branch.lineage === "unknown"
                      ? " (earlier lineage unknown)"
                      : ""}
                  </button>
                ))}
              </section>
            )}
            {displayedBranch && activeRevision && (
              <section
                className="message notice-message branch-review"
                aria-label="Review this branch"
              >
                <p>
                  Compare this branch with the current design before
                  acknowledging it. This keeps both versions; it does not merge
                  their decisions.
                </p>
                <label>
                  Reviewer (optional)
                  <input
                    aria-label="Branch reviewer"
                    value={reviewer}
                    maxLength={200}
                    onChange={(e) => setReviewer(e.target.value)}
                  />
                </label>
                <label>
                  Review or withdrawal notes
                  <textarea
                    aria-label="Branch review notes"
                    value={reviewReason}
                    maxLength={4000}
                    onChange={(e) => setReviewReason(e.target.value)}
                  />
                </label>
                {!displayedBranch.reviewed && (
                  <button
                    className="button primary"
                    onClick={() => {
                      void api("architecture/review-branch", {
                        tip: displayedBranch.id,
                        active: activeRevision,
                        ...(reviewer.trim()
                          ? { reviewer: reviewer.trim() }
                          : {}),
                        ...(reviewReason.trim()
                          ? { reason: reviewReason.trim() }
                          : {}),
                      })
                        .then(() => load(displayedBranch.id))
                        .catch((e) => setError(String(e)));
                    }}
                  >
                    I reviewed this branch; keep the current design
                  </button>
                )}
                <details>
                  <summary>Review history for this branch</summary>
                  <p>Reviews that haven’t been withdrawn appear first.</p>
                  {!branchAudit && <p role="status">Loading review history…</p>}
                  {branchAudit?.items.map((record) => (
                    <article key={record.id}>
                      <p>
                        {record.withdrawal ? "Withdrawn review" : "Reviewed"} ·{" "}
                        {record.reviewer || "Reviewer not recorded"} ·{" "}
                        {record.created || "Original date not recorded"}
                      </p>
                      <p>
                        Compared with{" "}
                        {revisions.find(
                          (revision) => revision.id === record.against,
                        )?.label ?? "unavailable saved revision"}{" "}
                        · {record.against.slice(0, 8)}
                      </p>
                      <p>{record.reason || "No review notes recorded."}</p>
                      {record.withdrawal &&
                      (record.withdrawalCount ?? 1) > 1 ? (
                        <BranchWithdrawals
                          id={record.id}
                          count={record.withdrawalCount!}
                        />
                      ) : record.withdrawal ? (
                        <p>
                          Withdrawal:{" "}
                          {record.withdrawal.reason || "No reason recorded"} ·{" "}
                          {record.withdrawal.reviewer ||
                            "Reviewer not recorded"}
                        </p>
                      ) : (
                        <button
                          className="button secondary"
                          onClick={() =>
                            void api("architecture/withdraw-review", {
                              tip: record.id,
                              active: activeRevision,
                              ...(reviewer.trim()
                                ? { reviewer: reviewer.trim() }
                                : {}),
                              ...(reviewReason.trim()
                                ? { reason: reviewReason.trim() }
                                : {}),
                            })
                              .then(() => load(displayedBranch.id))
                              .catch((e) => setError(String(e)))
                          }
                        >
                          Withdraw this review
                        </button>
                      )}
                    </article>
                  ))}
                  {branchAudit?.nextOffset != null && (
                    <button
                      onClick={() =>
                        void api(
                          "architecture/review-history?revision=" +
                            encodeURIComponent(displayedBranch.id) +
                            "&offset=" +
                            branchAudit.nextOffset,
                        )
                          .then((raw) =>
                            setBranchAudit(
                              acknowledgementPageSchema.parse(raw),
                            ),
                          )
                          .catch((e) => setError(String(e)))
                      }
                    >
                      Next review page
                    </button>
                  )}
                  {branchAudit && (
                    <p>
                      {branchAudit.total} retained review records · page{" "}
                      {Math.floor(branchAudit.offset / 20) + 1}
                    </p>
                  )}
                </details>
              </section>
            )}
            {!!unknownHistory.length && (
              <details>
                <summary>
                  {unknownHistory.length} earlier versions have unknown lineage
                </summary>
                <p>
                  These legacy versions may belong to the same edit history.
                  They are not classified as separate branches.
                </p>
                {unknownHistory.map((version) => (
                  <button
                    key={version.id}
                    onClick={() =>
                      void load(version.id).catch((e) => setError(String(e)))
                    }
                  >
                    {version.label}
                  </button>
                ))}
              </details>
            )}
            <nav className="tabs" aria-label="Architecture views">
              {[
                ["records", "Design records"],
                ["documents", "Documents and decisions"],
                ["changes", "Revision changes"],
                ["work", "Needs attention"],
              ].map(([id, title]) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => {
                    setView(id!);
                  }}
                >
                  {title}
                </button>
              ))}
            </nav>
            {view === "work" ? (
              <section
                className="architecture-import"
                aria-label="Architecture work to review"
              >
                <h2>What needs attention?</h2>
                <p>
                  These are gaps in the stored design and its evidence. Imported
                  claims have not been proved.
                </p>
                {workLoading || workRevision !== index.id ? (
                  <p role="status">Checking recorded planning gaps…</p>
                ) : workError ? (
                  <div role="alert">
                    <p>Could not check planning gaps. {workError}</p>
                    <button onClick={() => setWorkRetry((n) => n + 1)}>
                      Retry planning checks
                    </button>
                  </div>
                ) : work.length === 0 ? (
                  <p>
                    No gaps found by these structural checks. This does not
                    establish that the architecture is complete.
                  </p>
                ) : (
                  (["authored", "imported"] as const).map((origin) => {
                    const items = work.filter(
                      (issue) => issue.origin === origin,
                    );
                    const content = (
                      <>
                        {items.slice(0, visibleCount).map((issue, i) => (
                          <article key={i}>
                            <h3>{issue.kind.replaceAll("-", " ")}</h3>
                            <button
                              className="text-link"
                              onClick={() => {
                                setView("records");
                                void inspect(issue.id);
                              }}
                            >
                              {byId.get(issue.id)?.name ?? issue.id}
                            </button>
                            <p>{issue.message}</p>
                            {issue.kind === "diverged-target" &&
                              issue.target &&
                              byId.has(issue.target) && (
                                <button
                                  className="text-link"
                                  onClick={() => {
                                    const target = byId.get(issue.target!);
                                    if (target) {
                                      setView("documents");
                                      void openDocument(target.document);
                                    }
                                  }}
                                >
                                  Open tracked copy
                                </button>
                              )}
                          </article>
                        ))}
                        {items.length > visibleCount && (
                          <button
                            onClick={() => setVisibleCount((n) => n + 100)}
                          >
                            Show more items ({items.length - visibleCount}{" "}
                            remaining)
                          </button>
                        )}
                      </>
                    );
                    return origin === "authored" ? (
                      <section key={origin} aria-label="Your planning work">
                        <h3>Your planning work ({items.length})</h3>
                        {items.length ? (
                          content
                        ) : (
                          <p>No native planning gaps found.</p>
                        )}
                      </section>
                    ) : (
                      <details key={origin}>
                        <summary>
                          Imported records and mapping gaps ({items.length})
                        </summary>
                        <p>
                          These come from imported records. Unresolved type
                          references may reflect unsupported catalogue notation;
                          review the original documents. They are not proof of
                          defects in your plans.
                        </p>
                        {content}
                      </details>
                    );
                  })
                )}
              </section>
            ) : view === "changes" ? (
              <section className="architecture-import">
                <h2>Compare architecture revisions</h2>
                <p>
                  Stable declared IDs preserve identity through renaming.
                  Differences show stored contracts, not proof that an
                  implementation changed.
                </p>
                <label>
                  Compare with
                  <select
                    aria-label="Compare with"
                    value={baseline}
                    onChange={(e) => {
                      setBaseline(e.target.value);
                      comparison.current?.abort();
                      const request = new AbortController();
                      comparison.current = request;
                      setDifference(null);
                      if (!e.target.value) return;
                      void api(
                        "architecture/compare?current=" +
                          index.id +
                          "&previous=" +
                          e.target.value,
                        undefined,
                        request.signal,
                      )
                        .then((v) => {
                          if (!request.signal.aborted)
                            setDifference(differenceSchema.parse(v));
                        })
                        .catch((e) => {
                          if (e.name !== "AbortError") setError(String(e));
                        });
                    }}
                  >
                    <option value="">Choose a previous revision</option>
                    {revisions
                      .filter((r) => r.id !== index.id)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                  </select>
                </label>
                {difference && (
                  <div className="architecture-changes">
                    {(["added", "changed", "removed"] as const).map((group) => (
                      <section key={group}>
                        <h3>
                          {difference[group].length}{" "}
                          {difference[group].length === 1
                            ? "record"
                            : "records"}{" "}
                          {group}
                        </h3>
                        {difference[group].map((id) => (
                          <p key={id}>
                            {byId.get(id)?.key ??
                              difference.removedNames?.[id] ??
                              id}
                          </p>
                        ))}
                      </section>
                    ))}
                    {difference.recordChanges?.map((change) => (
                      <details key={change.id}>
                        <summary>What changed in {change.name}</summary>
                        {change.fields.map((field) => (
                          <section key={field.path}>
                            <h4>{field.path}</h4>
                            <div className="architecture-conflict-columns">
                              <section>
                                <h5>Before</h5>
                                <pre>{field.before}</pre>
                              </section>
                              <section>
                                <h5>After</h5>
                                <pre>{field.after}</pre>
                              </section>
                            </div>
                            {field.truncated && (
                              <p>
                                Long value shortened. Read the retained source
                                for the complete value.
                              </p>
                            )}
                          </section>
                        ))}
                        {change.truncated && (
                          <p>Showing the first 200 changed fields.</p>
                        )}
                      </details>
                    ))}
                    {difference.documentChanges?.map((change) => (
                      <details key={change.path}>
                        <summary>Text changes: {change.path}</summary>
                        <p>Changed region, from line {change.startLine}.</p>
                        <div className="architecture-conflict-columns">
                          <section>
                            <h4>Before</h4>
                            <pre>{change.before || "Not present"}</pre>
                          </section>
                          <section>
                            <h4>After</h4>
                            <pre>{change.after || "Not present"}</pre>
                          </section>
                        </div>
                        {change.truncated && (
                          <p>
                            Long changed region shortened. Both full documents
                            remain in their revisions.
                          </p>
                        )}
                      </details>
                    ))}
                    <h3>Renamed contracts</h3>
                    {difference.renamed.length ? (
                      difference.renamed.map((r) => (
                        <p key={r.id}>
                          {r.before} → {r.after}
                        </p>
                      ))
                    ) : (
                      <p>No recorded renames.</p>
                    )}
                    <h3>Documents changed or added</h3>
                    {difference.changedDocuments.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                    <h3>Documents removed</h3>
                    {difference.removedDocuments.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <div
                className={`architecture-browser ${view === "documents" ? "documents-mode" : ""}`}
              >
                {view === "records" && (
                  <nav
                    className="architecture-owners"
                    aria-label="Architecture owners"
                  >
                    <h2>Owners</h2>
                    <button
                      className={!owner ? "selected" : ""}
                      onClick={() => setOwner("")}
                    >
                      All owners
                    </button>
                    {owners.map(([name, count]) => (
                      <button
                        key={name}
                        className={owner === name ? "selected" : ""}
                        onClick={() => {
                          setOwner(name);
                          setDetail(null);
                        }}
                      >
                        {name}
                        <span>{count}</span>
                      </button>
                    ))}
                  </nav>
                )}
                <div className="architecture-list">
                  <div className="filter-bar">
                    <input
                      className="search"
                      aria-label="Search architecture"
                      placeholder={
                        view === "records"
                          ? "Find a requirement, decision or contract…"
                          : "Search document contents…"
                      }
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {view === "records" && (
                      <select
                        aria-label="Record type"
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                      >
                        <option value="">All design records</option>
                        <option value="function">Functions</option>
                        <option value="type">Types</option>
                        <option value="document">Documents</option>
                        <option value="heading">Document sections</option>
                        {[
                          "route",
                          "command",
                          "review",
                          "profile",
                          "release",
                        ].map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                        {[
                          "requirement",
                          "decision",
                          "risk",
                          "component",
                          "milestone",
                          "test",
                          "evidence",
                        ].map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    )}
                    {view === "records" && (
                      <select
                        aria-label="Record status"
                        value={stateFilter}
                        onChange={(e) => setStateFilter(e.target.value)}
                      >
                        <option value="">All statuses</option>
                        {[
                          ...new Set(
                            index.entities
                              .filter((e) => e.kind !== "owner")
                              .map((e) => e.status),
                          ),
                        ]
                          .sort()
                          .map((value) => (
                            <option key={value} value={value}>
                              {status(value)}
                            </option>
                          ))}
                      </select>
                    )}
                    {(owner ||
                      kind ||
                      stateFilter ||
                      query ||
                      conflictsOnly) && (
                      <button className="text-link" onClick={clearFilters}>
                        Clear filters
                      </button>
                    )}
                  </div>
                  <p className="muted">
                    {matchCount === null
                      ? "Searching for matches"
                      : `${matchCount} ${matchCount === 1 ? "match" : "matches"}`}{" "}
                    · showing up to {visibleCount}
                  </p>
                  {view === "documents" &&
                    !query.trim() &&
                    visibleDocuments.length === 0 && (
                      <p>
                        No design documents yet. Add a document or start a
                        planning record. Workspace data is available below.
                      </p>
                    )}
                  {view === "records"
                    ? entities.slice(0, visibleCount).map((e) => (
                        <button
                          className="architecture-row"
                          key={e.id}
                          onClick={() => void inspect(e.id)}
                        >
                          <strong>{e.key}</strong>
                          <span title={e.summary}>{e.summary}</span>
                          {e.conflictOf && (
                            <strong>⚠ Conflicting identity</strong>
                          )}
                          <small>
                            {e.kind} · {status(e.status)} · {e.owner}
                          </small>
                        </button>
                      ))
                    : visibleDocuments.slice(0, visibleCount).map((d) => (
                        <button
                          className="architecture-row"
                          key={d.path}
                          onClick={() => void openDocument(d.path)}
                        >
                          <strong>{d.path}</strong>
                          {d.snippet && <span>{d.snippet}</span>}
                          <small>
                            {d.bytes.toLocaleString()} bytes · retained in full
                          </small>
                        </button>
                      ))}
                  {(view === "documents" && query.trim()
                    ? documentNext !== null
                    : (view === "records"
                        ? entities.length
                        : visibleDocuments.length) > visibleCount) && (
                    <button
                      className="button secondary"
                      disabled={searchPending}
                      onClick={() => {
                        if (
                          view === "documents" &&
                          query.trim() &&
                          documentNext !== null
                        )
                          void searchDocuments(documentNext);
                        setVisibleCount((n) => n + 100);
                      }}
                    >
                      {searchPending
                        ? "Loading matches…"
                        : view === "documents"
                          ? "Show more documents"
                          : "Show next 100 records"}
                    </button>
                  )}
                  {view === "documents" && workspaceFiles.length > 0 && (
                    <details>
                      <summary>
                        Workspace data files ({workspaceFiles.length})
                      </summary>
                      <section aria-label="Workspace data files">
                        <p>
                          Planning records and import metadata are kept here.
                          These files are also included in workspace exports.
                        </p>
                        {workspaceFiles
                          .slice(0, workspaceFileLimit)
                          .map((d) => (
                            <button
                              key={d.path}
                              className="button secondary workspace-file-row"
                              onClick={() => void openDocument(d.path)}
                            >
                              {d.path}
                            </button>
                          ))}
                        {workspaceFileLimit < workspaceFiles.length && (
                          <button
                            className="button secondary"
                            onClick={() =>
                              setWorkspaceFileLimit((n) => n + 100)
                            }
                          >
                            Show more workspace files
                          </button>
                        )}
                      </section>
                    </details>
                  )}
                </div>
                <div className="architecture-detail">
                  {detail ? (
                    <>
                      <span className="eyebrow">
                        STORED DESIGN · STATUS IS A RECORDED CLAIM
                      </span>
                      <h2>{detail.entity.key}</h2>
                      {detail.entity.conflictOf && (
                        <p role="alert" className="message error-message">
                          Conflicting identity: {detail.entity.conflictOf}. This
                          definition comes from {detail.entity.document}; other
                          definitions remain separately visible.
                        </p>
                      )}
                      <p>{detail.entity.summary}</p>
                      <p className="badge pending">
                        {status(detail.entity.status)}
                      </p>
                      {!detail.entity.id.startsWith("plan:") && (
                        <>
                          <button
                            className="button secondary"
                            disabled={
                              !draft.ready ||
                              !!draft.restored ||
                              planning ||
                              editing
                            }
                            onClick={() => {
                              setDraftBase(index.id);
                              setPlanTarget(undefined);
                              setPlanInitial(
                                proposeContractChange(
                                  crypto.randomUUID(),
                                  detail.entity,
                                  index.id,
                                ),
                              );
                              setPlanning(true);
                            }}
                          >
                            Propose a change
                          </button>
                          <p className="muted">
                            Create a linked decision while keeping this original
                            contract intact.
                          </p>
                        </>
                      )}
                      {detail.entity.id.startsWith("plan:") ? (
                        <>
                          <p>
                            <strong>Owner:</strong> {detail.entity.owner}
                          </p>
                          {typeof data.originRevision === "string" && (
                            <p>
                              Based on stored revision{" "}
                              <code>{data.originRevision.slice(0, 12)}</code>.
                              This is a proposal, not a rewritten imported
                              contract.
                            </p>
                          )}
                          <h3>Done when</h3>
                          <p>
                            {(typeof data.acceptance === "string" &&
                              data.acceptance) ||
                              "No acceptance criteria recorded yet."}
                          </p>
                          <h3>Evidence and review</h3>
                          <p>
                            {(typeof data.evidence === "string" &&
                              data.evidence) ||
                              "No supporting evidence recorded."}
                          </p>
                          {typeof data.evidenceRevision === "string" &&
                            data.evidenceRevision && (
                              <p>
                                Concerns revision{" "}
                                <code>{data.evidenceRevision}</code>
                              </p>
                            )}
                          <button
                            className="button secondary"
                            disabled={
                              !draft.ready ||
                              !!draft.restored ||
                              planning ||
                              editing
                            }
                            onClick={() => {
                              setDraftBase(index.id);
                              setPlanInitial(planItemSchema.parse(detail.data));
                              setPlanTarget({
                                document: detail.entity.document,
                                originalId: planItemSchema.parse(detail.data)
                                  .id,
                                itemIndex:
                                  typeof detail.entity.pointer[1] === "number"
                                    ? detail.entity.pointer[1]
                                    : undefined,
                              });
                              setPlanning(true);
                            }}
                          >
                            Edit planning record
                          </button>
                        </>
                      ) : detail.entity.id.startsWith("source:") ? (
                        <>
                          <h3>Retained source component</h3>
                          <p>
                            This is the source snapshot saved with a plan, not a
                            live verification result.
                          </p>
                          <pre>
                            {typeof data.source === "string"
                              ? data.source
                              : "Source unavailable"}
                          </pre>
                          {typeof data.file === "string" && onOpenSource && (
                            <button
                              className="button secondary"
                              onClick={() => onOpenSource(data.file as string)}
                            >
                              Open {data.file} in source editor
                            </button>
                          )}
                        </>
                      ) : [
                          "type",
                          "document",
                          "heading",
                          "route",
                          "command",
                          "review",
                          "profile",
                          "release",
                        ].includes(detail.entity.kind) ? (
                        <>
                          <h3>
                            {detail.entity.kind === "type"
                              ? "Type definition"
                              : "Retained architecture record"}
                          </h3>
                          <pre>
                            {typeof detail.data === "string"
                              ? detail.data
                              : JSON.stringify(detail.data, null, 2)}
                          </pre>
                        </>
                      ) : (
                        <>
                          {" "}
                          <h3>Inputs</h3>
                          <dl>
                            {object(data.args) ? (
                              Object.entries(data.args).map(([name, type]) => (
                                <div key={name}>
                                  <dt>{name}</dt>
                                  <dd>
                                    {typeof type === "string"
                                      ? type
                                      : JSON.stringify(type)}
                                  </dd>
                                </div>
                              ))
                            ) : (
                              <p>No structured inputs were recorded.</p>
                            )}
                          </dl>
                          <h3>Returns</h3>
                          <p>
                            {typeof data.returns === "string"
                              ? data.returns
                              : "See the source contract below."}
                          </p>
                        </>
                      )}
                      {detail.entity.kind === "function" && (
                        <details>
                          <summary>Failure, state and review contract</summary>
                          <dl>
                            {[
                              ["errors", "Declared errors"],
                              ["allowedErrors", "Allowed errors"],
                              ["state", "State contract"],
                              ["mode", "Execution mode"],
                              ["scope", "Scope"],
                              [
                                "profile",
                                "Ownership, cancellation and retry profile",
                              ],
                              ["tests", "Recorded tests"],
                              ["suite", "Test suite"],
                              ["contractRevision", "Contract revision"],
                            ]
                              .filter(([key]) => data[key!] !== undefined)
                              .map(([key, title]) => (
                                <div key={key}>
                                  <dt>{title}</dt>
                                  <dd>
                                    {typeof data[key!] === "string" ? (
                                      String(data[key!])
                                    ) : (
                                      <pre>
                                        {JSON.stringify(data[key!], null, 2)}
                                      </pre>
                                    )}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        </details>
                      )}
                      <h3>
                        {detail.entity.id.startsWith("plan:")
                          ? "Linked design records"
                          : "Connections from this record"}
                      </h3>
                      {calls.map((e, i) => (
                        <button
                          key={i}
                          className="architecture-call"
                          disabled={e.unresolved}
                          onClick={() => void inspect(e.to)}
                        >
                          <strong>{byId.get(e.to)?.key ?? e.targetName}</strong>
                          <span>
                            {e.kind}
                            {e.binding !== "not-applicable" && (
                              <> · argument bindings {e.binding}</>
                            )}
                            {e.unresolved
                              ? " · target missing or ambiguous"
                              : ""}
                          </span>
                        </button>
                      ))}
                      {Array.isArray(data.edges) && data.edges.length > 0 && (
                        <details>
                          <summary>
                            Conditions, argument mappings and error handling for
                            these calls
                          </summary>
                          {data.edges.map((edge, i) => (
                            <div key={i}>
                              <h4>Call {i + 1}</h4>
                              <pre>{JSON.stringify(edge, null, 2)}</pre>
                            </div>
                          ))}
                        </details>
                      )}
                      {!calls.length && (
                        <p>No outgoing relationships recorded.</p>
                      )}
                      <h3>
                        {detail.dependents.length} potentially affected records
                      </h3>
                      <p>
                        Recorded dependencies only. Type mentions are
                        conservative references; unsupported syntax and missing
                        external contracts can leave gaps.
                      </p>
                      {(["direct", "transitive", "planning"] as const).map(
                        (kind) => (
                          <section key={kind}>
                            <h4>
                              {kind === "direct"
                                ? "Direct consumers"
                                : kind === "transitive"
                                  ? "Transitive consumers"
                                  : "Planning records"}{" "}
                              ({detail.impact[kind].length})
                            </h4>
                            {detail.impact[kind]
                              .slice(0, impactCount)
                              .map((id) => (
                                <button
                                  className="text-link"
                                  key={id}
                                  onClick={() => void inspect(id)}
                                >
                                  {byId.get(id)?.key ?? id} ↗
                                </button>
                              ))}
                            {detail.impact[kind].length > impactCount && (
                              <button
                                onClick={() => setImpactCount((n) => n + 100)}
                              >
                                Show more {kind} records
                              </button>
                            )}
                          </section>
                        ),
                      )}
                      <details>
                        <summary>Structured record and obligations</summary>
                        <p>
                          Exact numeric literals that cannot be represented by
                          the runtime use a <code>$exactNumber</code> record.
                          Open the original document for its unchanged text.
                        </p>
                        <pre>{JSON.stringify(detail.data, null, 2)}</pre>
                      </details>
                      <button
                        className="text-link"
                        onClick={() =>
                          void openDocument(detail.entity.document)
                        }
                      >
                        Open original document ↗
                      </button>
                    </>
                  ) : openedDocument ? (
                    <>
                      <h2>{openedDocument.path}</h2>
                      {openedDocument.path.startsWith(".pymtheg") ? (
                        <p>
                          Managed by Pymtheg. Inspect or download this metadata;
                          use planning and import controls to change the
                          workspace.
                        </p>
                      ) : (
                        <button
                          className="button secondary"
                          disabled={
                            !draft.ready ||
                            !!draft.restored ||
                            planning ||
                            editing ||
                            naming
                          }
                          onClick={() => {
                            setDraftBase(index.id);
                            setCreateOnly(false);
                            setDocumentConflict(false);
                            setPath(openedDocument.path);
                            setText(openedDocument.text);
                            setLabel("Update " + openedDocument.path);
                            setEditing(true);
                          }}
                        >
                          Edit stored copy
                        </button>
                      )}
                      <DocumentReader
                        key={index.id + openedDocument.path}
                        path={openedDocument.path}
                        text={openedDocument.text}
                        fragment={openedDocument.fragment ?? ""}
                        paths={new Set(index.documents.map((d) => d.path))}
                        onOpen={(path, fragment) =>
                          void openDocument(path, fragment)
                        }
                      />
                    </>
                  ) : (
                    <div className="empty-state">
                      <h2>
                        {view === "records"
                          ? "Select a design record"
                          : "Choose a document"}
                      </h2>
                      <p>
                        Open a record to inspect its details and connections.
                        Complete source information is retained alongside this
                        structured view.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ))}
    </section>
  );
}
