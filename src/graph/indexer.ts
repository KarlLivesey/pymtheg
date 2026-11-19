// SPDX-License-Identifier: MIT
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compare, contentHash, validateResult } from "./identity.js";
import { resolutionFacts } from "./analysis.js";
import {
  changedDependencyInputs,
  DependencyInputs,
} from "./dependency-inputs.js";
import { matchesPattern, type LanguageRegistry } from "./registry.js";
import { count, stage } from "./work.js";
import type {
  AnalyzedFile,
  ContextFile,
  GraphFile,
  GraphLink,
  GraphStorage,
  Json,
  LanguageModule,
  LinkResolution,
  ParseResult,
  ResolutionResult,
  ToolchainRequest,
} from "./types.js";

export interface IndexReport {
  discovered: number;
  claimed: number;
  indexed: number;
  unchanged: number;
  removed: number;
  analyzed: number;
  symbols: number;
  links: number;
  unresolved: number;
  ambiguous: number;
  /** Links whose only target is a library outside the project. */
  library: number;
  contextFiles: number;
  unclaimedCount: number;
  failedCount: number;
  partialCount: number;
  unclaimed: string[];
  failed: string[];
  partial: string[];
  ignoredSymlinks: string[];
  errors: { path: string; message: string }[];
  analysisErrors: { module: string; message: string }[];
  resolutionErrors: { module: string; message: string }[];
  /** Notes from opted-in toolchain routes; absent when no module made one. */
  toolchains?: { module: string; note: Json }[];
}
export interface IndexOptions {
  excludeDirectories?: readonly string[];
  excludeFiles?: readonly string[];
  /**
   * Opt-in toolchain routes, by module id (`graph.toolchain` in
   * .pymtheg/settings.json). A module not listed runs source-only.
   */
  toolchains?: Readonly<Record<string, Json>>;
  /** Rebuildable directory for toolchain routes (default <root>/.pymtheg/rebuildable/toolchain). */
  toolchainDirectory?: string;
  /** The environment a toolchain is located from (default process.env). */
  environment?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
}
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const failure = (detail: string): ParseResult => ({
  status: "failed",
  diagnostics: [{ message: detail }],
  symbols: [],
  links: [],
});
const needsContext = (module: LanguageModule, path: string) =>
  module.contextFiles?.some((pattern) => matchesPattern(path, pattern)) ??
  false;

export async function indexProject(
  root: string,
  registry: LanguageRegistry,
  store: GraphStorage,
  options: IndexOptions = {},
): Promise<IndexReport> {
  const report: IndexReport = {
    discovered: 0,
    claimed: 0,
    indexed: 0,
    unchanged: 0,
    removed: 0,
    analyzed: 0,
    symbols: 0,
    links: 0,
    unresolved: 0,
    ambiguous: 0,
    library: 0,
    contextFiles: 0,
    unclaimedCount: 0,
    failedCount: 0,
    partialCount: 0,
    unclaimed: [],
    failed: [],
    partial: [],
    ignoredSymlinks: [],
    errors: [],
    analysisErrors: [],
    resolutionErrors: [],
  };
  const paths: string[] = [];
  const excluded = new Set([
    ".git",
    "node_modules",
    ".codegraph",
    // The project's own Pymtheg storage (graph, toolchain helpers): never source.
    ".pymtheg",
    ...(options.excludeDirectories ?? []),
  ]);
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(join(root, directory), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) report.ignoredSymlinks.push(path);
      else if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) await walk(path);
      } else if (entry.isFile() && !options.excludeFiles?.includes(path))
        paths.push(path);
    }
  }
  await stage("index.walk", () => walk(""));
  paths.sort(compare);
  // Storage reads are deliberately outside all source/module error catches, before any writes.
  const oldFiles = await stage("index.previous", () => summaries(store));
  const oldContexts = await stage("index.previous", () => store.contexts());
  const claims = new Map<string, LanguageModule>();
  // Only what the cache check needs: never every previous record at once.
  const previous = new Map<string, Previous | undefined>();
  for (const path of paths) {
    report.discovered++;
    let module;
    try {
      module = registry.claim(path);
    } catch (error) {
      report.failed.push(path);
      report.errors.push({ path, message: message(error) });
      continue;
    }
    if (module) {
      claims.set(path, module);
      previous.set(
        path,
        await stage("index.previous", () => previousOf(store, path)),
      );
      report.claimed++;
    } else if (!registry.modules.some((module) => needsContext(module, path)))
      report.unclaimed.push(path);
  }
  const captures = new Map<string, ContextFile>();
  for (const path of paths)
    if (
      claims.has(path) ||
      registry.modules.some((module) => needsContext(module, path))
    ) {
      let hash = "";
      let text = "";
      let diagnostic: string | undefined;
      try {
        const bytes = await stage("index.read", () =>
          readFile(join(root, path)),
        );
        count("index.filesRead");
        count("index.bytesRead", bytes.length);
        hash = await stage("index.hash", () => contentHash(bytes));
        try {
          text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
        } catch {
          throw Error("Unsupported source encoding: expected valid UTF-8");
        }
      } catch (error) {
        diagnostic = message(error);
        report.errors.push({ path, message: diagnostic });
      }
      captures.set(path, {
        path,
        text,
        hash,
        status: diagnostic ? "failed" : "clean",
        diagnostics: diagnostic ? [{ message: diagnostic }] : [],
      });
    }
  const contexts = [...captures.values()].filter((file) =>
    registry.modules.some((module) => needsContext(module, file.path)),
  );
  const oldContextByPath = new Map(
    oldContexts
      .filter((file) => !file.dependency)
      .map((file) => [file.path, file]),
  );
  const dependencies = new Map(
    registry.modules
      .filter((module) => module.dependencyInputs)
      .map(
        (module) =>
          [
            module.id,
            oldContexts.filter((file) => file.dependency?.module === module.id),
          ] as const,
      ),
  );
  const contextByPath = new Map(contexts.map((file) => [file.path, file]));
  const changedContexts = [
    ...new Set([
      ...oldContextByPath.keys(),
      ...contexts.map((file) => file.path),
    ]),
  ]
    .filter(
      (path) =>
        JSON.stringify(oldContextByPath.get(path)) !==
        JSON.stringify(contextByPath.get(path)),
    )
    .sort(compare);
  const updates: GraphFile[] = [];
  const cacheableFailures = new Set<string>();
  const changed = new Set<string>();
  for (const [path, module] of claims) {
    const source = captures.get(path)!;
    const old = previous.get(path);
    if (
      source.status === "clean" &&
      old?.hash === source.hash &&
      old.module === module.id &&
      old.version === module.version &&
      (!old.failed || (await store.isParseFailure?.(path)))
    ) {
      report.unchanged++;
      continue;
    }
    let result: ParseResult;
    if (source.status === "failed")
      result = failure(source.diagnostics[0]!.message);
    else if (!module.parse) result = failure("Awaiting project analysis");
    else {
      try {
        count(`parse.${module.id}.files`);
        result = await stage(`parse.${module.id}`, () =>
          module.parse!({ path, text: source.text }),
        );
        validateResult(source.text, result);
        if (result.status === "failed" && result.failureKind !== "transient")
          cacheableFailures.add(path);
      } catch (error) {
        const detail = message(error);
        report.errors.push({ path, message: detail });
        result = failure(detail);
      }
    }
    updates.push({
      path,
      text: source.text,
      hash: source.hash,
      module: module.id,
      version: module.version,
      result,
    });
    changed.add(path);
  }
  await stage("store.writeParsed", async () => {
    await store.replaceContexts([
      ...contexts,
      ...[...dependencies.values()].flat(),
    ]);
    for (const file of updates) {
      await store.replaceFile(file, cacheableFailures.has(file.path));
      report.indexed++;
    }
  });
  // Written: release every captured text and parse result (C-2). Only the
  // context files and which captures failed are needed from here on.
  updates.length = 0;
  const unreadable = new Set(
    [...captures.values()]
      .filter((file) => file.status === "failed")
      .map((file) => file.path),
  );
  captures.clear();
  for (const file of oldFiles)
    if (!claims.has(file.path)) {
      await store.removeFile(file.path);
      changed.add(file.path);
      report.removed++;
    }
  // Each module's analysis runs in its own frame, so its input files and
  // results are released when it returns instead of lingering in this
  // function's suspended frame through the remaining phases (C-2).
  const analyzeModule = async (module: LanguageModule): Promise<void> => {
    // Only this module's records are decoded when the store can list them.
    const files = await stage(`analyze.${module.id}.input`, async () =>
      store.filesAt && store.fileSummaries
        ? await store.filesAt(
            (await store.fileSummaries())
              .filter((file) => file.module === module.id)
              .map((file) => file.path),
          )
        : (await store.files()).filter((file) => file.module === module.id),
    );
    count(`analyze.${module.id}.inputFiles`, files.length);
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const oldPaths = new Set(
      oldFiles
        .filter((file) => file.module === module.id)
        .map((file) => file.path),
    );
    const ownContexts = contexts.filter((file) =>
      needsContext(module, file.path),
    );
    let results: readonly AnalyzedFile[];
    const inputs = module.dependencyInputs
      ? new DependencyInputs(root, module.id)
      : undefined;
    const previousInputs = dependencies.get(module.id) ?? [];
    let analysisFailed = false;
    try {
      if (ownContexts.some((file) => file.status === "failed"))
        throw Error("Project context could not be captured");
      const setting = options.toolchains?.[module.id];
      const toolchain: ToolchainRequest | undefined =
        setting === undefined || setting === false || setting === null
          ? undefined
          : {
              root,
              setting,
              workDir:
                options.toolchainDirectory ??
                resolve(root, ".pymtheg", "rebuildable", "toolchain"),
              environment: options.environment ?? process.env,
              ...(options.signal ? { signal: options.signal } : {}),
              note: (note) =>
                (report.toolchains ??= []).push({ module: module.id, note }),
            };
      results = await stage(`analyze.${module.id}`, () =>
        module.analyze!({
          projectId: store.projectId,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(toolchain ? { toolchain } : {}),
          ...(inputs && { dependencyInputs: inputs }),
          files,
          contextFiles: ownContexts,
          changedFiles: [...changed]
            .filter((path) => filesByPath.has(path) || oldPaths.has(path))
            .sort(compare),
          changedContextFiles: [
            ...changedContexts.filter((path) => needsContext(module, path)),
            ...changedDependencyInputs(root, previousInputs),
          ],
        }),
      );
      const seen = new Set<string>();
      for (const item of results) {
        const file = filesByPath.get(item.path);
        if (!file || seen.has(item.path))
          throw Error("Project analysis returned a duplicate or foreign file");
        if (unreadable.has(item.path))
          throw Error("Project analysis cannot clean an unreadable source");
        validateResult(file.text, item.result);
        seen.add(item.path);
      }
      if (
        !module.parse &&
        files.some((file) => !unreadable.has(file.path) && !seen.has(file.path))
      )
        throw Error(
          "Analyze-only modules must return every readable captured file",
        );
    } catch (error) {
      // A source phase can reject with the caller's abort reason. Toolchain
      // diagnostics follow the module's normal report path.
      if (options.signal?.aborted && Object.is(error, options.signal.reason))
        throw error;
      const detail = message(error);
      analysisFailed = true;
      report.analysisErrors.push({ module: module.id, message: detail });
      results = files.map((file) => ({
        path: file.path,
        result: failure(detail),
      }));
    }
    if (inputs?.refreshed)
      dependencies.set(module.id, analysisFailed ? [] : inputs.records());
    await stage(`analyze.${module.id}.write`, async () => {
      for (const item of results) {
        const file = filesByPath.get(item.path)!;
        if (JSON.stringify(file.result) !== JSON.stringify(item.result)) {
          count(`analyze.${module.id}.filesChanged`);
          await store.replaceFile(
            { ...file, result: item.result },
            !analysisFailed &&
              item.result.status === "failed" &&
              item.result.failureKind !== "transient" &&
              // Analyze-only modules may explicitly certify a file-local content
              // failure. Unclassified analysis failures are never cached.
              (item.result.failureKind === "content" ||
                (file.result.status === "failed" &&
                  (await store.isParseFailure?.(file.path)) === true)),
          );
        }
        report.analyzed++;
      }
    });
  };
  for (const module of registry.modules)
    if (module.analyze) await analyzeModule(module);
  if (dependencies.size)
    await store.replaceContexts([
      ...contexts,
      ...[...dependencies.values()].flat(),
    ]);
  // Resolution reads the graph afresh for each module and keeps nothing
  // between modules: no whole-graph copy outlives the module that needs it.
  // A module's input is its own: records from a store that declares
  // independent reads, a deep copy otherwise. Its mutations cannot reach the
  // indexer, the store or the next module (C-2).
  const resolveModule = async (module: LanguageModule): Promise<void> => {
    const ownContexts = contexts.filter((file) =>
      needsContext(module, file.path),
    );
    let result: ResolutionResult = { resolutions: [], links: [] };
    const versionSources = new Set(
      [
        ...ownContexts,
        ...(dependencies.get(module.id) ?? []).filter(
          (file) => file.hash && file.path.endsWith("/package.json"),
        ),
      ]
        .filter((file) => file.status === "clean")
        .map((file) => file.path),
    );
    // The validated write, when the store takes one: the links read once
    // for validation are the links the write compares against.
    let prepared:
      | { current: readonly GraphLink[]; desired: readonly GraphLink[] }
      | undefined;
    try {
      if (
        ownContexts.some((file) => file.status === "failed") ||
        report.analysisErrors.some((error) => error.module === module.id)
      )
        throw Error("Project analysis/context is incomplete");
      const output = await runResolve(
        module,
        store,
        ownContexts,
        options.signal,
      );
      count(
        `resolve.${module.id}.resolutions`,
        Array.isArray(output)
          ? output.length
          : ((output as ResolutionResult).resolutions?.length ?? 0),
      );
      result = Array.isArray(output)
        ? { resolutions: output, links: [] }
        : (output as ResolutionResult);
      // Only files that receive added links are kept for validation. (Not
      // getFile: the command layer counts those calls as inventory progress.)
      const wanted = new Set<string>();
      try {
        for (const added of result.links)
          if (typeof added?.file === "string") wanted.add(added.file);
      } catch {
        // A malformed result: resolutionFacts reports it, in its own order.
      }
      const needed = new Map<string, GraphFile>();
      if (wanted.size)
        for (const file of await read(() => filesAt(store, [...wanted])))
          needed.set(file.path, file);
      const symbols = await read(() => store.findSymbols());
      // Every link of the module when the store can write a validated
      // result; resolutionFacts reads only the parsed ones.
      const whole = !!(store.analysisLinks && store.writeAnalysis);
      const current = await read(() =>
        whole ? store.analysisLinks!(module.id) : parsedLinks(store, module.id),
      );
      const desired = await stage(`resolve.${module.id}.validate`, () =>
        resolutionFacts(
          store.projectId,
          module.id,
          result,
          (path) => needed.get(path),
          symbols,
          current,
          // A library version must come from a context file this module read.
          (path) => versionSources.has(path),
        ),
      );
      if (whole) prepared = { current, desired };
    } catch (error) {
      prepared = undefined;
      // Storage errors propagate; they are not mislabeled as module failures.
      if (error instanceof StorageRead) throw error.cause;
      if (options.signal?.aborted && Object.is(error, options.signal.reason))
        throw error;
      report.resolutionErrors.push({
        module: module.id,
        message: message(error),
      });
      result = { resolutions: [], links: [] };
    }
    await stage(`resolve.${module.id}.write`, () =>
      prepared
        ? store.writeAnalysis!(prepared.current, prepared.desired)
        : store.replaceAnalysis(module.id, result),
    );
  };
  for (const module of registry.modules) await resolveModule(module);
  return await stage("index.report", () =>
    finishReport(store, report, contexts),
  );
}

async function finishReport(
  store: GraphStorage,
  report: IndexReport,
  contexts: readonly ContextFile[],
): Promise<IndexReport> {
  for (const file of await summaries(store))
    if (file.status !== "clean") report[file.status].push(file.path);
  for (const file of contexts)
    if (file.status === "failed") report.failed.push(file.path);
  report.failed = [...new Set(report.failed)].sort(compare);
  report.partial.sort(compare);
  report.unclaimed.sort(compare);
  report.contextFiles = contexts.length;
  report.unclaimedCount = report.unclaimed.length;
  report.failedCount = report.failed.length;
  report.partialCount = report.partial.length;
  const counts = await store.counts?.();
  report.symbols = counts?.symbols ?? (await store.findSymbols()).length;
  report.links = counts?.links ?? (await store.links()).length;
  report.unresolved = counts?.unresolved ?? (await store.unresolved()).length;
  report.ambiguous = counts?.ambiguous ?? (await store.ambiguous()).length;
  report.library =
    counts?.library ??
    (await store.links()).filter((link) => link.resolution === "library")
      .length;
  return report;
}

interface Previous {
  hash: string;
  module: string;
  version: string;
  failed: boolean;
}
/** The cache-check facts of a stored file; its decoded record is not kept. */
async function previousOf(
  store: GraphStorage,
  path: string,
): Promise<Previous | undefined> {
  const old = await store.getFile(path);
  return (
    old && {
      hash: old.hash,
      module: old.module,
      version: old.version,
      failed: old.result.status === "failed",
    }
  );
}
/**
 * One module's resolve over freshly read input. The input lives only in this
 * frame, so it is released when the module returns.
 */
async function runResolve(
  module: LanguageModule,
  store: GraphStorage,
  contexts: readonly ContextFile[],
  signal?: AbortSignal,
): Promise<readonly LinkResolution[] | ResolutionResult> {
  if (!module.resolve) return [];
  // Only a store that declares independent reads is trusted not to share
  // records with itself or with the next module; any other gets a deep copy.
  const own = <T>(value: T): T =>
    store.independentReads === true ? value : structuredClone(value);
  const input = await stage(`resolve.${module.id}.input`, async () => ({
    files: own(await read(() => store.files())),
    symbols: own(await read(() => store.findSymbols())),
    // Only the parsed link records: their targets are cleared below anyway.
    links: own(
      await read(
        async () =>
          (await store.moduleInputLinks?.(module.id)) ??
          (await parsedLinks(store, module.id)),
      ),
    ),
  }));
  count(`resolve.${module.id}.inputFiles`, input.files.length);
  count(`resolve.${module.id}.inputSymbols`, input.symbols.length);
  count(`resolve.${module.id}.inputLinks`, input.links.length);
  return (
    (await stage(`resolve.${module.id}`, () =>
      module.resolve!({
        projectId: store.projectId,
        ...(signal ? { signal } : {}),
        files: input.files,
        contextFiles: structuredClone(contexts),
        symbols: input.symbols,
        // Presented unresolved: no target, candidates or library targets
        // from the previous run.
        links: input.links.map(({ libraries: _previous, ...link }) => ({
          ...link,
          targetId: null,
          targetStatus: null,
          candidates: [],
          resolution: "unresolved" as const,
        })),
      }),
    )) ?? []
  );
}
/** A storage read inside a module's error boundary; its error propagates. */
class StorageRead extends Error {}
async function read<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new StorageRead("Storage read failed", { cause: error });
  }
}
async function summaries(store: GraphStorage) {
  return (
    (await store.fileSummaries?.()) ??
    (await store.files()).map((file) => ({
      path: file.path,
      module: file.module,
      status: file.result.status,
    }))
  );
}
/** Stored files at these paths; a store without filesAt is read in full and filtered. */
async function filesAt(store: GraphStorage, paths: readonly string[]) {
  if (store.filesAt) return await store.filesAt(paths);
  const wanted = new Set(paths);
  return (await store.files()).filter((file) => wanted.has(file.path));
}
async function parsedLinks(store: GraphStorage, module: string) {
  return (
    (await store.moduleLinks?.(module)) ??
    (await store.links()).filter(
      (link) => link.module === module && link.origin === "parse",
    )
  );
}
