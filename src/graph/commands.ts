// SPDX-License-Identifier: MIT
import { lstat, realpath } from "node:fs/promises";
import {
  checkpointSchema,
  checkpointFrom,
  readCheckpoint,
  readMetadata,
  fingerprint,
} from "./command-checkpoint.js";
import { checkDependencyInputs } from "./dependency-inputs.js";
import { performance } from "node:perf_hooks";
import { findProjectRoot, storagePath } from "../storage/local.js";
import {
  discoverLanguages,
  LanguageRegistry,
  matchesPattern,
} from "./registry.js";
import { SqliteGraphStore } from "./store.js";
import { indexProject, type IndexReport } from "./indexer.js";
import { stage, stageSync } from "./work.js";
import {
  captureInventory,
  changedFiles,
  type InventoryListing,
  type StaleFile,
} from "./command-snapshot.js";
import { queryGraph, type QueryCommand } from "./command-queries.js";
import {
  goToolchainKey,
  toolchainState,
  type ToolchainState,
} from "./command-toolchain.js";
import { loadConfig } from "../project/config.js";
import { graphToolchains } from "../shared/config.js";
import { dirname, join } from "node:path";

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
    /** Links whose only target is a library outside the project. */
    library: number;
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
  /**
   * The opt-in toolchain route (`graph.toolchain` in .pymtheg/settings.json):
   * absent when the project has not opted in (off).
   */
  toolchain?: ToolchainState;
}
export interface GraphExecutionOptions {
  signal?: AbortSignal;
  progress?: ((progress: GraphProgress) => void) | undefined;
  /** Tests/embedders may supply a registry; the CLI always discovers production modules. */
  registry?: LanguageRegistry;
  /**
   * C-50 (the shape of C-48's hook): told when a language module's
   * synchronous code begins (true) and ends (false). Between those, the
   * module may run for long without passing a cancellation checkpoint, so a
   * caller that must cancel promptly ends the work another way. A call that
   * returns a promise ends the section when it returns: while it is awaited,
   * the event loop runs and the abort signal reaches the module. The hook
   * may throw to refuse the call (a cancellation set before it).
   */
  onModuleCall?: (inside: boolean) => void;
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
  uses: 1,
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
    ((request.args?.length ?? 0) !== arity[request.command] &&
      // uses <unit> [symbol]
      !(request.command === "uses" && request.args?.length === 2))
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
  const registry =
    options.registry ?? (await stage("command.modules", discoverLanguages));
  // An explicit index first verifies on a read-only connection, which
  // writes nothing to the file (C-33). It opens the writable store only if
  // it has to index.
  const verifyFirst = request.command === "index" && !options.registry;
  let store: SqliteGraphStore | null = null;
  if (exists)
    try {
      store = stageSync(
        "command.sqliteOpen",
        () =>
          new SqliteGraphStore(path, undefined, {
            readOnly:
              request.command === "status" ||
              (!!request.noSync && request.command !== "index") ||
              verifyFirst,
          }),
      );
    } catch (error) {
      // The writable store reports it, or prepares the file, when indexing.
      if (!verifyFirst) throw error;
    }
  try {
    const listing: InventoryListing = {
      discovered: 0,
      unclaimed: [],
      ignoredSymlinks: [],
    };
    let inventory = await stage("command.inventory", () =>
      captureInventory(
        root,
        registry,
        signal,
        request.command === "index" ? listing : undefined,
      ),
    );
    const previousState = stageSync("command.checkpointRead", () =>
      readCheckpoint(store),
    );
    let metadata =
      previousState ?? stageSync("command.metadata", () => readMetadata(store));
    // An installed input whose bytes are unchanged but whose stamp moved
    // (a hard link, a permission change) is no change, but the index records
    // the new stamp as a cold index would (C-22), so it is not verified.
    let restamped = false;
    const staleFiles = () => {
      const inputs = checkDependencyInputs(root, metadata.contexts);
      restamped = inputs.restamped;
      return [
        ...changedFiles(inventory, metadata, registry),
        ...inputs.changed.map((path) => ({
          path,
          change: "context" as const,
        })),
      ];
    };
    let stale = staleFiles();
    const retryable = metadata.files.some(
      (file) => file.status === "failed" && !file.cacheable,
    );
    // The opt-in toolchain route (W3-L2). No settings file is off; an
    // unreadable one is off too, with a warning.
    let toolchains: Record<string, boolean | string> = {};
    let settingsError: string | null = null;
    try {
      toolchains = graphToolchains((await loadConfig(root)).config);
    } catch (error) {
      settingsError = error instanceof Error ? error.message : String(error);
    }
    const toolchainOn = Object.keys(toolchains).length > 0;
    const settings = {
      excludes: [".git", "node_modules", ".codegraph", ".pymtheg"],
      toolchains: toolchainOn ? toolchains : "disabled",
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
    const toolchainDirectory = join(
      dirname(storagePath(root, "graph")),
      "toolchain",
    );
    // The completion and the analysis completion are read again in one
    // snapshot, which supplies the answer. The analysis completion names
    // each incremental module that owns a stored file, as an index run
    // records it (C-27).
    let verified: ReturnType<typeof checkpointFrom> = null;
    if (
      verifyFirst &&
      store &&
      !toolchainOn &&
      complete &&
      !retryable &&
      !restamped &&
      stale.length === 0
    ) {
      const reader = store;
      const snapshot = stageSync("command.checkpointRead", () =>
        reader.verifiedCommandState(),
      );
      const state =
        snapshot && checkpointFrom(snapshot.state, reader.projectId);
      const expected = new Map(
        registry.modules
          .filter(
            (module) =>
              module.incrementalAnalysis &&
              state?.files.some((file) => file.module === module.id),
          )
          .map((module) => [module.id, module.version]),
      );
      if (
        state?.fingerprint === currentFingerprint() &&
        snapshot!.analysisRecorded === expected.size > 0 &&
        snapshot!.analysis.size === expected.size &&
        [...expected].every(
          ([id, version]) => snapshot!.analysis.get(id) === version,
        )
      )
        verified = state;
    }
    const verifiedNoEdit = verified !== null;
    const wouldIndex =
      (request.command === "index" && !verifiedNoEdit) ||
      (request.command !== "status" &&
        !request.noSync &&
        (!exists || stale.length > 0 || retryable || !complete));
    // The toolchain's inputs (Go version, go.sum, local replace targets, Go
    // files the index does not capture) are outside the inventory: a query
    // that would otherwise be answered unchanged recomputes the Go route's
    // key (its fingerprint pass) and syncs unless it equals the recorded one.
    const recordedKey = (previousState as { toolchain?: ToolchainState } | null)
      ?.toolchain?.go.key;
    const toolchainCurrent =
      wouldIndex ||
      !toolchainOn ||
      request.command === "status" ||
      request.noSync
        ? true
        : recordedKey !== undefined &&
          (await goToolchainKey(
            root,
            toolchains.go!,
            inventory,
            toolchainDirectory,
            signal,
          )) === recordedKey;
    const shouldIndex = wouldIndex || !toolchainCurrent;
    let report: IndexReport | null = null;
    let durationMs: number | null = null;
    if (shouldIndex) {
      if (verifyFirst && store) {
        store.close();
        store = null;
      }
      store ??= stageSync(
        "command.sqliteOpen",
        () => new SqliteGraphStore(storagePath(root, "graph", true)),
      );
      // No completion is removed up front: an index run removes it in the
      // same commit as its first write, so a run that changes nothing
      // writes nothing (C-6, C-22). A run that ends without completing
      // removes it below. The store refuses a completion if another index
      // run has begun writing since this one began; the data version, read
      // when the run has finished, covers writes after it.
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
      // A module's synchronous code, announced to `onModuleCall` (C-50).
      const inModule = <T>(call: () => T | Promise<T>): Promise<T> => {
        let pending: T | Promise<T>;
        options.onModuleCall?.(true);
        try {
          signal.throwIfAborted();
          pending = call();
        } finally {
          options.onModuleCall?.(false);
        }
        return Promise.resolve(pending);
      };
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
                    return await inModule(() => module.parse!(source));
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
                  const result = await inModule(() => module.analyze!(context));
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
                  const result = await inModule(() => module.resolve!(context));
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
            return value.apply(target, args);
          };
        },
      });
      const started = performance.now();
      options.progress?.({ phase: "inventory", done: 0, total });
      const indexed = await indexProject(root, tracked, adapter, {
        excludeDirectories: [".pymtheg"],
        onFileCompared: (path) => {
          signal.throwIfAborted();
          options.progress?.({
            phase: "inventory",
            done: ++captured,
            total,
            path,
          });
        },
        ...(options.signal || toolchainOn ? { signal } : {}),
        ...(toolchainOn
          ? {
              toolchains,
              toolchainDirectory,
            }
          : {}),
      });
      report = indexed;
      signal.throwIfAborted();
      const dataVersion = store.commandDataVersion();
      durationMs = performance.now() - started;
      exists = true;
      // A second hash check reports edits made during a long index instead of claiming freshness.
      inventory = await stage("command.inventory", () =>
        captureInventory(root, registry, signal),
      );
      metadata = await stage("command.metadata", () => readMetadata(store!));
      stale = staleFiles();
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
        stageSync("command.checkpointWrite", () =>
          currentStore.completeGraphCommandState(
            {
              schema: checkpointSchema,
              projectId: currentStore.projectId,
              configuration,
              settings,
              inventory,
              ...metadata,
              fingerprint: currentFingerprint(),
              ...(toolchainOn
                ? { toolchain: toolchainState(toolchains, indexed.toolchains) }
                : {}),
            },
            dataVersion,
          ),
        );
      else store.invalidateGraphCommandState();
      options.progress?.({ phase: "complete", done: total, total });
    }
    const finish = (): GraphResponse => {
      const finalState = verifiedNoEdit
        ? verified
        : stageSync("command.checkpointRead", () => readCheckpoint(store));
      metadata = finalState ?? readMetadata(store);
      const trusted = finalState?.fingerprint === currentFingerprint();
      const files = metadata.files;
      const contexts = metadata.contexts;
      if (verifiedNoEdit && trusted) {
        const { symbols, links, unresolved, ambiguous, library } =
          metadata.counts;
        const failed = files
          .filter((file) => file.status === "failed")
          .map((file) => file.path);
        const partial = files
          .filter((file) => file.status === "partial")
          .map((file) => file.path);
        report = {
          ...listing,
          unclaimed: listing.unclaimed.sort(),
          ignoredSymlinks: listing.ignoredSymlinks.sort(),
          claimed: files.length,
          indexed: 0,
          unchanged: files.length,
          removed: 0,
          analyzed: 0,
          symbols,
          links,
          unresolved,
          ambiguous,
          library,
          contextFiles: inventory.filter((file) => file.context).length,
          unclaimedCount: listing.unclaimed.length,
          failedCount: failed.length,
          partialCount: partial.length,
          failed,
          partial,
          errors: [],
          analysisErrors: [],
          resolutionErrors: [],
        };
        durationMs = 0;
      }
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
      if (toolchainOn)
        response.toolchain = report
          ? toolchainState(toolchains, report.toolchains)
          : ((finalState as { toolchain?: ToolchainState } | null)
              ?.toolchain ?? {
              setting: toolchains,
              go: { state: "not-indexed" },
            });
      // status and --no-sync never run the toolchain: whatever its inputs did
      // since the last sync (Go version, go.sum, a local replace target, Go
      // files the index does not capture) is not seen. Say so.
      if (toolchainOn && (request.command === "status" || request.noSync))
        response.warnings.push({
          code: "toolchain-inputs-not-rechecked",
          message:
            "Toolchain-backed facts are as recorded at the last sync; the toolchain's inputs (Go version, go.mod/go.sum, local replace targets, Go files outside the index) were not re-checked. Sync (a query without --no-sync, or graph index) to re-check them.",
          files: [],
        });
      if (settingsError)
        response.warnings.push({
          code: "settings-unreadable",
          message: `.pymtheg/settings.json could not be read, so toolchain-backed links are off: ${settingsError}`,
          files: [],
        });
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
        ["callers", "impact", "path", "uses"].includes(request.command) &&
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
    const response = store ? store.readCommandSnapshot(finish) : finish();
    if (verifiedNoEdit && response.sync.report) {
      const total = response.sync.report.claimed;
      options.progress?.({ phase: "complete", done: total, total });
    }
    return response;
  } finally {
    stageSync("command.sqliteClose", () => store?.close());
  }
}
