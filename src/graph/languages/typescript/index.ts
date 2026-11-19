// SPDX-License-Identifier: MIT
import ts from "typescript";
import { contentHash } from "../../index.js";
import type {
  AnalyzedFile,
  Diagnostic,
  GraphFile,
  Json,
  LanguageModule,
  LibraryTarget,
  LinkDraft,
  LinkResolution,
  ParseResult,
} from "../../types.js";
import { CheckerLimit, extractFile, type TargetFact } from "./extract.js";
import { libraryKey, libraryReader } from "./library.js";
import type { Renamed } from "./rename.js";
import { neutralizeAssumed } from "./untrusted.js";

/** Program rebuilds per file after checker stack overflows before giving up. */
const MAX_LIMIT_RETRIES = 25;
/** Program rebuilds per project before the remaining files are not analysed. */
const MAX_PROGRAM_REBUILDS = 200;
const isStackLimit = (error: unknown) =>
  error instanceof RangeError && /call stack/i.test(error.message);
import {
  CONTEXT_PATTERNS,
  fromVirtual,
  projectModel,
  syntaxFailure,
  toVirtual,
} from "./project.js";

/**
 * TypeScript and JavaScript through the TypeScript compiler. Analyze-only: one
 * Program per owning config, built over the captured snapshot through a virtual
 * host. Analysis records each link's checker targets as (file, symbol key)
 * facts; resolve maps those facts to symbol IDs. See docs/changes/W2-D.md.
 */
// Bump the leading number whenever extraction or resolution semantics change.
const MODULE_VERSION = `32+typescript-${ts.version}`;

/** Observation counters for tests (programs built, files extracted). Not a correctness input. */
export const statistics = {
  programs: 0,
  extracted: 0,
  reused: 0,
  /** Neutral programs built for the differential analysis (untrusted.ts). */
  neutralPrograms: 0,
  neutralExtracted: 0,
};

// A file whose text re-encodes to its captured byte hash was readable; unreadable
// sources are stored with empty text and the hash of their original bytes.
const readable = (file: GraphFile) =>
  contentHash(Buffer.from(file.text, "utf8")) === file.hash;

/** A program and checker over one config's roots, rebuilt after overflows. */
interface Session {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly host: ts.CompilerHost;
  /** Parser and binder failures of this session's files. */
  readonly failures: Map<string, string>;
  rebuilds: number;
  /** Build a fresh checker. True when this also enables full dependency warm-up. */
  rebuild(): boolean;
}

/**
 * Opens a session. The host caches parsed files, so rebuilding a program
 * after a checker overflow (see CheckerLimit) re-binds but never re-parses.
 * The binder writes into cached SourceFiles: after a binder overflow that
 * cache is corrupt, so the host (and its cache) is replaced. The binder runs
 * inside getTypeChecker(): a binder overflow is traced to the file(s) that
 * cause it, which then fail alone (like parser failures). Workspace programs
 * warm their owned files first and let the checker infer imported types on
 * demand. After a stack limit, retry with the full source-order warm-up
 * before skipping any lookup.
 */
function openSession(
  roots: () => string[],
  options: ts.CompilerOptions,
  makeHost: () => ts.CompilerHost,
  failures: Map<string, string>,
  captured: ReadonlySet<string>,
  projectReferences: readonly ts.ProjectReference[] | undefined,
  lazyDependencies: boolean,
  /** Fails files with syntactic diagnostics the parser alone does not report; true to rebuild. */
  validate?: (program: ts.Program) => boolean,
): Session {
  let host = makeHost();
  let fullWarmup = !lazyDependencies;
  /** Captured files whose warm-up overflowed: never warmed again. */
  const warmSkip = new Set<string>();
  let lastProgram: ts.Program | undefined;
  const compile = () => {
    statistics.programs++;
    const program = ts.createProgram({
      rootNames: roots(),
      options,
      host,
      ...(projectReferences?.length ? { projectReferences } : {}),
    });
    try {
      return { program, checker: program.getTypeChecker() };
    } catch (error) {
      lastProgram = program;
      throw error;
    }
  };
  const warmProgram = (
    program: ts.Program,
    checker: ts.TypeChecker,
  ): string | undefined => {
    const owned = fullWarmup ? undefined : new Set(program.getRootFileNames());
    for (const source of program.getSourceFiles()) {
      const path = fromVirtual(source.fileName);
      if (
        path === undefined ||
        !captured.has(path) ||
        warmSkip.has(path) ||
        (owned && !owned.has(source.fileName))
      )
        continue;
      const warm = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) || ts.isBindingElement(node))
          checker.getTypeAtLocation(node.name);
        else if (
          (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
          node.body
        ) {
          const signature = checker.getSignatureFromDeclaration(node);
          if (signature) checker.getReturnTypeOfSignature(signature);
        }
        ts.forEachChild(node, warm);
      };
      try {
        warm(source);
      } catch (error) {
        if (!isStackLimit(error)) throw error;
        return path;
      }
    }
    return undefined;
  };
  const build = (): { program: ts.Program; checker: ts.TypeChecker } => {
    for (;;) {
      let compiled: { program: ts.Program; checker: ts.TypeChecker };
      try {
        compiled = compile();
      } catch (error) {
        if (!isStackLimit(error)) throw error;
        // The binder completes a file by setting classifiableNames; the
        // file it was inside when the stack ran out has locals but not
        // that. Otherwise, reproduce file by file.
        const unfinished = (lastProgram?.getSourceFiles() ?? [])
          .filter((source) => {
            const state = source as ts.SourceFile & {
              locals?: unknown;
              classifiableNames?: unknown;
            };
            return !!state.locals && !state.classifiableNames;
          })
          .map((source) => fromVirtual(source.fileName))
          .filter(
            (path): path is string => path !== undefined && captured.has(path),
          );
        const culprits = unfinished.length
          ? unfinished
          : roots()
              .map((root) => root.slice(1))
              .filter((path) => {
                try {
                  // A fresh host per candidate: a fresh parse, a fresh bind.
                  ts.createProgram({
                    rootNames: [toVirtual(path)],
                    options: { ...options, noResolve: true, noLib: true },
                    host: makeHost(),
                  }).getTypeChecker();
                  return false;
                } catch (inner) {
                  if (!isStackLimit(inner)) throw inner;
                  return true;
                }
              });
        // Not reproducible file by file: fail this config's files only.
        if (!culprits.length)
          culprits.push(...roots().map((root) => root.slice(1)));
        for (const path of culprits)
          failures.set(
            path,
            "The TypeScript binder exhausted its stack on this file",
          );
        host = makeHost();
        continue;
      }
      // A file failed by the syntax phase is absent from the next build.
      if (validate?.(compiled.program)) continue;
      const failedWarm = warmProgram(compiled.program, compiled.checker);
      if (failedWarm === undefined) return compiled;
      if (fullWarmup) warmSkip.add(failedWarm);
      fullWarmup = true;
    }
  };
  let current = build();
  const session: Session = {
    get program() {
      return current.program;
    },
    get checker() {
      return current.checker;
    },
    get host() {
      return host;
    },
    failures,
    rebuilds: 0,
    rebuild() {
      const broadened = !fullWarmup;
      fullWarmup = true;
      session.rebuilds++;
      current = build();
      return broadened;
    },
  };
  return session;
}

/**
 * `data.assumes`: the assumptions a link's facts rest on, as a sorted array
 * of unique names (absent when there are none). `bundler-require`: a free
 * `require`/`module` in an ES module read as the loader. `no-unseen-declarations`:
 * the link's project contains a file the parser could not fully read, and
 * the facts hold provided that unread text declares nothing that changes them.
 */
function assume(data: { [key: string]: Json }, ...names: string[]) {
  const all = new Set<string>([
    ...((Array.isArray(data.assumes) ? data.assumes : []) as string[]),
    ...names,
  ]);
  if (all.size) data.assumes = [...all].sort();
}

/** A link's comparable outcome: its target set and reason. */
const outcomeOf = (link: LinkDraft): string => {
  const data = (link.data ?? {}) as {
    targets?: TargetFact[];
    libraryFacts?: LibraryTarget[];
    reason?: string;
  };
  const targets = (data.targets ?? [])
    .map((target) => `${target.file}\0${target.key}`)
    .sort();
  return JSON.stringify([
    targets,
    data.libraryFacts?.map(libraryKey).sort(),
    data.reason ?? null,
  ]);
};
const siteOf = (link: LinkDraft) =>
  `${link.kind}\0${link.range.start}\0${link.range.end}`;

/**
 * Indexes of the links in `normal` whose outcome is not reproduced at the
 * same site in the neutral analysis (or there is none). Structural
 * `contains` links come from the parse alone and are not compared.
 */
function differing(normal: ParseResult, neutral: ParseResult): Set<number> {
  const outcomes = new Map<string, Set<string>>();
  if (neutral.status !== "failed")
    for (const link of neutral.links) {
      const site = siteOf(link);
      const known = outcomes.get(site) ?? new Set<string>();
      known.add(outcomeOf(link));
      outcomes.set(site, known);
    }
  const marks = new Set<number>();
  normal.links.forEach((link, index) => {
    if (link.kind === "contains") return;
    if (!outcomes.get(siteOf(link))?.has(outcomeOf(link))) marks.add(index);
  });
  return marks;
}

/** Flags the links that rest on the bundler assumption. */
function labelled(
  result: ParseResult,
  assumed: ReadonlySet<number>,
): ParseResult {
  const links = result.links.map((link, index) => {
    if (!assumed.has(index)) return link;
    const data = { ...((link.data ?? {}) as { [key: string]: Json }) };
    assume(data, "bundler-require");
    return { ...link, data };
  });
  return { ...result, links };
}

/** A file that cannot be read: failed, with its syntax errors, no facts. */
const invalidResult = (
  failure: { diagnostics: Diagnostic[] },
  failedFiles: Json,
): ParseResult => ({
  status: "failed",
  diagnostics: failure.diagnostics.map((item) => ({ ...item })),
  symbols: [],
  links: [],
  data: {
    analyzer: MODULE_VERSION,
    invalid: true,
    ...(failedFiles && Object.keys(failedFiles).length ? { failedFiles } : {}),
  },
});

const failed = (message: string): ParseResult => ({
  status: "failed",
  diagnostics: [{ message }],
  symbols: [],
  links: [],
});
/**
 * A failure that says nothing about the file's content: an exception inside
 * this module, or a compiler limit that depends on the environment (stack
 * size, how often the checker overflowed in the project). It is reported as
 * the module's own fault, never as invalid code, and is marked
 * `failureKind: "transient"` so that a core with content-failure caching
 * retries it on the next index instead of caching it (the core without that
 * field re-reads every failed file anyway).
 */
const operationalFailure = (message: string): ParseResult => {
  const result: ParseResult & { failureKind: "transient" } = {
    status: "failed",
    failureKind: "transient",
    diagnostics: [{ message }],
    symbols: [],
    links: [],
  };
  return result;
};
/**
 * Test hook: extraction of these paths throws, as an internal defect would,
 * so tests can pin how an internal exception is reported. Empty in normal
 * use; nothing in the module adds to it.
 */
export const injectedExtractionFaults = new Set<string>();
/** The diagnostic for an unexpected exception while extracting one file. */
export function internalErrorMessage(path: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Internal error in the TypeScript module while reading ${path} (a defect in pymtheg, not a problem in this file; it is retried on the next index): ${detail}`;
}

/**
 * Merges one file's results from equally ranked configs, independent of
 * their order: nothing comes from "the first" variant. Every field is either
 * identical across the variants, a sorted union, or listed per config:
 * - symbols, and each link's kind, range, source and name, must be
 *   identical (otherwise the file fails);
 * - targets: the sorted union; reason: none if no variant has one (two or
 *   more targets are candidates), the one reason if every variant gives it
 *   with the same targets, otherwise `ambiguous-project` with `tiedReasons`;
 *   `assumes`: the union;
 * - any other link or file field that differs: per config in `byProject`;
 * - a variant that failed (`invalid-code`) makes the link failed, with the
 *   union of causes and no target from the other variants;
 * - diagnostics: the sorted union; status: the weakest.
 */
export function mergeTied(
  variants: ParseResult[],
  configs: (string | null)[],
): ParseResult {
  const names = configs.map((config) => config ?? "(inferred)");
  const projects = [...configs].sort((a, b) =>
    (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0,
  );
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const byKey = <T>(entries: [string, T][]) =>
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (variants.some((variant) => variant.status === "failed")) {
    // The weakest: a failure, its diagnostics the sorted union.
    const diagnostics = byKey(
      variants
        .filter((variant) => variant.status === "failed")
        .flatMap((variant) => variant.diagnostics)
        .map((d): [string, Diagnostic] => [JSON.stringify(d), d]),
    );
    const merged: ParseResult & { failureKind?: "transient" } = {
      status: "failed",
      diagnostics: [...new Map(diagnostics).values()],
      symbols: [],
      links: [],
    };
    // A failure that is transient in any config (an internal error or an
    // environment limit) makes the merged failure transient: it is retried,
    // never cached as content, even if another config failed on content
    // (the retry finds that content failure again).
    if (
      variants.some(
        (variant) =>
          (variant as { failureKind?: string }).failureKind === "transient",
      )
    )
      merged.failureKind = "transient";
    return merged;
  }
  /** Fields identical everywhere kept; differing ones listed per config. */
  const mergeFields = (
    datas: { [key: string]: Json }[],
    skip: readonly string[],
  ): { [key: string]: Json } => {
    const merged: { [key: string]: Json } = {};
    const byProject: { [key: string]: { [key: string]: Json } } = {};
    const keys = [...new Set(datas.flatMap((data) => Object.keys(data)))]
      .filter((key) => !skip.includes(key))
      .sort();
    for (const key of keys) {
      if (datas.every((data) => same(data[key], datas[0]![key]))) {
        if (datas[0]![key] !== undefined) merged[key] = datas[0]![key]!;
      } else
        datas.forEach((data, at) => {
          const entry = (byProject[names[at]!] ??= {});
          if (data[key] !== undefined) entry[key] = data[key]!;
        });
    }
    const listed = byKey(Object.entries(byProject));
    if (listed.length) merged.byProject = Object.fromEntries(listed);
    return merged;
  };
  const shape = (link: LinkDraft) =>
    JSON.stringify([link.kind, link.range, link.sourceKey, link.targetName]);
  if (
    variants.some(
      (variant) =>
        !same(variant.symbols, variants[0]!.symbols) ||
        variant.links.length !== variants[0]!.links.length ||
        variant.links.some(
          (link, index) => shape(link) !== shape(variants[0]!.links[index]!),
        ),
    )
  )
    return failed(
      `Equally ranked configs ${projects.join(", ")} produced different structure for this file`,
    );
  const links = variants[0]!.links.map((link, index) => {
    const datas = variants.map(
      (variant) =>
        (variant.links[index]!.data ?? {}) as { [key: string]: Json },
    );
    if (datas.every((data) => same(data, datas[0]))) return link;
    // A failed dependency is the weakest: if any variant failed, the merged
    // link has failed, with the union of causes and no target from others.
    if (datas.some((data) => data.reason === "invalid-code")) {
      const causes = new Set<string>();
      const vias = new Set<string>();
      for (const data of datas) {
        const cause = (data.cause ?? {}) as {
          file?: string;
          files?: string[];
          via?: string;
        };
        if (cause.file) causes.add(cause.file);
        for (const file of cause.files ?? []) causes.add(file);
        if (cause.via) vias.add(cause.via);
      }
      const merged = mergeFields(datas, [
        "targets",
        "libraryFacts",
        "reason",
        "assumes",
        "cause",
      ]);
      merged.reason = "invalid-code";
      const list = [...causes].sort();
      merged.cause = {
        ...(list.length === 1 ? { file: list[0]! } : { files: list }),
        ...(vias.size ? { via: [...vias].sort().join("; ") } : {}),
      };
      merged.projects = [...projects];
      return { ...link, data: merged };
    }
    const keyed = (data: { [key: string]: Json }) =>
      [
        ...((data.targets ?? []) as unknown as TargetFact[]).map(
          (t) => `${t.file}\0${t.key}`,
        ),
        ...((data.libraryFacts ?? []) as unknown as LibraryTarget[]).map(
          libraryKey,
        ),
      ].sort();
    const targets = new Map<string, TargetFact>();
    const libraries = new Map<string, LibraryTarget>();
    for (const data of datas)
      for (const target of (data.targets ?? []) as unknown as TargetFact[])
        targets.set(`${target.file}\0${target.key}`, { ...target });
    for (const data of datas)
      for (const target of (data.libraryFacts ??
        []) as unknown as LibraryTarget[])
        libraries.set(libraryKey(target), target);
    const reasons = [
      ...new Set(
        datas
          .map((data) => data.reason as string | undefined)
          .filter((r): r is string => !!r),
      ),
    ].sort();
    const sameTargets = datas.every((data) =>
      same(keyed(data), keyed(datas[0]!)),
    );
    const merged = mergeFields(datas, [
      "targets",
      "libraryFacts",
      "reason",
      "assumes",
    ]);
    if (targets.size)
      merged.targets = byKey([...targets.entries()]).map(([, t]) => ({
        ...t,
      }));
    if (!reasons.length && libraries.size)
      merged.libraryFacts = byKey([...libraries.entries()]).map(
        ([, target]) => ({ ...target }),
      );
    if (reasons.length) {
      const everyVariantSame =
        sameTargets &&
        reasons.length === 1 &&
        datas.every((data) => data.reason === reasons[0]);
      merged.reason = everyVariantSame ? reasons[0]! : "ambiguous-project";
      if (!everyVariantSame) merged.tiedReasons = reasons;
    }
    if (!sameTargets || reasons.length) merged.projects = [...projects];
    assume(
      merged,
      ...datas.flatMap(
        (data) => (Array.isArray(data.assumes) ? data.assumes : []) as string[],
      ),
    );
    return { ...link, data: merged };
  });
  const diagnostics = [
    ...new Map(
      byKey(
        variants
          .flatMap((variant) => variant.diagnostics)
          .map((d): [string, Diagnostic] => [JSON.stringify(d), d]),
      ),
    ).values(),
  ];
  // A tie has no single owner: `projects` lists them; `project` is absent.
  const data = mergeFields(
    variants.map((variant) => (variant.data ?? {}) as { [key: string]: Json }),
    ["project"],
  );
  data.projects = [...projects];
  return {
    status: variants.some((variant) => variant.status === "partial")
      ? "partial"
      : "clean",
    diagnostics,
    symbols: variants[0]!.symbols,
    links,
    data,
  };
}

const module: LanguageModule = {
  id: "typescript",
  version: MODULE_VERSION,
  // `.d.ts`, `.d.mts` and `.d.cts` are covered by the `.ts`, `.mts` and `.cts` claims.
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  contextFiles: CONTEXT_PATTERNS,
  analyze(context) {
    const files = context.files.filter(readable);
    // Unchanged snapshot: stored facts came from a complete analysis of these
    // exact sources and contexts by this module version, so they are reused
    // without building a program. The core retries a failed file whose content
    // marker is absent; if every changed file is such a failed file with the
    // same content as recorded in
    // `failedFiles`, nothing else can differ: only it is parsed again, for
    // its diagnostics.
    const changed = new Set(context.changedFiles);
    const kept = files.filter((file) => !changed.has(file.path));
    const dataOf = (file: GraphFile) =>
      (file.result.data ?? {}) as { analyzer?: unknown; failedFiles?: Json };
    const recorded = (kept[0] && dataOf(kept[0]).failedFiles) ?? {};
    const recordedHash = (path: string) =>
      (recorded as { [path: string]: Json })[path];
    if (
      !context.changedContextFiles.length &&
      kept.every(
        (file) =>
          dataOf(file).analyzer === MODULE_VERSION &&
          JSON.stringify(dataOf(file).failedFiles ?? {}) ===
            JSON.stringify(recorded),
      ) &&
      [...changed].every((path) => {
        const file = files.find((item) => item.path === path);
        return file !== undefined && recordedHash(path) === file.hash;
      })
    ) {
      const again = files
        .filter((file) => changed.has(file.path))
        .map((file) => [file, syntaxFailure(file.path, file.text)] as const);
      if (again.every(([, failure]) => failure)) {
        statistics.reused++;
        return [
          ...kept.map((file) => ({ path: file.path, result: file.result })),
          ...again.map(([file, failure]) => ({
            path: file.path,
            result: {
              ...invalidResult(failure!, recorded),
              failureKind: "content" as const,
            },
          })),
        ];
      }
    }
    const model = projectModel(files, context.contextFiles);
    const libraries = libraryReader(
      model.manifests,
      files,
      model.workspaceRoots,
      model.workspaceBoundaries,
      model.workspaceCatalogs,
    );
    const captured = new Set(files.map((file) => file.path));
    const results: AnalyzedFile[] = [];
    // A broken config or manifest fails only the files it governs, not the module.
    for (const [path, message] of model.failures)
      results.push({ path, result: failed(message) });
    const tiedResults = new Map<string, ParseResult[]>();
    const deliver = (path: string, result: ParseResult) => {
      if (model.ties.has(path))
        tiedResults.set(path, [...(tiedResults.get(path) ?? []), result]);
      else results.push({ path, result });
    };
    for (const group of model.groups) {
      if (!group.roots.length) continue;
      const roots = () =>
        group.roots.filter((root) => !model.parseFailures.has(root.slice(1)));
      let normal: Session | undefined = openSession(
        roots,
        group.options,
        () => model.host(group),
        model.parseFailures,
        captured,
        group.references,
        model.hasWorkspacePackages,
        // Any syntactic diagnostic fails a file: also the compiler's
        // syntax-phase checks the parser does not make (TypeScript-only
        // syntax in a JS file, TS8xxx).
        (program) => {
          let failedAny = false;
          for (const source of program.getSourceFiles()) {
            const path = fromVirtual(source.fileName);
            if (path === undefined || !captured.has(path)) continue;
            const extra = program.getSyntacticDiagnostics(source);
            if (extra.length && model.failSyntax(path, extra)) failedAny = true;
          }
          return failedAny;
        },
      );
      let baseHost = normal.host;
      const hostOfNormal = () => normal?.host ?? baseHost;
      const resolveModule = (specifier: string, from: string) => {
        const selected = model.selectSpecifier(specifier, from);
        if (selected === undefined) return undefined;
        const resolved = ts.resolveModuleName(
          selected,
          toVirtual(from),
          group.options,
          hostOfNormal(),
        ).resolvedModule?.resolvedFileName;
        return resolved === undefined
          ? undefined
          : fromVirtual(hostOfNormal().realpath?.(resolved) ?? resolved);
      };
      /**
       * What a captured target file is. `script` means only: analysed, no
       * syntax errors, and no ES or CommonJS exports. A file that failed to
       * parse or bind is `unavailable`; one with syntax errors and no exports
       * found is `partial` (its exports cannot be ruled out).
       */
      const moduleKind = (
        path: string,
      ): "module" | "script" | "invalid" | "unavailable" => {
        if (model.syntaxFailures.has(path)) return "invalid";
        if (model.parseFailures.has(path) || model.failures.has(path))
          return "unavailable";
        const source =
          normal?.program.getSourceFile(toVirtual(path)) ??
          hostOfNormal().getSourceFile(toVirtual(path), ts.ScriptTarget.Latest);
        // Parsing it just now may have found a syntax error.
        if (model.syntaxFailures.has(path)) return "invalid";
        if (!source) return "unavailable";
        const flags = source as ts.SourceFile & {
          externalModuleIndicator?: unknown;
          commonJsModuleIndicator?: unknown;
        };
        if (
          !!flags.externalModuleIndicator ||
          !!flags.commonJsModuleIndicator ||
          /(^|[^.\w$])(module\.exports|exports\.[\w$]+)\s*=/.test(source.text)
        )
          return "module";
        return "script";
      };
      /** Extracts one file, rebuilding the session after checker overflows. */
      const extractWith = (
        session: Session,
        path: string,
        data: { [key: string]: Json },
        diagnostics: Diagnostic[],
        renamed: Renamed | undefined,
      ): ParseResult => {
        if (session.rebuilds > MAX_PROGRAM_REBUILDS)
          return operationalFailure(
            `The TypeScript checker overflowed so often in this project (${session.rebuilds} rebuilds) that the remaining files were not analysed`,
          );
        const skip = new Set<string>();
        for (let attempt = 0; ; attempt++) {
          try {
            if (injectedExtractionFaults.has(path))
              throw new TypeError("injected internal fault (test)");
            const source = session.program.getSourceFile(toVirtual(path));
            if (!source) {
              const failure = session.failures.get(path);
              // The parser or binder exhausted its stack on this file: an
              // environment limit, like the checker's, not invalid code.
              if (failure?.includes("exhausted its stack"))
                return operationalFailure(
                  `${failure} (a resource limit of the TypeScript compiler in this environment, not a defect in the file; it is retried on the next index)`,
                );
              // Anything else the compiler threw is an internal error.
              throw Error(failure ?? "The compiler did not load this source");
            }
            const result = extractFile(
              source,
              session.checker,
              session.program,
              captured,
              diagnostics.map((item) => ({ ...item })),
              { ...data },
              // Settings from an uncaptured base are missing: see extract.ts.
              group.limitations.length > 0,
              {
                fresh: model.fresh,
                explicitTypes: group.explicitTypes === true,
                ...(renamed ? { renamed } : {}),
                resolveModule,
                hasDenoImports: model.hasDenoImports,
                selectSpecifier: model.selectSpecifier,
                workspaceReason: model.workspaceReason,
                workspaceBoundaryKnown: model.workspaceBoundaryKnown,
                skip,
                moduleKind,
                anyFailed: unseen.size > 0,
                failedNames,
              },
              libraries,
            );
            statistics.extracted++;
            return result;
          } catch (error) {
            if (
              error instanceof CheckerLimit &&
              attempt < MAX_LIMIT_RETRIES &&
              session.rebuilds <= MAX_PROGRAM_REBUILDS
            ) {
              // The checker's state is untrustworthy after an overflow:
              // retry with dependencies warmed before omitting a lookup.
              if (!session.rebuild()) skip.add(error.key);
              continue;
            }
            // Never leave an overflowed checker in use for the next file.
            if (error instanceof CheckerLimit) session.rebuild();
            return operationalFailure(
              error instanceof CheckerLimit
                ? `The TypeScript checker exhausted its stack more than ${MAX_LIMIT_RETRIES} times in this file`
                : internalErrorMessage(path, error),
            );
          }
        }
      };
      // Failed files this program would include (roots, or imported): any of
      // them might have declared something that changes a link.
      const unseen = new Set([
        ...model.requested(normal.host),
        ...group.roots
          .map((root) => root.slice(1))
          .filter((path) => model.parseFailures.has(path)),
      ]);
      const failedNames = new Map<string, string[]>();
      for (const path of [...unseen].sort())
        for (const name of model.syntaxFailures.get(path)?.names ?? [])
          failedNames.set(name, [...(failedNames.get(name) ?? []), path]);
      const analysed: [string, ParseResult][] = [];
      for (const root of group.roots) {
        const path = root.slice(1);
        // A file that cannot be read is not valid code: it has failed, with
        // its syntax errors (first by position) as diagnostics.
        const syntax = model.syntaxFailures.get(path);
        if (syntax) {
          analysed.push([path, invalidResult(syntax, {})]);
          continue;
        }
        const data: { [key: string]: Json } = {
          analyzer: MODULE_VERSION,
          project: group.config,
        };
        if (group.notes.length) data.configNotes = [...group.notes];
        // Locally bound module-system names the compiler saw renamed (rename.ts).
        const renamed = model.renames.get(path);
        if (renamed) {
          if (renamed.renamed.length)
            data.renamedForCompiler = [...renamed.renamed];
          if (renamed.uncertain.length)
            data.dynamicScopeOccurrences = renamed.uncertain.length;
        }
        const diagnostics: Diagnostic[] = group.limitations.map((message) => ({
          message,
        }));
        if (renamed?.uncertain.length)
          diagnostics.push({
            message: `${renamed.uncertain.length} occurrence(s) of require/module/exports cannot be decided statically (with, direct eval, reassignment, or a createRequire base other than this file); their links are unresolved`,
          });
        analysed.push([
          path,
          extractWith(normal, path, data, diagnostics, renamed),
        ]);
      }

      // ----- differential analysis for the bundler assumption -----
      // A free require/module in an ES module read as the loader: one
      // neutral program with it renamed to an undeclared name; a link whose
      // outcome differs there rests on the assumption.
      const assumedTexts = new Map<string, string>();
      for (const source of normal.program.getSourceFiles()) {
        const path = fromVirtual(source.fileName);
        if (path === undefined || !captured.has(path)) continue;
        const offsets = model.renames.get(path)?.assumed ?? [];
        if (offsets.length)
          assumedTexts.set(
            path,
            neutralizeAssumed(source.text, offsets, model.fresh.uncertain),
          );
      }
      // The differential pass shares the original parse cache. Its lookups
      // do not need the original program or checker.
      baseHost = normal.host;
      normal = undefined;
      const assumed = new Map<string, Set<number>>();
      if (assumedTexts.size) {
        statistics.neutralPrograms++;
        const failures = new Map(model.parseFailures);
        const neutral = openSession(
          () => group.roots.filter((root) => !failures.has(root.slice(1))),
          group.options,
          () =>
            model.host(group, {
              texts: assumedTexts,
              base: baseHost,
              failures,
            }),
          failures,
          captured,
          group.references,
          model.hasWorkspacePackages,
        );
        for (const [path, result] of analysed) {
          if (result.status === "failed") continue;
          const renamed = model.renames.get(path);
          // The assumed loader becomes an undeclared name (see rename.ts).
          const context: Renamed | undefined = renamed?.assumed.length
            ? {
                ...renamed,
                uncertain: [...renamed.uncertain, ...renamed.assumed],
                assumed: [],
              }
            : renamed;
          const other = extractWith(neutral, path, {}, [], context);
          statistics.neutralExtracted++;
          assumed.set(path, differing(result, other));
        }
      }
      for (const [path, result] of analysed) {
        let final = result;
        const marks = assumed.get(path);
        if (marks?.size) final = labelled(final, marks);
        // One rule, one place: a program with a failed file among those it
        // would include flags every link it computed (failed links excepted).
        if (unseen.size && final.status !== "failed")
          final = {
            ...final,
            links: final.links.map((link) => {
              const data = {
                ...((link.data ?? {}) as { [key: string]: Json }),
              };
              const outside = data.libraryFacts as unknown as
                | LibraryTarget[]
                | undefined;
              if (
                data.reason === "invalid-code" ||
                (outside?.length &&
                  outside.every(
                    (fact) =>
                      fact.evidence === "import-path" ||
                      fact.evidence === "import-binding",
                  ))
              )
                return link;
              assume(data, "no-unseen-declarations");
              return { ...link, data };
            }),
          };
        deliver(path, final);
      }
    }
    for (const [path, variants] of tiedResults)
      results.push({
        path,
        result: mergeTied(
          variants,
          model.ties.get(path)!.map((group) => group.config),
        ),
      });
    // Every result records the module's failed files and their content, so
    // an unchanged re-index can recognise them (see above).
    const failedFiles = Object.fromEntries(
      files
        .filter((file) => model.syntaxFailures.has(file.path))
        .map((file) => [file.path, file.hash] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    if (Object.keys(failedFiles).length)
      for (const item of results) {
        const data = item.result.data as { [key: string]: Json } | undefined;
        if (data?.analyzer === MODULE_VERSION)
          item.result = { ...item.result, data: { ...data, failedFiles } };
      }
    // Only failures reproduced from this file alone may outlive a project
    // analysis. Config/ownership failures, compiler/checker limits, internal
    // exceptions and diagnostics added by a Program remain retryable. Compare
    // the whole diagnostic set: a local syntax error must not hide another,
    // context-dependent failure. Tied configs may order diagnostics differently.
    const diagnosticSet = (diagnostics: readonly Diagnostic[]) =>
      JSON.stringify(diagnostics.map((item) => JSON.stringify(item)).sort());
    const byPath = new Map(files.map((file) => [file.path, file]));
    for (const item of results) {
      if (
        item.result.status !== "failed" ||
        item.result.failureKind === "transient"
      )
        continue;
      const file = byPath.get(item.path)!;
      const local = syntaxFailure(file.path, file.text);
      if (
        local &&
        diagnosticSet(local.diagnostics) ===
          diagnosticSet(item.result.diagnostics)
      )
        item.result = { ...item.result, failureKind: "content" };
    }
    return results;
  },
  resolve({ symbols, links }) {
    const byKey = new Map<string, string>();
    for (const symbol of symbols)
      if (symbol.module === module.id)
        byKey.set(`${symbol.file}\0${symbol.key}`, symbol.id);
    const resolutions: LinkResolution[] = [];
    for (const link of links) {
      const data = link.data as
        | {
            targets?: TargetFact[];
            libraryFacts?: LibraryTarget[];
            reason?: string;
            assumes?: string[];
          }
        | undefined;
      const facts = data?.targets ?? [];
      const ids = [
        ...new Set(
          facts
            .map((fact) => byKey.get(`${fact.file}\0${fact.key}`))
            .filter((id): id is string => id !== undefined),
        ),
      ];
      // Never a guess: a set with a lost target (failed file) or a possible
      // declaration outside the project (`reason`) is not narrowed, neither to
      // one definite target nor to a candidate set that omits a possibility.
      const complete = ids.length === facts.length && !data?.reason;
      if (!complete) continue;
      const libraries = data?.libraryFacts ?? [];
      if (libraries.length) {
        if (data?.assumes?.length) continue;
        if (ids.length + libraries.length === 1)
          resolutions.push({ linkId: link.id, library: libraries[0]! });
        else
          resolutions.push({ linkId: link.id, candidateIds: ids, libraries });
      } else if (ids.length === 1)
        resolutions.push({ linkId: link.id, targetId: ids[0]! });
      else if (ids.length >= 2)
        resolutions.push({ linkId: link.id, candidateIds: ids });
    }
    return resolutions;
  },
};
export default module;
