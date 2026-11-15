/** R1-D: links from planning records (requirements) to code symbols.
 *
 * Links are shared planning data: they live in the planning database
 * (`.pymtheg/shared/architecture.sqlite`, table `code_links`) behind the
 * storage boundary, with a recorded change for every add, refresh and removal.
 * The rebuildable code graph is only read, never relied on to keep a link.
 * States are computed on demand against the current (synced) graph. A link is
 * never dropped or retargeted silently: a changed or missing target is
 * reported, and only `refreshCodeLink` (an explicit request) re-records it.
 *
 * Every exported function returns plain JSON-safe data and writes nothing to
 * stdout/stderr, so CLI and MCP wrappers only format. */
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { executeGraph, type GraphResponse } from "../graph/commands.js";
import { GraphLocations } from "../graph/command-locations.js";
import { SqliteGraphStore } from "../graph/store.js";
import type { GraphSymbol } from "../graph/types.js";
import { findProjectRoot, storagePath } from "../storage/local.js";
import type { HistoryWriter } from "../storage/recorded-history.js";
import { newPlanItem } from "./planning.js";
import type { ArchitectureEntity } from "./schema.js";
import { ArchitectureStore } from "./store.js";

export const codeLinkSchema = "pymtheg.code-links/v1" as const;

/** The graph's position-independent symbol identity, plus a file-local ordinal. */
export interface CodeSymbolRef {
  /** Graph language module: "go", "rust" or "typescript". */
  language: string;
  /** Project-relative POSIX path. */
  path: string;
  kind: string;
  /** Scoped identity as the graph records it, e.g. `(*Repo).Load`, `impl Index::lookup`. */
  identity: string;
  name: string;
  /** Position among same kind+identity symbols in the file (graph ordinal). */
  ordinal: number;
}
/** Whitespace-normalised source hashes of the symbol at link (or refresh) time. */
export interface CodeFingerprint {
  /** Text before the first `{` (the declaration head/signature). */
  signature: string;
  /** Text from the first `{` (the body); empty if none. */
  body: string;
}
export interface StoredCodeLink {
  /** Shared record UUID (stable; re-adding after removal gets a new one). */
  id: string;
  /** Planning record ID as the architecture projects it, e.g. `plan:R1`. */
  record: string;
  symbol: CodeSymbolRef;
  fingerprint: CodeFingerprint;
  /** Hints only; never used for identity. */
  hint: { line: number; graphId: string };
  created: string;
  refreshed: string | null;
  note: string;
  removed: boolean;
}
export type CodeLinkState =
  | "ok"
  | "changed"
  | "moved"
  | "missing"
  | "unverifiable";
export interface SymbolSummary {
  graphId: string;
  language: string;
  path: string;
  kind: string;
  identity: string;
  name: string;
  line: number | null;
  /** Why a suggestion is offered (suggestions only; never applied). */
  reason?: string;
}
export interface ResolvedCodeLink {
  link: StoredCodeLink;
  state: CodeLinkState;
  /** The planning record still exists in the current architecture. */
  recordPresent: boolean;
  /** Current symbol for ok/changed/moved. */
  current: SymbolSummary | null;
  /** What differs from the recorded fingerprint/location. */
  differs: ("signature" | "body" | "path")[];
  /** For missing: candidates to relink by hand. Never applied automatically. */
  suggestions: SymbolSummary[];
  /** For unverifiable: the failed or partial file, always named. */
  unverifiableFile: { path: string; reason: string } | null;
  /** Failed/partial files that may hide the target (missing/moved assessments). */
  mayBeHiddenBy: string[];
  message: string;
}
export interface GraphSummary {
  complete: boolean;
  syncMode: string;
  failedFiles: GraphResponse["failedFiles"];
  staleFiles: string[];
  warnings: string[];
}
export interface CodeLinkOptions {
  /** Project directory (any directory inside it). Default: current directory. */
  root?: string;
  /** Skip syncing the graph with current files (answers may be stale). */
  noSync?: boolean;
  signal?: AbortSignal;
  /** Tests inject a writer/clock; production uses `.pymtheg/local/writer.json`. */
  writer?: HistoryWriter;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export function fingerprintText(text: string): CodeFingerprint {
  const normal = text.replace(/\s+/g, " ").trim();
  const brace = normal.indexOf("{");
  return {
    signature: sha(brace < 0 ? normal : normal.slice(0, brace).trim()),
    body: brace < 0 ? "" : sha(normal.slice(brace)),
  };
}

async function projectRoot(input = "."): Promise<string> {
  const path = await realpath(input);
  if (!(await lstat(path)).isDirectory())
    throw Error("Project root must be a directory");
  return findProjectRoot(path);
}
async function planningExists(root: string) {
  try {
    return (await lstat(storagePath(root, "planning"))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function withStore<T>(
  root: string,
  write: boolean,
  writer: HistoryWriter | undefined,
  use: (store: ArchitectureStore | null) => Promise<T> | T,
): Promise<T> {
  if (!write && !(await planningExists(root))) return use(null);
  const store = await ArchitectureStore.open(root, {
    readOnly: !write,
    ...(writer ? { writer } : {}),
  });
  try {
    return await use(store);
  } finally {
    store.close();
  }
}
function planningRecords(store: ArchitectureStore | null) {
  return (store?.read()?.entities ?? []).filter((e) => e.planning);
}
function selectRecord(
  records: ArchitectureEntity[],
  input: string,
):
  | { ok: true; record: ArchitectureEntity }
  | { ok: false; matches: ArchitectureEntity[] } {
  const value = input.trim();
  const id = value.startsWith("plan:") ? value : "plan:" + value;
  let matches = records.filter((e) => e.id === id || e.id === value);
  if (!matches.length) matches = records.filter((e) => e.key === value);
  return matches.length === 1
    ? { ok: true, record: matches[0]! }
    : { ok: false, matches };
}
function readLinks(store: ArchitectureStore | null, includeRemoved = false) {
  return (store?.codeLinkRows() ?? [])
    .filter((row) => includeRemoved || !row.removed)
    .map(
      (row) =>
        ({
          ...(JSON.parse(row.body) as Omit<StoredCodeLink, "id" | "removed">),
          id: row.id,
          removed: row.removed,
        }) as StoredCodeLink,
    );
}
function findLink(links: StoredCodeLink[], input: string): StoredCodeLink {
  const value = input.trim();
  const found = links.filter(
    (l) => l.id === value || (value.length >= 8 && l.id.startsWith(value)),
  );
  if (found.length !== 1)
    throw Error(
      found.length
        ? `Link ID prefix “${value}” matches ${found.length} links; give more characters.`
        : `No active code link “${value}”. List links with “link list”.`,
    );
  return found[0]!;
}

/** Syncs the graph exactly as `pymtheg graph` queries do and summarises completeness. */
async function syncGraph(root: string, options: CodeLinkOptions) {
  // A path query with a fixed name: the answer is unused; only the sync and
  // failure/stale reports are read.
  const response = await executeGraph(
    {
      command: "file",
      args: ["pymtheg-code-links-sync-probe"],
      root,
      noSync: options.noSync ?? false,
    },
    options.signal ? { signal: options.signal } : {},
  );
  const summary: GraphSummary = {
    complete: response.sync.complete,
    syncMode: response.sync.mode,
    failedFiles: response.failedFiles,
    staleFiles: response.staleFiles.map((f) => f.path),
    warnings: response.warnings
      .filter((w) => w.code !== "unresolved-coverage")
      .map((w) => `${w.code}: ${w.message}`),
  };
  return { response, summary };
}
function openGraph(root: string): SqliteGraphStore | null {
  const path = storagePath(root, "graph");
  try {
    return new SqliteGraphStore(path, undefined, { readOnly: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

interface GraphView {
  summarize(symbol: GraphSymbol, reason?: string): SymbolSummary;
  fingerprint(symbol: GraphSymbol): CodeFingerprint;
  inFile(path: string): GraphSymbol[];
  named(identity: string): GraphSymbol[];
  fileStatus(path: string): { status: string; reason: string } | null;
}
function graphView(
  store: SqliteGraphStore,
  failed: GraphResponse["failedFiles"],
): GraphView {
  const locations = new GraphLocations(store);
  const texts = new Map<string, string | null>();
  const text = (path: string) => {
    if (!texts.has(path))
      texts.set(path, store.fileSnapshot(path)?.text ?? null);
    return texts.get(path)!;
  };
  const failedByPath = new Map(failed.map((f) => [f.path, f.reason]));
  return {
    summarize: (symbol, reason) => ({
      graphId: symbol.id,
      language: symbol.module,
      path: symbol.file,
      kind: symbol.kind,
      identity: symbol.identity,
      name: symbol.name,
      line: locations.locate(symbol.file, symbol.range)?.line ?? null,
      ...(reason ? { reason } : {}),
    }),
    fingerprint: (symbol) =>
      fingerprintText(
        (text(symbol.file) ?? "").slice(symbol.range.start, symbol.range.end),
      ),
    inFile: (path) => store.findSymbols({ file: path }),
    named: (identity) => store.namedSymbols(identity, 10001),
    fileStatus: (path) => {
      if (failedByPath.has(path))
        return { status: "failed", reason: failedByPath.get(path)! };
      const file = store.getFile(path);
      if (!file) return null;
      if (file.result.status !== "clean")
        return {
          status: file.result.status,
          reason:
            file.result.diagnostics[0]?.message ??
            `File parsed ${file.result.status}`,
        };
      return { status: "clean", reason: "" };
    },
  };
}
const sameIdentity = (s: GraphSymbol, ref: CodeSymbolRef) =>
  s.module === ref.language &&
  s.kind === ref.kind &&
  s.identity === ref.identity;

function resolveOne(
  link: StoredCodeLink,
  view: GraphView,
  failed: GraphResponse["failedFiles"],
  recordPresent: boolean,
): ResolvedCodeLink {
  const ref = link.symbol;
  const base = {
    link,
    recordPresent,
    current: null,
    differs: [] as ResolvedCodeLink["differs"],
    suggestions: [] as SymbolSummary[],
    unverifiableFile: null,
    mayBeHiddenBy: [] as string[],
  };
  const compare = (symbol: GraphSymbol) => {
    const now = view.fingerprint(symbol);
    const differs: ResolvedCodeLink["differs"] = [];
    if (now.signature !== link.fingerprint.signature) differs.push("signature");
    if (now.body !== link.fingerprint.body) differs.push("body");
    return differs;
  };
  const status = view.fileStatus(ref.path);
  const here = view.inFile(ref.path).filter((s) => sameIdentity(s, ref));
  const atPath =
    here.length === 1 ? here[0] : here.find((s) => s.ordinal === ref.ordinal);
  if (status && status.status === "failed")
    return {
      ...base,
      state: "unverifiable",
      unverifiableFile: { path: ref.path, reason: status.reason },
      message: `File ${ref.path} failed to parse (${status.reason}); the link cannot be checked.`,
    };
  if (atPath) {
    const differs = compare(atPath);
    return {
      ...base,
      state: differs.length ? "changed" : "ok",
      current: view.summarize(atPath),
      differs,
      message: differs.length
        ? `Symbol ${ref.identity} changed (${differs.join(", ")}) since it was linked.`
        : `Symbol ${ref.identity} found unchanged.`,
    };
  }
  if (status && status.status === "partial")
    return {
      ...base,
      state: "unverifiable",
      unverifiableFile: { path: ref.path, reason: status.reason },
      message: `File ${ref.path} parsed only partially (${status.reason}) and the symbol was not found in it; the link cannot be checked.`,
    };
  // Not at its path: look for the same identity elsewhere (same language).
  const hidden = failed
    .filter((f) => f.language === ref.language || f.language === null)
    .map((f) => f.path);
  const elsewhere = view
    .named(ref.identity)
    .filter((s) => sameIdentity(s, ref) && s.file !== ref.path);
  const partialHiding = [
    ...new Set(
      view
        .named(ref.identity)
        .map((s) => s.file)
        .filter((p) => view.fileStatus(p)?.status === "partial"),
    ),
  ];
  const mayBeHiddenBy = [...new Set([...hidden, ...partialHiding])].sort();
  if (elsewhere.length === 1 && !mayBeHiddenBy.length) {
    const moved = elsewhere[0]!;
    const differs = ["path" as const, ...compare(moved)];
    return {
      ...base,
      state: "moved",
      current: view.summarize(moved),
      differs,
      message: `Symbol ${ref.identity} is now in ${moved.file}${differs.length > 1 ? ` and its ${differs.slice(1).join(", ")} changed` : ""}.`,
    };
  }
  const suggestions: SymbolSummary[] = elsewhere.map((s) =>
    view.summarize(
      s,
      elsewhere.length > 1
        ? "same identity in another file (several; not chosen)"
        : "same identity in another file (failed files could hide another)",
    ),
  );
  // Renamed in place: same kind, same body text in the original file.
  if (link.fingerprint.body)
    for (const s of view.inFile(ref.path))
      if (
        s.module === ref.language &&
        s.kind === ref.kind &&
        view.fingerprint(s).body === link.fingerprint.body
      )
        suggestions.push(
          view.summarize(
            s,
            "same kind and identical body in the linked file (renamed?)",
          ),
        );
  return {
    ...base,
    state: "missing",
    suggestions: suggestions.slice(0, 20),
    mayBeHiddenBy,
    message: `Symbol ${ref.identity} (${ref.kind}) was not found${status ? ` in ${ref.path}` : `; ${ref.path} is no longer indexed`}.${suggestions.length ? " Suggestions are listed; relink explicitly if one is right." : ""}${mayBeHiddenBy.length ? ` Failed or partial files may hide it: ${mayBeHiddenBy.join(", ")}.` : ""}`,
  };
}

async function resolveAll(
  root: string,
  links: StoredCodeLink[],
  records: ArchitectureEntity[],
  options: CodeLinkOptions,
) {
  const { summary } = await syncGraph(root, options);
  const present = new Set(records.map((r) => r.id));
  const graph = openGraph(root);
  if (!graph)
    return {
      graph: summary,
      resolved: links.map((link) => ({
        link,
        state: "missing" as const,
        recordPresent: present.has(link.record),
        current: null,
        differs: [],
        suggestions: [],
        unverifiableFile: null,
        mayBeHiddenBy: [],
        message: "No code graph exists.",
      })),
    };
  try {
    return {
      graph: summary,
      resolved: graph.readCommandSnapshot(() => {
        const view = graphView(graph, summary.failedFiles);
        return links.map((link) =>
          resolveOne(link, view, summary.failedFiles, present.has(link.record)),
        );
      }),
    };
  } finally {
    graph.close();
  }
}

// ---------------------------------------------------------------- requirements

export interface CreateRequirementInput extends CodeLinkOptions {
  /** Record ID, e.g. `R1` (stored as `plan:R1`). */
  id: string;
  title: string;
  text?: string;
  /** Planning kind; default `requirement`. */
  kind?:
    | "requirement"
    | "decision"
    | "component"
    | "risk"
    | "milestone"
    | "test";
  owner?: string;
}
export interface CreateRequirementResult {
  schema: typeof codeLinkSchema;
  status: "created";
  record: { id: string; title: string; kind: string; document: string };
  checkpoint: string;
}
/** Creates a planning record through the same path Studio uses (a new checkpoint
 * of `architecture/plan.json`), so IDs, history and integrity rules are shared. */
export async function createRequirement(
  input: CreateRequirementInput,
): Promise<CreateRequirementResult> {
  const root = await projectRoot(input.root);
  const { StudioService } = await import("../studio/service.js");
  const service = new StudioService(root);
  try {
    const head = (await service.architectureOverview())?.index?.id ?? "";
    const item = {
      ...newPlanItem(input.id.replace(/^plan:/, "")),
      kind: input.kind ?? "requirement",
      title: input.title,
      detail: input.text ?? "",
      owner: input.owner ?? "unassigned",
    };
    const saved = (await service.savePlanItem(
      head,
      item,
      `Add ${item.kind} ${item.id}`,
      input.signal ?? new AbortController().signal,
    )) as { id: string };
    return {
      schema: codeLinkSchema,
      status: "created",
      record: {
        id: "plan:" + item.id,
        title: item.title,
        kind: item.kind,
        document: "architecture/plan.json",
      },
      checkpoint: saved.id,
    };
  } finally {
    await service.close();
  }
}

// ---------------------------------------------------------------- links

export interface CreateCodeLinkInput extends CodeLinkOptions {
  /** Planning record: `R1`, `plan:R1` or its exact title. */
  record: string;
  /** Exactly as `pymtheg graph symbol` accepts: name, qualified identity, `symbol:…` ID, `path:line[:column]`. */
  selector: string;
  note?: string;
}
export interface CreateCodeLinkResult {
  schema: typeof codeLinkSchema;
  /** `created`; `exists` (same link already active, unchanged); otherwise nothing was written. */
  status:
    | "created"
    | "exists"
    | "ambiguous"
    | "not-found"
    | "record-not-found"
    | "record-ambiguous"
    | "unreadable";
  link: StoredCodeLink | null;
  /** Ambiguous/not-found selector: the graph's matches (nothing created). */
  matches: SymbolSummary[];
  records: { id: string; title: string }[];
  graph: GraphSummary | null;
  message: string;
}
const summarizeLocated = (
  s: GraphSymbol & { line?: number },
): SymbolSummary => ({
  graphId: s.id,
  language: s.module,
  path: s.file,
  kind: s.kind,
  identity: s.identity,
  name: s.name,
  line: typeof s.line === "number" ? s.line : null,
});
export async function createCodeLink(
  input: CreateCodeLinkInput,
): Promise<CreateCodeLinkResult> {
  const root = await projectRoot(input.root);
  return withStore(root, true, input.writer, async (store) => {
    const records = planningRecords(store);
    const chosen = selectRecord(records, input.record);
    const empty = { link: null, matches: [], records: [], graph: null };
    if (!chosen.ok)
      return {
        schema: codeLinkSchema,
        ...empty,
        status: chosen.matches.length ? "record-ambiguous" : "record-not-found",
        records: chosen.matches.map((r) => ({ id: r.id, title: r.name })),
        message: chosen.matches.length
          ? `“${input.record}” names several planning records; use a record ID. Nothing was linked.`
          : `No planning record “${input.record}”. Create it with “link requirement”. Nothing was linked.`,
      };
    const response = await executeGraph(
      {
        command: "symbol",
        args: [input.selector],
        root,
        noSync: input.noSync ?? false,
      },
      input.signal ? { signal: input.signal } : {},
    );
    const graph: GraphSummary = {
      complete: response.sync.complete,
      syncMode: response.sync.mode,
      failedFiles: response.failedFiles,
      staleFiles: response.staleFiles.map((f) => f.path),
      warnings: response.warnings.map((w) => `${w.code}: ${w.message}`),
    };
    const data = (response.data ?? {}) as {
      symbol?: GraphSymbol & { line?: number };
      inputs?: { matches: (GraphSymbol & { line?: number })[] }[];
    };
    if (!data.symbol) {
      const matches = (data.inputs?.[0]?.matches ?? []).map(summarizeLocated);
      const failedNote = response.failedFiles.length
        ? ` Failed files may hide it: ${response.failedFiles.map((f) => f.path).join(", ")}.`
        : "";
      return {
        schema: codeLinkSchema,
        ...empty,
        graph,
        status: matches.length ? "ambiguous" : "not-found",
        matches,
        message: matches.length
          ? `Selector “${input.selector}” matches ${matches.length} symbols; choose one (a symbol: ID or path:line). Nothing was linked.`
          : `No symbol matches “${input.selector}”.${failedNote} Nothing was linked.`,
      };
    }
    const symbol = data.symbol;
    const graphStore = openGraph(root)!;
    let fingerprint: CodeFingerprint, fileState: string, reason: string;
    try {
      ({ fingerprint, fileState, reason } = graphStore.readCommandSnapshot(
        () => {
          const view = graphView(graphStore, response.failedFiles);
          const current = graphStore.getSymbol(symbol.id);
          if (!current) throw Error("Graph changed while linking; retry.");
          const state = view.fileStatus(symbol.file);
          return {
            fingerprint: view.fingerprint(current),
            fileState: state?.status ?? "missing",
            reason: state?.reason ?? "",
          };
        },
      ));
    } finally {
      graphStore.close();
    }
    if (fileState !== "clean")
      return {
        schema: codeLinkSchema,
        ...empty,
        graph,
        status: "unreadable",
        message: `File ${symbol.file} is ${fileState}${reason ? ` (${reason})` : ""}; links into code that did not parse cleanly are refused. Nothing was linked.`,
      };
    const ref: CodeSymbolRef = {
      language: symbol.module,
      path: symbol.file,
      kind: symbol.kind,
      identity: symbol.identity,
      name: symbol.name,
      ordinal: symbol.ordinal,
    };
    const value = {
      record: chosen.record.id,
      symbol: ref,
      fingerprint,
      hint: { line: symbol.line ?? 0, graphId: symbol.id },
      created: new Date().toISOString(),
      refreshed: null,
      note: input.note ?? "",
    };
    if (input.writer) value.created = input.writer.now();
    const key = JSON.stringify([
      chosen.record.id,
      ref.language,
      ref.path,
      ref.kind,
      ref.identity,
      ref.ordinal,
    ]);
    // A link whose symbol has since moved keeps its original key; still refuse a
    // second active link from the same record to the same current symbol.
    const existing = readLinks(store).find(
      (l) => l.record === chosen.record.id && l.hint.graphId === symbol.id,
    );
    const written = existing
      ? { id: existing.id, changed: false }
      : store!.writeCodeLink(key, value, true);
    const link = readLinks(store).find((l) => l.id === written.id)!;
    return {
      schema: codeLinkSchema,
      ...empty,
      graph,
      status: written.changed ? "created" : "exists",
      link,
      message: written.changed
        ? `Linked ${chosen.record.id} to ${ref.language} ${ref.kind} ${ref.identity} in ${ref.path}.`
        : `${chosen.record.id} is already linked to ${ref.identity} (link ${link.id}). Nothing changed.`,
    };
  });
}

export interface CodeLinkIdInput extends CodeLinkOptions {
  /** Link UUID, or a unique prefix of at least 8 characters. */
  link: string;
}
export interface RemoveCodeLinkResult {
  schema: typeof codeLinkSchema;
  status: "removed";
  link: StoredCodeLink;
}
export async function removeCodeLink(
  input: CodeLinkIdInput,
): Promise<RemoveCodeLinkResult> {
  const root = await projectRoot(input.root);
  return withStore(root, true, input.writer, (store) => {
    const link = findLink(readLinks(store), input.link);
    const row = store!.codeLinkRows().find((r) => r.id === link.id)!;
    store!.writeCodeLink(row.key, null);
    return {
      schema: codeLinkSchema,
      status: "removed" as const,
      link: { ...link, removed: true },
    };
  });
}

export interface RefreshCodeLinkResult {
  schema: typeof codeLinkSchema;
  status: "refreshed" | "unchanged" | "refused";
  before: ResolvedCodeLink;
  link: StoredCodeLink;
  message: string;
}
/** Explicitly accepts the current symbol (after review) for an ok, changed or
 * moved link: re-records fingerprint, path and hint. Same link ID. Missing and
 * unverifiable links are refused: relink them explicitly. */
export async function refreshCodeLink(
  input: CodeLinkIdInput,
): Promise<RefreshCodeLinkResult> {
  const root = await projectRoot(input.root);
  return withStore(root, true, input.writer, async (store) => {
    const link = findLink(readLinks(store), input.link);
    const { resolved } = await resolveAll(
      root,
      [link],
      planningRecords(store),
      input,
    );
    const before = resolved[0]!;
    if (
      !before.current ||
      before.state === "missing" ||
      before.state === "unverifiable"
    )
      return {
        schema: codeLinkSchema,
        status: "refused" as const,
        before,
        link,
        message: `Link ${link.id} is ${before.state}; only ok, changed or moved links can be refreshed. ${before.message}`,
      };
    if (before.state === "ok")
      return {
        schema: codeLinkSchema,
        status: "unchanged" as const,
        before,
        link,
        message: "Link is already up to date.",
      };
    const graph = openGraph(root)!;
    let fingerprint: CodeFingerprint, symbol: GraphSymbol;
    try {
      ({ fingerprint, symbol } = graph.readCommandSnapshot(() => {
        const s = graph.getSymbol(before.current!.graphId);
        if (!s) throw Error("Graph changed while refreshing; retry.");
        return { symbol: s, fingerprint: graphView(graph, []).fingerprint(s) };
      }));
    } finally {
      graph.close();
    }
    const row = store!.codeLinkRows().find((r) => r.id === link.id)!;
    const { id: _id, removed: _removed, ...stored } = link;
    void _id;
    void _removed;
    store!.writeCodeLink(row.key, {
      ...stored,
      symbol: {
        language: symbol.module,
        path: symbol.file,
        kind: symbol.kind,
        identity: symbol.identity,
        name: symbol.name,
        ordinal: symbol.ordinal,
      },
      fingerprint,
      hint: { line: before.current.line ?? 0, graphId: symbol.id },
      refreshed: input.writer ? input.writer.now() : new Date().toISOString(),
    });
    return {
      schema: codeLinkSchema,
      status: "refreshed" as const,
      before,
      link: readLinks(store).find((l) => l.id === link.id)!,
      message: `Link ${link.id} now records ${symbol.identity} in ${symbol.file} as reviewed.`,
    };
  });
}

export interface ListCodeLinksInput extends CodeLinkOptions {
  /** Planning record (`R1`, `plan:R1` or title). */
  record?: string;
  /** Graph selector; links whose current (or recorded) symbol it selects. */
  symbol?: string;
  /** Project-relative path; links whose current or recorded symbol is in it. */
  file?: string;
}
export interface ListCodeLinksResult {
  schema: typeof codeLinkSchema;
  links: ResolvedCodeLink[];
  counts: Record<CodeLinkState, number>;
  graph: GraphSummary;
}
const countStates = (links: ResolvedCodeLink[]) => {
  const counts: Record<CodeLinkState, number> = {
    ok: 0,
    changed: 0,
    moved: 0,
    missing: 0,
    unverifiable: 0,
  };
  for (const l of links) counts[l.state]++;
  return counts;
};
export async function listCodeLinks(
  input: ListCodeLinksInput = {},
): Promise<ListCodeLinksResult> {
  const root = await projectRoot(input.root);
  return withStore(root, false, input.writer, async (store) => {
    const records = planningRecords(store);
    let links = readLinks(store);
    if (input.record !== undefined) {
      const chosen = selectRecord(records, input.record);
      const id = chosen.ok
        ? chosen.record.id
        : input.record.startsWith("plan:")
          ? input.record
          : "plan:" + input.record;
      links = links.filter((l) => l.record === id);
    }
    let selected: string | null = null;
    if (input.symbol !== undefined) {
      const response = await executeGraph(
        {
          command: "symbol",
          args: [input.symbol],
          root,
          noSync: input.noSync ?? false,
        },
        input.signal ? { signal: input.signal } : {},
      );
      const symbol = (response.data as { symbol?: GraphSymbol } | null)?.symbol;
      if (!symbol)
        throw Error(
          `Selector “${input.symbol}” does not select exactly one symbol (${response.status}). Use “graph symbol” to choose.`,
        );
      selected = symbol.id;
    }
    const { resolved, graph } = await resolveAll(root, links, records, {
      ...input,
      noSync: input.noSync || input.symbol !== undefined,
    });
    const filtered = resolved.filter(
      (r) =>
        (selected === null ||
          r.current?.graphId === selected ||
          (!r.current && r.link.hint.graphId === selected)) &&
        (input.file === undefined ||
          r.current?.path === input.file ||
          r.link.symbol.path === input.file),
    );
    return {
      schema: codeLinkSchema,
      links: filtered,
      counts: countStates(filtered),
      graph,
    };
  });
}

export interface CheckCodeLinksResult extends ListCodeLinksResult {
  /** True when no link is missing, changed, unverifiable, or moved with changed content. */
  passed: boolean;
  /** Links that fail the check (also included in `links`). */
  failing: string[];
  /** Links whose planning record no longer exists (reported; not a failure). */
  orphaned: string[];
}
export const failsCheck = (r: ResolvedCodeLink) =>
  r.state === "missing" ||
  r.state === "changed" ||
  r.state === "unverifiable" ||
  (r.state === "moved" && r.differs.some((d) => d !== "path"));
export async function checkCodeLinks(
  input: CodeLinkOptions = {},
): Promise<CheckCodeLinksResult> {
  const listed = await listCodeLinks(input);
  const failing = listed.links.filter(failsCheck).map((r) => r.link.id);
  return {
    ...listed,
    passed: failing.length === 0,
    failing,
    orphaned: listed.links
      .filter((r) => !r.recordPresent)
      .map((r) => r.link.id),
  };
}

// ---------------------------------------------------------------- queries

export interface RequirementsForInput extends CodeLinkOptions {
  /** Graph selector (as `graph symbol`). Exactly one of symbol/file. */
  symbol?: string;
  /** Project-relative path. */
  file?: string;
  /** Also follow definite callers (transitively) of the symbol(s), depth-bounded. */
  impact?: boolean;
  /** Impact depth, 0–100 (default 5). */
  depth?: number;
}
export interface RequirementTouch {
  record: string;
  title: string | null;
  link: string;
  /** Symbol the link resolves to (or its recorded identity if unresolved). */
  symbol: SymbolSummary | CodeSymbolRef;
  state: CodeLinkState;
  /** `direct`: linked to the symbol/a symbol in the file; `caller`: linked to a definite caller. */
  via: "direct" | "caller";
  distance: number;
}
export interface RequirementsForResult {
  schema: typeof codeLinkSchema;
  touched: RequirementTouch[];
  /** Records touched, deduplicated, in order of nearest distance. */
  records: string[];
  /** Impact traversal hit a bound, or unresolved/candidate calls exist (callers may be missing). */
  impactIncomplete: boolean;
  impactNotes: string[];
  graph: GraphSummary;
}
export async function requirementsFor(
  input: RequirementsForInput,
): Promise<RequirementsForResult> {
  if ((input.symbol === undefined) === (input.file === undefined))
    throw Error("Give exactly one of a symbol selector or a file path");
  const root = await projectRoot(input.root);
  return withStore(root, false, input.writer, async (store) => {
    const records = planningRecords(store);
    const titles = new Map(records.map((r) => [r.id, r.name]));
    const { resolved, graph } = await resolveAll(
      root,
      readLinks(store),
      records,
      input,
    );
    const starts: string[] = [];
    if (input.symbol !== undefined) {
      const response = await executeGraph(
        { command: "symbol", args: [input.symbol], root, noSync: true },
        input.signal ? { signal: input.signal } : {},
      );
      const symbol = (response.data as { symbol?: GraphSymbol } | null)?.symbol;
      if (!symbol)
        throw Error(
          `Selector “${input.symbol}” does not select exactly one symbol (${response.status}). Use “graph symbol” to choose.`,
        );
      starts.push(symbol.id);
    } else {
      const response = await executeGraph(
        {
          command: "file",
          args: [input.file!],
          root,
          noSync: true,
          limit: 10000,
        },
        input.signal ? { signal: input.signal } : {},
      );
      for (const s of (response.data?.symbols ?? []) as GraphSymbol[])
        starts.push(s.id);
    }
    const distance = new Map<string, number>(starts.map((id) => [id, 0]));
    let impactIncomplete = false;
    const impactNotes: string[] = [];
    if (input.impact)
      for (const id of starts) {
        const response = await executeGraph(
          {
            command: "impact",
            args: [id],
            root,
            noSync: true,
            depth: input.depth ?? 5,
          },
          input.signal ? { signal: input.signal } : {},
        );
        if (response.truncated) impactIncomplete = true;
        for (const w of response.warnings)
          if (["unresolved-coverage", "query-bound"].includes(w.code)) {
            impactIncomplete = true;
            if (!impactNotes.includes(w.message)) impactNotes.push(w.message);
          }
        for (const caller of (response.data?.callers ?? []) as {
          symbol: GraphSymbol;
          certainty: string;
          distance: number;
        }[])
          if (caller.certainty === "definite")
            distance.set(
              caller.symbol.id,
              Math.min(
                distance.get(caller.symbol.id) ?? Infinity,
                caller.distance,
              ),
            );
          else impactIncomplete = true;
      }
    const touched: RequirementTouch[] = [];
    for (const r of resolved) {
      const id = r.current?.graphId ?? null;
      const inFile =
        input.file !== undefined &&
        (r.current?.path === input.file ||
          (!r.current && r.link.symbol.path === input.file));
      const d = id !== null ? distance.get(id) : undefined;
      if (d === undefined && !inFile) continue;
      touched.push({
        record: r.link.record,
        title: titles.get(r.link.record) ?? null,
        link: r.link.id,
        symbol: r.current ?? r.link.symbol,
        state: r.state,
        via: d === undefined || d === 0 ? "direct" : "caller",
        distance: d ?? 0,
      });
    }
    touched.sort(
      (a, b) =>
        a.distance - b.distance ||
        (a.record < b.record ? -1 : a.record > b.record ? 1 : 0),
    );
    return {
      schema: codeLinkSchema,
      touched,
      records: [...new Set(touched.map((t) => t.record))],
      impactIncomplete,
      impactNotes,
      graph,
    };
  });
}

export interface UnlinkedInput extends CodeLinkOptions {
  /** Also list public/exported symbols with no link (opt-in, bounded). */
  symbols?: boolean;
  /** Maximum symbols returned (default 200, at most 10000). */
  limit?: number;
}
export interface UnlinkedResult {
  schema: typeof codeLinkSchema;
  /** Requirement records with no active code link. */
  requirements: { id: string; title: string }[];
  /** Present only with `symbols: true`. Public by a per-language rule (see `publicRule`). */
  symbols: SymbolSummary[] | null;
  symbolsTruncated: boolean;
  publicRule: string;
  graph: GraphSummary | null;
}
const publicKinds = new Set([
  "function",
  "method",
  "struct",
  "interface",
  "type",
  "class",
  "enum",
  "trait",
  "union",
]);
export async function unlinkedWork(
  input: UnlinkedInput = {},
): Promise<UnlinkedResult> {
  const root = await projectRoot(input.root);
  const limit = input.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw Error("Limit must be an integer from 1 to 10000");
  return withStore(root, false, input.writer, async (store) => {
    const records = planningRecords(store);
    const links = readLinks(store);
    const linked = new Set(links.map((l) => l.record));
    const requirements = records
      .filter(
        (r) => r.kind === "requirement" && !linked.has(r.id) && !r.conflictOf,
      )
      .map((r) => ({ id: r.id, title: r.name }));
    const publicRule =
      "Go: name starts with an upper-case letter; Rust: recorded visibility starts with `pub`; TypeScript/JavaScript: declaration text starts with `export`. Kinds: " +
      [...publicKinds].join(", ") +
      ". Test files and symbols in failed files are not listed.";
    if (!input.symbols)
      return {
        schema: codeLinkSchema,
        requirements,
        symbols: null,
        symbolsTruncated: false,
        publicRule,
        graph: null,
      };
    const { resolved, graph } = await resolveAll(root, links, records, input);
    const linkedIds = new Set(
      resolved.map((r) => r.current?.graphId ?? r.link.hint.graphId),
    );
    const store2 = openGraph(root);
    const symbols: SymbolSummary[] = [];
    let truncated = false;
    if (store2)
      try {
        store2.readCommandSnapshot(() => {
          const view = graphView(store2, graph.failedFiles);
          const texts = new Map<string, string>();
          for (const s of store2.findSymbols()) {
            if (!publicKinds.has(s.kind) || linkedIds.has(s.id)) continue;
            if (
              /(_test\.go|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?)$/.test(
                s.file,
              )
            )
              continue;
            const data = (s.data ?? {}) as { visibility?: string };
            let isPublic = false;
            if (s.module === "go") isPublic = /^\p{Lu}/u.test(s.name);
            else if (s.module === "rust")
              isPublic =
                typeof data.visibility === "string" &&
                data.visibility.startsWith("pub");
            else if (s.module === "typescript") {
              if (!texts.has(s.file))
                texts.set(s.file, store2.fileSnapshot(s.file)?.text ?? "");
              isPublic = texts.get(s.file)!.startsWith("export", s.range.start);
            }
            if (!isPublic) continue;
            if (symbols.length >= limit) {
              truncated = true;
              break;
            }
            symbols.push(view.summarize(s));
          }
        });
      } finally {
        store2.close();
      }
    symbols.sort((a, b) =>
      a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : (a.line ?? 0) - (b.line ?? 0),
    );
    return {
      schema: codeLinkSchema,
      requirements,
      symbols,
      symbolsTruncated: truncated,
      publicRule,
      graph,
    };
  });
}

export interface CodeLinkHistoryEntry {
  /** Link UUID. */
  link: string;
  /** Earlier link UUID for the same key (re-added after removal). */
  previous: string | null;
  sequence: number;
  time: string;
  author: string;
  change: "added" | "updated" | "removed";
  record: string;
  symbol: CodeSymbolRef;
}
export interface CodeLinkHistoryResult {
  schema: typeof codeLinkSchema;
  entries: CodeLinkHistoryEntry[];
}
/** Recorded changes for code links, in recorded-change order. */
export async function codeLinkHistory(
  input: CodeLinkOptions = {},
): Promise<CodeLinkHistoryResult> {
  const root = await projectRoot(input.root);
  return withStore(root, false, input.writer, (store) => {
    if (!store) return { schema: codeLinkSchema, entries: [] };
    const exported = store.exportRecordedHistory();
    const linkRecords = new Map(
      exported.records
        .filter((r) => r.kind === "code-link")
        .map((r) => [r.id, r]),
    );
    const bodies = new Map(readLinks(store, true).map((l) => [l.id, l]));
    const entries: CodeLinkHistoryEntry[] = [];
    for (const change of exported.changes)
      for (const delta of change.changes) {
        const record = linkRecords.get(delta.record);
        const body = bodies.get(delta.record);
        if (!record || !body) continue;
        entries.push({
          link: delta.record,
          previous: record.previous ?? null,
          sequence: change.sequence,
          time: change.time,
          author: change.origin.author,
          change:
            delta.after === null
              ? "removed"
              : delta.before === null
                ? "added"
                : "updated",
          record: body.record,
          symbol: body.symbol,
        });
      }
    return { schema: codeLinkSchema, entries };
  });
}
