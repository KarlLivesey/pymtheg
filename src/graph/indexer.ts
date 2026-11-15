import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compare, contentHash, validateResult } from "./identity.js";
import { resolutionFacts } from "./analysis.js";
import { matchesPattern, type LanguageRegistry } from "./registry.js";
import type {
  AnalyzedFile,
  ContextFile,
  GraphFile,
  GraphStorage,
  Json,
  LanguageModule,
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
  await walk("");
  paths.sort(compare);
  // Storage reads are deliberately outside all source/module error catches, before any writes.
  const oldFiles = await store.files();
  const oldContexts = await store.contexts();
  const claims = new Map<string, LanguageModule>();
  const previous = new Map<string, GraphFile | undefined>();
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
      previous.set(path, await store.getFile(path));
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
        const bytes = await readFile(join(root, path));
        hash = contentHash(bytes);
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
    oldContexts.map((file) => [file.path, file]),
  );
  const contextByPath = new Map(contexts.map((file) => [file.path, file]));
  const changedContexts = [
    ...new Set([
      ...oldContexts.map((file) => file.path),
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
      (old.result.status !== "failed" || (await store.isParseFailure?.(path)))
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
        result = await module.parse({ path, text: source.text });
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
  await store.replaceContexts(contexts);
  for (const file of updates) {
    await store.replaceFile(file, cacheableFailures.has(file.path));
    report.indexed++;
  }
  for (const file of oldFiles)
    if (!claims.has(file.path)) {
      await store.removeFile(file.path);
      changed.add(file.path);
      report.removed++;
    }
  for (const module of registry.modules)
    if (module.analyze) {
      const files = (await store.files()).filter(
        (file) => file.module === module.id,
      );
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
        results = await module.analyze({
          projectId: store.projectId,
          ...(toolchain ? { toolchain } : {}),
          files,
          contextFiles: ownContexts,
          changedFiles: [...changed]
            .filter((path) => filesByPath.has(path) || oldPaths.has(path))
            .sort(compare),
          changedContextFiles: changedContexts.filter((path) =>
            needsContext(module, path),
          ),
        });
        const seen = new Set<string>();
        for (const item of results) {
          const file = filesByPath.get(item.path);
          if (!file || seen.has(item.path))
            throw Error(
              "Project analysis returned a duplicate or foreign file",
            );
          if (captures.get(item.path)?.status === "failed")
            throw Error("Project analysis cannot clean an unreadable source");
          validateResult(file.text, item.result);
          seen.add(item.path);
        }
        if (
          !module.parse &&
          files.some(
            (file) =>
              captures.get(file.path)?.status !== "failed" &&
              !seen.has(file.path),
          )
        )
          throw Error(
            "Analyze-only modules must return every readable captured file",
          );
      } catch (error) {
        const detail = message(error);
        analysisFailed = true;
        report.analysisErrors.push({ module: module.id, message: detail });
        results = files.map((file) => ({
          path: file.path,
          result: failure(detail),
        }));
      }
      for (const item of results) {
        const file = filesByPath.get(item.path)!;
        if (JSON.stringify(file.result) !== JSON.stringify(item.result))
          await store.replaceFile(
            { ...file, result: item.result },
            !analysisFailed &&
              file.result.status === "failed" &&
              item.result.status === "failed" &&
              item.result.failureKind !== "transient" &&
              (await store.isParseFailure?.(file.path)) === true,
          );
        report.analyzed++;
      }
    }
  const files = await store.files();
  const symbols = await store.findSymbols();
  const links = await store.links();
  for (const module of registry.modules) {
    const ownContexts = contexts.filter((file) =>
      needsContext(module, file.path),
    );
    const own = links
      .filter((link) => link.module === module.id && link.origin === "parse")
      .map((link) => ({
        ...link,
        targetId: null,
        targetStatus: null,
        candidates: [],
        resolution: "unresolved" as const,
      }));
    let result: ResolutionResult = { resolutions: [], links: [] };
    try {
      if (
        ownContexts.some((file) => file.status === "failed") ||
        report.analysisErrors.some((error) => error.module === module.id)
      )
        throw Error("Project analysis/context is incomplete");
      const output =
        (await module.resolve?.({
          projectId: store.projectId,
          ...structuredClone({
            files,
            contextFiles: ownContexts,
            symbols,
            links: own,
          }),
        })) ?? [];
      result = Array.isArray(output)
        ? { resolutions: output, links: [] }
        : (output as ResolutionResult);
      resolutionFacts(
        store.projectId,
        module.id,
        result,
        files,
        symbols,
        links,
      );
    } catch (error) {
      report.resolutionErrors.push({
        module: module.id,
        message: message(error),
      });
      result = { resolutions: [], links: [] };
    }
    // Storage errors propagate; they are not mislabeled as module failures.
    await store.replaceAnalysis(module.id, result);
  }
  for (const file of files)
    if (file.result.status !== "clean")
      report[file.result.status].push(file.path);
  for (const file of contexts)
    if (file.status === "failed") report.failed.push(file.path);
  report.failed = [...new Set(report.failed)].sort(compare);
  report.partial.sort(compare);
  report.unclaimed.sort(compare);
  report.contextFiles = contexts.length;
  report.unclaimedCount = report.unclaimed.length;
  report.failedCount = report.failed.length;
  report.partialCount = report.partial.length;
  report.symbols = (await store.findSymbols()).length;
  report.links = (await store.links()).length;
  report.unresolved = (await store.unresolved()).length;
  report.ambiguous = (await store.ambiguous()).length;
  return report;
}
