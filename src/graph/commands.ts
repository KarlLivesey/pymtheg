import { lstat, realpath } from "node:fs/promises";
import {
  checkpointSchema,
  readCheckpoint,
  readMetadata,
  fingerprint,
} from "./command-checkpoint.js";
import { performance } from "node:perf_hooks";
import { findProjectRoot, storagePath } from "../storage/local.js";
import {
  discoverLanguages,
  LanguageRegistry,
  matchesPattern,
} from "./registry.js";
import { SqliteGraphStore } from "./store.js";
import { indexProject, type IndexReport } from "./indexer.js";
import {
  captureInventory,
  changedFiles,
  type StaleFile,
} from "./command-snapshot.js";
import { queryGraph, type QueryCommand } from "./command-queries.js";

export type GraphCommand = "index" | "status" | QueryCommand;
export interface GraphProgress {
  phase: string;
  done: number;
  total: number;
  path?: string;
  module?: string;
}
export interface GraphRequest {
  command: GraphCommand;
  args?: readonly string[];
  root?: string | undefined;
  noSync?: boolean;
  caseSensitive?: boolean;
  includePossible?: boolean;
  depth?: number | undefined;
  limit?: number | undefined;
}
export interface GraphResponse {
  schema: "pymtheg.graph/v1";
  command: GraphCommand;
  root: string;
  indexExists: boolean;
  status: "ok" | "incomplete" | "ambiguous" | "not-found" | "bounded";
  exitCode: number;
  sync: {
    mode: "index" | "updated" | "unchanged" | "disabled" | "status";
    durationMs: number | null;
    report: IndexReport | null;
    complete: boolean;
  };
  modules: {
    id: string;
    version: string;
    indexedVersions: string[];
    files: number;
  }[];
  counts: {
    files: number;
    symbols: number;
    links: number;
    failed: number;
    partial: number;
    unresolved: number;
    ambiguous: number;
  };
  failedFiles: {
    path: string;
    language: string | null;
    reason: string;
    range?: { start: number; end: number };
  }[];
  staleFiles: StaleFile[];
  warnings: { code: string; message: string; files: string[] }[];
  truncated: boolean;
  limit: number;
  resultCounts: {
    matches: number;
    symbols: number;
    links: number;
    callers: number;
    observedLinks: number;
  };
  data: Record<string, unknown> | null;
}
export interface GraphExecutionOptions {
  signal?: AbortSignal;
  progress?: ((progress: GraphProgress) => void) | undefined;
  /** Tests/embedders may supply a registry; the CLI always discovers production modules. */
  registry?: LanguageRegistry;
}
const arity: Record<GraphCommand, number> = {
  index: 0,
  status: 0,
  search: 1,
  symbol: 1,
  callers: 1,
  callees: 1,
  path: 2,
  impact: 1,
  file: 1,
};

/** Data-only entry point for CLI and future MCP wrappers. No stdout/stderr or module execution of project code. */
export async function executeGraph(
  request: GraphRequest,
  options: GraphExecutionOptions = {},
): Promise<GraphResponse> {
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  if (
    !(request.command in arity) ||
    (request.args?.length ?? 0) !== arity[request.command]
  )
    throw Error("Invalid graph subcommand or argument count");
  const depth = request.depth ?? 5,
    limit = request.limit ?? 1000;
  if (!Number.isInteger(depth) || depth < 0 || depth > 100)
    throw Error("Graph depth must be an integer from 0 to 100");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw Error("Graph limit must be an integer from 1 to 10000");
  const input = await realpath(request.root ?? ".");
  if (!(await lstat(input)).isDirectory())
    throw Error("Graph root must be a directory");
  const root = findProjectRoot(input);
  const path = storagePath(root, "graph"); // Includes the same legacy-layout/symlink refusal as init/studio.
  let exists = false;
  try {
    exists = (await lstat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const registry = options.registry ?? (await discoverLanguages());
  let store = exists
    ? new SqliteGraphStore(path, undefined, {
        readOnly:
          request.command === "status" ||
          (!!request.noSync && request.command !== "index"),
      })
    : null;
  try {
    let inventory = await captureInventory(root, registry, signal);
    const previousState = readCheckpoint(store);
    let metadata = previousState ?? readMetadata(store);
    let stale = changedFiles(inventory, metadata, registry);
    const retryable = metadata.files.some(
      (file) => file.status === "failed" && !file.cacheable,
    );
    const settings = {
      excludes: [".git", "node_modules", ".codegraph", ".pymtheg"],
      toolchains: "disabled",
    };
    const configuration = registry.modules.map((m) => ({
      id: m.id,
      version: m.version,
      extensions: m.extensions,
      filenames: m.filenames ?? [],
      patterns: m.patterns ?? [],
      contextFiles: m.contextFiles ?? [],
    }));
    const currentFingerprint = () =>
      fingerprint(
        store?.projectId,
        configuration,
        settings,
        inventory,
        metadata,
      );
    const complete = previousState?.fingerprint === currentFingerprint();
    const shouldIndex =
      request.command === "index" ||
      (request.command !== "status" &&
        !request.noSync &&
        (!exists || stale.length > 0 || retryable || !complete));
    let report: IndexReport | null = null;
    let durationMs: number | null = null;
    if (shouldIndex) {
      store ??= new SqliteGraphStore(storagePath(root, "graph", true));
      store.invalidateGraphCommandState();
      const dataVersion = store.commandDataVersion();
      const currentStore = store;
      let captured = 0,
        parsed = 0;
      const total = inventory.filter((file) => file.module).length;
      const dirty = new Set(stale.map((file) => file.path));
      const retry = new Set(
        metadata.files
          .filter((file) => file.status === "failed" && !file.cacheable)
          .map((file) => file.path),
      );
      const parseTotal = inventory.filter(
        (file) =>
          file.module &&
          !file.reason &&
          (dirty.has(file.path) || retry.has(file.path)) &&
          registry.modules.find((m) => m.id === file.module)?.parse,
      ).length;
      const tracked = new LanguageRegistry(
        registry.modules.map((module) => ({
          ...module,
          ...(module.parse
            ? {
                parse: async (
                  source: Parameters<NonNullable<typeof module.parse>>[0],
                ) => {
                  signal.throwIfAborted();
                  try {
                    return await module.parse!(source);
                  } finally {
                    options.progress?.({
                      phase: "parse",
                      done: ++parsed,
                      total: parseTotal,
                      path: source.path,
                      module: module.id,
                    });
                  }
                },
              }
            : {}),
          ...(module.analyze
            ? {
                analyze: async (
                  context: Parameters<NonNullable<typeof module.analyze>>[0],
                ) => {
                  signal.throwIfAborted();
                  options.progress?.({
                    phase: "analyze",
                    done: 0,
                    total: context.files.length,
                    module: module.id,
                  });
                  const result = await module.analyze!(context);
                  options.progress?.({
                    phase: "analyze",
                    done: context.files.length,
                    total: context.files.length,
                    module: module.id,
                  });
                  return result;
                },
              }
            : {}),
          ...(module.resolve
            ? {
                resolve: async (
                  context: Parameters<NonNullable<typeof module.resolve>>[0],
                ) => {
                  signal.throwIfAborted();
                  options.progress?.({
                    phase: "resolve",
                    done: 0,
                    total: context.files.length,
                    module: module.id,
                  });
                  const result = await module.resolve!(context);
                  options.progress?.({
                    phase: "resolve",
                    done: context.files.length,
                    total: context.files.length,
                    module: module.id,
                  });
                  return result;
                },
              }
            : {}),
        })),
      );
      const adapter = new Proxy(currentStore, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            signal.throwIfAborted();
            if (key === "getFile")
              options.progress?.({
                phase: "inventory",
                done: ++captured,
                total,
                path: args[0] as string,
              });
            return value.apply(target, args);
          };
        },
      });
      const started = performance.now();
      options.progress?.({ phase: "inventory", done: 0, total });
      report = await indexProject(root, tracked, adapter, {
        excludeDirectories: [".pymtheg"],
      });
      signal.throwIfAborted();
      durationMs = performance.now() - started;
      exists = true;
      // A second hash check reports edits made during a long index instead of claiming freshness.
      inventory = await captureInventory(root, registry, signal);
      metadata = readMetadata(store);
      stale = changedFiles(inventory, metadata, registry);
      const pending = metadata.files.some(
        (f) => f.status === "failed" && !f.cacheable,
      );
      if (
        !stale.length &&
        !pending &&
        !report.errors.length &&
        !report.analysisErrors.length &&
        !report.resolutionErrors.length
      )
        store.completeGraphCommandState(
          {
            schema: checkpointSchema,
            projectId: store.projectId,
            configuration,
            settings,
            inventory,
            ...metadata,
            fingerprint: currentFingerprint(),
          },
          dataVersion,
        );
      options.progress?.({ phase: "complete", done: total, total });
    }
    const finish = (): GraphResponse => {
      const finalState = readCheckpoint(store);
      metadata = finalState ?? readMetadata(store);
      const trusted = finalState?.fingerprint === currentFingerprint();
      const files = metadata.files;
      const contexts = metadata.contexts;
      const failed = new Map<string, GraphResponse["failedFiles"][number]>();
      for (const file of files)
        if (file.status === "failed")
          failed.set(file.path, {
            path: file.path,
            language: file.module,
            reason: file.diagnostic?.message ?? "Failed source",
            ...(file.diagnostic?.range ? { range: file.diagnostic.range } : {}),
          });
      for (const file of contexts)
        if (file.status === "failed")
          failed.set(file.path, {
            path: file.path,
            language: null,
            reason: file.diagnostic?.message ?? "Failed context capture",
          });
      for (const file of inventory)
        if (file.reason)
          failed.set(file.path, {
            path: file.path,
            language: file.module,
            reason: file.reason,
          });
      for (const error of report?.errors ?? [])
        if (report?.failed.includes(error.path))
          failed.set(error.path, {
            path: error.path,
            language: failed.get(error.path)?.language ?? null,
            reason: error.message,
          });
      const response: GraphResponse = {
        schema: "pymtheg.graph/v1",
        command: request.command,
        root,
        indexExists: exists,
        status: "ok",
        exitCode: 0,
        sync: {
          mode:
            request.command === "index"
              ? "index"
              : request.command === "status"
                ? "status"
                : request.noSync
                  ? "disabled"
                  : shouldIndex
                    ? "updated"
                    : "unchanged",
          durationMs,
          report,
          complete: trusted,
        },
        modules: registry.modules.map((m) => ({
          id: m.id,
          version: m.version,
          indexedVersions: [
            ...new Set(
              files.filter((f) => f.module === m.id).map((f) => f.version),
            ),
          ].sort(),
          files: files.filter((f) => f.module === m.id).length,
        })),
        counts: metadata.counts,
        failedFiles: [...failed.values()].sort((a, b) =>
          a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
        ),
        staleFiles: stale,
        warnings: [],
        truncated: false,
        limit,
        resultCounts: {
          matches: 0,
          symbols: 0,
          links: 0,
          callers: 0,
          observedLinks: 0,
        },
        data: null,
      };
      if (failed.size)
        response.warnings.push({
          code: "failed-files",
          message:
            "Failed files can hide declarations or affect resolution. Answers are incomplete; inspect every named file.",
          files: response.failedFiles.map((f) => f.path),
        });
      const partial = files
        .filter((file) => file.status === "partial")
        .map((file) => file.path);
      if (partial.length)
        response.warnings.push({
          code: "partial-files",
          message: "Partial files may have missing declarations.",
          files: partial,
        });
      if (stale.length)
        response.warnings.push({
          code: "stale-files",
          message:
            "Captured facts differ from current content or module versions; answers may be affected. Line/column values use the stored snapshot and may not match the current file.",
          files: stale.map((f) => f.path),
        });
      if (report?.analysisErrors.length || report?.resolutionErrors.length)
        response.warnings.push({
          code: "module-errors",
          message:
            "Some module phases failed; inspect sync.report. Unresolved links are not proof of absence.",
          files: [],
        });
      if (store && !trusted)
        response.warnings.push({
          code: "index-incomplete",
          message:
            "No matching completed command index is recorded for current inputs; sync is required before trusting stored answers.",
          files: [],
        });
      if (!store)
        response.warnings.push({
          code: "index-missing",
          message: "No graph index exists. Run graph index or enable sync.",
          files: [],
        });
      if (request.command === "status")
        response.data = {
          retryableFiles: files
            .filter((f) => f.status === "failed" && !f.cacheable)
            .map((f) => f.path),
        };
      else if (request.command !== "index" && store) {
        const query = queryGraph(
          store,
          request.command,
          request.args ?? [],
          depth,
          limit,
          request.caseSensitive ?? false,
          request.includePossible ?? false,
        );
        response.data = query.data;
        response.truncated = query.truncated;
        response.status = query.status;
      }
      if (
        ["callers", "impact", "path"].includes(request.command) &&
        response.counts.unresolved > 0
      )
        response.warnings.push({
          code: "unresolved-coverage",
          message:
            "Unresolved links may hide additional callers or paths; returned routes are observations, not a completeness proof.",
          files: [],
        });
      if (response.truncated)
        response.warnings.push({
          code: "query-bound",
          message:
            "Result reached a reported depth or result/node bound; omitted facts may exist.",
          files: [],
        });
      const data = response.data;
      const length = (value: unknown) =>
        Array.isArray(value) ? value.length : 0;
      response.resultCounts = {
        matches:
          length(data?.matches) +
          (Array.isArray(data?.inputs)
            ? data.inputs.reduce(
                (sum: number, item: { matches?: unknown }) =>
                  sum + length(item.matches),
                0,
              )
            : 0),
        symbols: length(data?.symbols) + (data?.symbol ? 1 : 0),
        links: length(data?.links),
        callers: length(data?.callers),
        observedLinks: length(data?.observedLinks),
      };
      const executionFailure =
        failed.size > 0 ||
        partial.length > 0 ||
        !!report?.errors.length ||
        !!report?.analysisErrors.length ||
        !!report?.resolutionErrors.length ||
        (request.command === "index" && !trusted) ||
        (request.command !== "status" && (!store || !finalState));
      if (executionFailure) {
        if (response.status === "ok") response.status = "incomplete";
        response.exitCode = 2;
      }
      return response;
    };
    return store ? store.readCommandSnapshot(finish) : finish();
  } finally {
    store?.close();
  }
}
