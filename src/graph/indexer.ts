// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { toolchainWorkDirectory } from "../project/local-trust.js";
import { join, resolve } from "node:path";
import { compare, contentHash, validateResult } from "./identity.js";
import { resolutionFacts } from "./analysis.js";
import {
  checkDependencyInputs,
  DependencyInputs,
} from "./dependency-inputs.js";
import { matchesPattern, type LanguageRegistry } from "./registry.js";
import { count, stage } from "./work.js";
import type { KeptState } from "./session.js";
import type {
  AnalysisPath,
  AnalyzedFile,
  ContextFile,
  GraphFile,
  GraphStorage,
  Json,
  LanguageModule,
  LinkResolution,
  ParseResult,
  ResolutionResult,
  ToolchainRequest,
  ValidatedAnalysis,
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
  /** Per module that reported one: the analysis path and why (C-38A). */
  analysisPaths?: ({ module: string } & AnalysisPath)[];
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
  /** Progress through the captured files when comparing them with storage. */
  onFileCompared?: (path: string) => void;
  /** C-45: each module's kept state, when the index runs in a session. */
  kept?: (module: LanguageModule) => KeptState | undefined;
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
  const keptFor = new Map<string, KeptState | undefined>();
  const kept = (module: LanguageModule): KeptState | undefined => {
    if (!options.kept) return undefined;
    if (!keptFor.has(module.id)) keptFor.set(module.id, options.kept(module));
    return keptFor.get(module.id);
  };
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
  // The run begins before it walks the tree and reads the store, so that any
  // other run's write from here on stops this one before it writes (C-22;
  // C-62: the walk too, so a file another run indexes after this run's walk
  // is never deleted by it). A mark found here belongs to a run that did not
  // finish or is still running: it may have replaced some files' records and
  // not others, while each still matches its source hash, so nothing it
  // touched can be trusted as unchanged.
  const unfinished =
    (await stage("store.beginRun", () => store.beginIndexRun?.())) === true;
  await stage("index.walk", () => walk(""));
  paths.sort(compare);
  const completed = await stage("store.beginRun", () =>
    store.completedAnalysis?.(),
  );
  const indexedBefore =
    (await stage("store.beginRun", () => store.indexedBefore?.())) === true;
  // Storage reads are deliberately outside all source/module error catches, before any writes.
  const oldFiles = await stage("index.previous", () => summaries(store));
  const oldFileByPath = new Map(oldFiles.map((file) => [file.path, file]));
  const oldContexts = await stage("index.previous", () => store.contexts());
  const claims = new Map<string, LanguageModule>();
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
        unfinished ||
        JSON.stringify(oldContextByPath.get(path)) !==
          JSON.stringify(contextByPath.get(path)),
    )
    .sort(compare);
  const updates: GraphFile[] = [];
  const cacheableFailures = new Set<string>();
  const changed = new Set<string>();
  // A change in ownership or membership can affect project-wide lookups.
  const canReuse =
    !unfinished &&
    completed &&
    store.beginIndexRun &&
    store.finishIndexRun &&
    store.analysisLinksAt &&
    store.moduleInputLinksAt &&
    claims.size === oldFiles.length &&
    oldFiles.every((file) => claims.get(file.path)?.id === file.module);
  const previousFiles = new Map<string, GraphFile>();
  const incompatible = new Set<string>();
  for (const [path, module] of claims) {
    const source = captures.get(path)!;
    options.onFileCompared?.(path);
    const trusted = completed?.get(module.id) === module.version;
    const reuse =
      canReuse === true && module.incrementalAnalysis === true && trusted;
    // A direct store write can remove parsed links even while the source hash
    // still matches. Rebuild parse facts as well when the completion is gone.
    const rebuild =
      !!completed && module.incrementalAnalysis === true && !trusted;
    const previous = await stage("index.previous", () =>
      previousParse(store, source, module, oldFileByPath.get(path), {
        unfinished,
        rebuild,
        reuse,
      }),
    );
    if (previous.unchanged) {
      report.unchanged++;
      continue;
    }
    if (reuse) {
      if (previous.file) previousFiles.set(path, previous.file);
      else incompatible.add(module.id);
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
  // After an unfinished run every claimed file counts as changed, so no
  // module reuses an earlier analysis.
  if (unfinished) for (const path of claims.keys()) changed.add(path);
  // C-53: the parse results of a module that analyses are held until its
  // analysis and written once, with the analysed result, instead of being
  // written here and replaced there. A run stopped in between leaves its
  // unfinished mark, so the next run trusts no record and parses again.
  // Each held file is kept as the record the store would hold, so what a
  // module does to its analysis input never reaches a stored record.
  const deferred = new Map<string, string[]>();
  for (const module of registry.modules)
    if (module.analyze) deferred.set(module.id, []);
  // Modules that may reuse their earlier analysis are handed the previous
  // records of the files they are given again (C-27).
  const reusing = new Set<string>();
  if (canReuse)
    for (const module of registry.modules)
      if (
        module.incrementalAnalysis &&
        module.analyze &&
        completed?.get(module.id) === module.version &&
        !incompatible.has(module.id)
      )
        reusing.add(module.id);
  // C-62: before its first write publishes anything, under that write's
  // lock, the run checks that its capture is still the tree on disk: the
  // same walk, and the same text for every file it writes and every context
  // file. Another run, even one that wrote nothing because it found the tree
  // current, may have seen a newer tree than this run captured; then this
  // run writes nothing. A run that writes nothing never checks.
  {
    // Only paths a module claims or reads as context can change what the
    // run writes: a file of no module (a store kept in the tree, its
    // journal) may come and go.
    const relevant = (path: string): boolean => {
      try {
        if (registry.claim(path)) return true;
      } catch {
        return true;
      }
      return registry.modules.some((module) => needsContext(module, path));
    };
    const expected = new Map<string, string>();
    for (const file of updates)
      expected.set(file.path, captures.get(file.path)?.hash ?? "");
    for (const file of contexts) expected.set(file.path, file.hash);
    store.verifyIndexCapture?.(
      () =>
        sameWalk(root, excluded, options.excludeFiles, paths, relevant) &&
        [...expected].every(([path, hash]) => {
          let now = "";
          try {
            const bytes = readFileSync(join(root, path));
            count("index.verifiedFiles");
            count("index.verifiedBytes", bytes.length);
            now = contentHash(bytes);
          } catch {
            // Unreadable now, as a failed capture is: its hash is "".
          }
          return now === hash;
        }),
    );
  }
  const writeParsed = async (file: GraphFile) => {
    await store.replaceFile(file, cacheableFailures.has(file.path));
    report.indexed++;
  };
  // C-37: a run's file writes commit in bounded batches where the store can.
  const batched = <T>(action: () => Promise<T>): Promise<T> =>
    store.writeBatch ? store.writeBatch(action) : action();
  await stage("store.writeParsed", () =>
    batched(async () => {
      await store.replaceContexts([
        ...contexts,
        ...[...dependencies.values()].flat(),
      ]);
      for (const file of updates) {
        const pending = deferred.get(file.module);
        if (pending) pending.push(JSON.stringify(file));
        else {
          previousFiles.delete(file.path);
          await writeParsed(file);
        }
      }
      // A run holding files that its parse write used to write marks the
      // store here, as that write did: from now on any other run finds it
      // unfinished and takes over, so this run cannot later write analysis
      // of a tree that another run has already found current. This holds for
      // a module reusing its analysis too (C-27, C-36): without the claim, a
      // run that begins during that analysis finds no write since its start,
      // answers without writing, and this run then writes its analysis of
      // the older text (C-38A; the Go race test). A run stopped in such an
      // analysis therefore leaves its unfinished mark over the previous
      // complete rows.
      if ([...deferred].some(([, files]) => files.length))
        await store.claimIndexRun?.();
    }),
  );
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
  const resolutionScopes = new Map<string, ReadonlySet<string>>();
  const analyzeModule = async (module: LanguageModule): Promise<void> => {
    // Only this module's records are decoded when the store can list them.
    const files = await stage(`analyze.${module.id}.input`, async () =>
      store.filesAt && store.fileSummaries
        ? await store.filesAt(
            [...claims]
              .filter(([, owner]) => owner.id === module.id)
              .map(([path]) => path),
          )
        : (await store.files()).filter((file) => file.module === module.id),
    );
    count(`analyze.${module.id}.inputFiles`, files.length);
    const heldRecords = deferred.get(module.id);
    const pending = heldRecords?.map((text) => JSON.parse(text) as GraphFile);
    const heldRecord = new Map(
      pending?.map((file, index) => [file.path, heldRecords![index]!]),
    );
    if (pending?.length) {
      // A held file replaces its stored record; a new one joins in path
      // order, the order the store lists records in.
      const updatesByPath = new Map(pending.map((file) => [file.path, file]));
      for (const [index, file] of files.entries()) {
        files[index] = updatesByPath.get(file.path) ?? file;
        updatesByPath.delete(file.path);
      }
      if (updatesByPath.size) {
        files.push(...updatesByPath.values());
        files.sort((a, b) => compare(a.path, b.path));
      }
    }
    const reuse = reusing.has(module.id);
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
    // Inputs whose bytes are unchanged keep counting as unchanged however
    // their metadata moved; their records take the stamps they have now.
    const checkedInputs = checkDependencyInputs(root, previousInputs);
    let analysisFailed = false;
    let scope: ReadonlySet<string> | undefined;
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
                options.toolchainDirectory ?? toolchainWorkDirectory(root),
              environment: options.environment ?? process.env,
              ...(options.signal ? { signal: options.signal } : {}),
              note: (note) =>
                (report.toolchains ??= []).push({ module: module.id, note }),
            };
      const output = await stage(`analyze.${module.id}`, () =>
        module.analyze!({
          projectId: store.projectId,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(kept(module) ? { kept: kept(module)! } : {}),
          ...(toolchain ? { toolchain } : {}),
          ...(inputs && { dependencyInputs: inputs }),
          files,
          contextFiles: ownContexts,
          changedFiles: [...changed]
            .filter((path) => filesByPath.has(path) || oldPaths.has(path))
            .sort(compare),
          ...(reuse && pending && !toolchain
            ? {
                previousFiles: new Map(
                  pending.map((file) => [
                    file.path,
                    previousFiles.get(file.path)!,
                  ]),
                ),
              }
            : {}),
          changedContextFiles: [
            ...changedContexts.filter((path) => needsContext(module, path)),
            ...checkedInputs.changed,
          ],
          firstIndex: !indexedBefore,
          // A module with no files in this index has no path to report.
          ...(module.reportsAnalysisPath &&
            files.length > 0 && {
              notePath: (note: AnalysisPath) =>
                (report.analysisPaths ??= []).push({
                  module: module.id,
                  ...note,
                }),
            }),
        }),
      );
      if ("resolutionFiles" in output) {
        results = output.files;
        scope = new Set(output.resolutionFiles);
        if (
          !reuse ||
          !pending ||
          toolchain ||
          scope.size !== output.resolutionFiles.length ||
          [...scope].some((path) => !filesByPath.has(path)) ||
          pending.some((file) => !scope!.has(file.path)) ||
          results.some((file) => !scope!.has(file.path))
        )
          throw Error("Invalid scoped project analysis");
      } else results = output;
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
      scope = undefined;
      report.analysisErrors.push({ module: module.id, message: detail });
      results = files.map((file) => ({
        path: file.path,
        result: failure(detail),
      }));
    }
    if (inputs?.refreshed)
      dependencies.set(module.id, analysisFailed ? [] : inputs.records());
    else if (checkedInputs.restamped)
      dependencies.set(module.id, checkedInputs.current);
    if (scope) resolutionScopes.set(module.id, scope);
    const pendingPaths = new Set(pending?.map((file) => file.path));
    await stage(`analyze.${module.id}.write`, () =>
      batched(async () => {
        // Each held file is written once: with its analysed result when the
        // module returned one, else as parsed. A scoped write therefore never
        // removes a still-valid derived symbol from an edited file between
        // parse and analysis (SQLite would clear incoming links that the
        // resolver has proved can be left alone).
        const analyzedPaths = new Set(results.map((file) => file.path));
        for (const file of pending ?? [])
          if (!analyzedPaths.has(file.path))
            await writeParsed(
              JSON.parse(heldRecord.get(file.path)!) as GraphFile,
            );
        report.indexed += pending
          ? pending.filter((file) => analyzedPaths.has(file.path)).length
          : 0;
        for (const item of results) {
          const file = filesByPath.get(item.path)!;
          const held = pendingPaths.has(file.path);
          const differs =
            JSON.stringify(file.result) !== JSON.stringify(item.result);
          if (held || differs) {
            if ((scope && held) || differs)
              count(`analyze.${module.id}.filesChanged`);
            // A held file's parse failure is cacheable exactly when its
            // parse write would have recorded it.
            const parseFailure = held
              ? cacheableFailures.has(file.path)
              : (await store.isParseFailure?.(file.path)) === true;
            await store.replaceFile(
              { ...file, result: item.result },
              !analysisFailed &&
                item.result.status === "failed" &&
                item.result.failureKind !== "transient" &&
                // Analyze-only modules may explicitly certify a file-local content
                // failure. Unclassified analysis failures are never cached.
                (item.result.failureKind === "content" ||
                  (file.result.status === "failed" && parseFailure)),
            );
          }
          report.analyzed++;
        }
      }),
    );
    deferred.delete(module.id);
    if (pending) for (const file of pending) previousFiles.delete(file.path);
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
    let prepared: ValidatedAnalysis | undefined;
    const scope = resolutionScopes.get(module.id);
    try {
      if (
        ownContexts.some((file) => file.status === "failed") ||
        report.analysisErrors.some((error) => error.module === module.id)
      )
        throw Error("Project analysis/context is incomplete");
      // A module with no stored file can only return an empty result:
      // every resolution names one of its parsed links and every added
      // link one of its files. Its resolver is not handed the whole graph.
      const owns = modules.has(module.id);
      if (scope?.size === 0) return;
      const output = owns
        ? await runResolve(
            module,
            store,
            ownContexts,
            options.signal,
            scope,
            kept(module),
          )
        : [];
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
      if (scope && [...wanted].some((path) => !scope.has(path)))
        throw Error("Project resolution returned a link outside its scope");
      const needed = new Map<string, GraphFile>();
      if (wanted.size)
        for (const file of await read(() => filesAt(store, [...wanted])))
          needed.set(file.path, file);
      const ids =
        scope && store.symbolReferences ? referencedSymbols(result) : undefined;
      const symbols = owns
        ? await stage(`resolve.${module.id}.validationInput`, () =>
            ids
              ? read(() => store.symbolReferences!(ids))
              : read(() => store.findSymbols()),
          )
        : [];
      // Every link of the module when the store can take a validated
      // result; resolutionFacts reads only the parsed ones.
      const validated = !!scope || !!store.analysisLinks;
      const current = await stage(`resolve.${module.id}.validationInput`, () =>
        read(() =>
          scope
            ? store.analysisLinksAt!(module.id, scope)
            : validated
              ? store.analysisLinks!(module.id)
              : parsedLinks(store, module.id),
        ),
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
      if (validated) prepared = { current, desired };
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
    // C-37: a large resolution write commits in batches too.
    await stage(`resolve.${module.id}.write`, () =>
      batched(async () =>
        prepared
          ? store.replaceAnalysis(module.id, result, prepared)
          : store.replaceAnalysis(module.id, result),
      ),
    );
  };
  // The modules that own at least one stored file, after analysis.
  const modules = new Set((await summaries(store)).map((file) => file.module));
  for (const module of registry.modules) await resolveModule(module);
  const incremental = registry.modules.filter(
    (module) => module.incrementalAnalysis,
  );
  await stage("store.finishRun", () =>
    store.finishIndexRun?.(
      [...report.analysisErrors, ...report.resolutionErrors].some((error) =>
        incremental.some((module) => module.id === error.module),
      ),
      new Map(
        incremental
          .filter((module) => modules.has(module.id))
          .map((module) => [module.id, module.version]),
      ),
    ),
  );
  return await stage("index.report", () =>
    finishReport(store, report, contexts),
  );
}

function referencedSymbols(result: ResolutionResult): Set<string> {
  const ids = new Set<string>();
  for (const decision of [...result.resolutions, ...result.links]) {
    if (decision.targetId) ids.add(decision.targetId);
    for (const id of decision.candidateIds ?? []) ids.add(id);
  }
  for (const link of result.links) if (link.sourceId) ids.add(link.sourceId);
  return ids;
}

/** Keep decoded old facts only for edits that might use scoped analysis. */
async function previousParse(
  store: GraphStorage,
  source: ContextFile,
  module: LanguageModule,
  summary:
    | {
        module: string;
        version?: string;
        hash?: string;
        status: GraphFile["result"]["status"];
      }
    | undefined,
  options: { unfinished: boolean; rebuild: boolean; reuse: boolean },
): Promise<{ unchanged: boolean; file?: GraphFile }> {
  if (
    !options.unfinished &&
    !options.rebuild &&
    source.status === "clean" &&
    summary?.module === module.id &&
    summary.version === module.version &&
    summary.hash === source.hash &&
    summary.status !== "failed"
  )
    return { unchanged: true };
  const old = await store.getFile(source.path);
  const compatible =
    old?.module === module.id && old.version === module.version;
  // Every record of an unfinished run is written again, including records
  // whose hashes already match the captured files.
  if (
    !options.unfinished &&
    compatible &&
    source.status === "clean" &&
    old.hash === source.hash
  ) {
    if (old.result.status !== "failed") {
      if (!options.rebuild) return { unchanged: true };
    } else if (await store.isParseFailure?.(source.path)) {
      // A certified content failure can remain cached if it has no facts
      // to restore and its stored graph is still empty.
      if (
        !options.rebuild ||
        (old.result.symbols.length === 0 &&
          old.result.links.length === 0 &&
          (await store.findSymbols({ file: source.path })).length === 0 &&
          (await store.analysisLinksAt?.(module.id, new Set([source.path])))
            ?.length === 0)
      )
        return { unchanged: true };
    }
  }
  return {
    unchanged: false,
    ...(compatible && options.reuse ? { file: old } : {}),
  };
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

/**
 * One module's resolve over freshly read input. The input lives only in this
 * frame, so it is released when the module returns.
 */
async function runResolve(
  module: LanguageModule,
  store: GraphStorage,
  contexts: readonly ContextFile[],
  signal?: AbortSignal,
  resolutionFiles?: ReadonlySet<string>,
  kept?: KeptState,
): Promise<readonly LinkResolution[] | ResolutionResult> {
  if (!module.resolve) return [];
  // Only a store that declares independent reads is trusted not to share
  // records with itself or with the next module; any other gets a deep copy.
  const own = <T>(value: T): T =>
    store.independentReads === true ? value : structuredClone(value);
  // Each read is staged and counted, and evaluated as an argument: records
  // held in a named local of this frame outlived the module (C-2 memory test).
  const input = async <T>(what: string, load: () => Promise<T[]>) =>
    stage(`resolve.${module.id}.input`, async () => {
      const list = await load();
      count(`resolve.${module.id}.input${what}`, list.length);
      return list;
    });
  return (
    (await stage(`resolve.${module.id}.withInput`, async () =>
      module.resolve!({
        projectId: store.projectId,
        ...(signal ? { signal } : {}),
        ...(kept ? { kept } : {}),
        ...(resolutionFiles
          ? { resolutionFiles: new Set(resolutionFiles) }
          : {}),
        files:
          module.resolutionNeedsFiles === false
            ? []
            : await input("Files", async () =>
                own(
                  await read(() =>
                    resolutionFiles &&
                    module.scopedFileLinkKinds &&
                    store.resolutionFiles
                      ? store.resolutionFiles(module.scopedFileLinkKinds)
                      : store.files(),
                  ),
                ),
              ),
        contextFiles: structuredClone(contexts),
        symbols: await input("Symbols", async () =>
          own(await read(() => store.findSymbols())),
        ),
        // Only the parsed link records: their targets are cleared below anyway.
        // Presented unresolved: no target, candidates or library targets
        // from the previous run.
        links: (
          await input("Links", async () =>
            own(
              await read(async () =>
                resolutionFiles
                  ? await store.moduleInputLinksAt!(module.id, resolutionFiles)
                  : ((await store.moduleInputLinks?.(module.id)) ??
                    (await parsedLinks(store, module.id))),
              ),
            ),
          )
        ).map(({ libraries: _previous, ...link }) => ({
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

/**
 * C-62: whether the tree's relevant files are still the ones the run walked,
 * walked as the run walked it (synchronously: this runs under a write lock).
 */
function sameWalk(
  root: string,
  excluded: ReadonlySet<string>,
  excludeFiles: readonly string[] | undefined,
  walked: readonly string[],
  relevant: (path: string) => boolean,
): boolean {
  const paths = walked.filter(relevant);
  const found: string[] = [];
  const walk = (directory: string): void => {
    const entries = readdirSync(join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) walk(path);
      } else if (entry.isFile() && !excludeFiles?.includes(path))
        found.push(path);
    }
  };
  try {
    walk("");
  } catch {
    return false;
  }
  const kept = found.filter(relevant).sort(compare);
  return (
    kept.length === paths.length &&
    kept.every((path, index) => path === paths[index])
  );
}
