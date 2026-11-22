// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import { contentHash } from "../../index.js";
import { validSourceRange } from "../../identity.js";
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
  ScopedAnalysis,
} from "../../types.js";
import {
  CheckerLimit,
  extractFile,
  type RenameContext,
  type TargetFact,
} from "./extract.js";
import { nonReturningFlow } from "./flow.js";
import { libraryKey, libraryReader } from "./library.js";
import type { ProjectGroup, ProjectModel } from "./project.js";
import { freshNames, type Renamed } from "./rename.js";
import {
  checkerSurface,
  moveTargets,
  rekey,
  syntacticSurface,
} from "./scoped.js";
import { markTaintExhausted, setTaintBudget, taintExhausted } from "./taint.js";
import { neutralizeAssumed } from "./untrusted.js";
import { entryProvenance } from "./workspace-entries.js";
import { unbuiltEntryAssumption } from "./entry-build.js";

/** Program rebuilds per file after checker stack overflows before giving up. */
const MAX_LIMIT_RETRIES = 25;
/** Program rebuilds per project before the remaining files are not analysed. */
const MAX_PROGRAM_REBUILDS = 200;
const isStackLimit = (error: unknown) =>
  error instanceof RangeError && /call stack/i.test(error.message);
/** Files a session fails for compiler exceptions before failing the rest. */
const MAX_COMPILER_FAILURES = 100;
/**
 * The start of the reason recorded for a file the TypeScript compiler threw
 * on (an assertion such as "Debug Failure. False expression."), followed by
 * the compiler's message.
 */
export const COMPILER_FAILURE =
  "The TypeScript compiler failed while analysing this file";
const compilerFailure = (error: unknown) =>
  `${COMPILER_FAILURE}: ${error instanceof Error ? error.message : String(error)}`;
/** The compiler's own assertion failures (`Debug.fail`, `Debug.assert`). */
const isCompilerAssertion = (error: unknown) =>
  error instanceof Error && error.message.startsWith("Debug Failure");
/** Sessions whose taint walk reached its budget (see `markTaintExhausted`). */
const exhaustedSessions = new WeakSet<object>();
/**
 * What a module instance is given besides its input. Only tests pass any:
 * a module made with none behaves exactly as the default export.
 */
export interface TypeScriptModuleOptions {
  /** The taint walk's step budget (taint.ts; TAINT_BUDGET otherwise). */
  taintSteps?: number;
  /** The program budget in characters (project.ts; MAX_PROGRAM_SOURCE otherwise). */
  programCharacters?: number;
  /** Called before every checker call the module makes; may throw. */
  checkerFault?: (method: string, node: ts.Node | undefined) => void;
  /** Called before each file's syntax-phase check; may throw. */
  syntaxFault?: (path: string) => void;
  /**
   * Test only (C-38): a scoped analysis skips both surface comparisons and
   * keeps other files' stored results as they are, so the equality tests
   * can show that each comparison is needed.
   */
  trustSurface?: boolean;
}
/** The node the module last passed to a checker method (see `attributed`). */
let lastAsked: ts.Node | undefined;
/**
 * The checker, with every method recording the node it is asked about. A
 * compiler exception is then attributed to the file of the last node asked
 * about: a whole-program walk (taint.ts reads every file's declarations at a
 * file's first lookup) throws while reading another file's declaration, and
 * that file, not the one being extracted, is what the compiler cannot read.
 */
function attributed(
  checker: ts.TypeChecker,
  fault?: TypeScriptModuleOptions["checkerFault"],
): ts.TypeChecker {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(checker))
    wrapped[key] =
      typeof value === "function"
        ? (...args: unknown[]) => {
            const first = args[0] as { kind?: unknown } | undefined;
            const node =
              first && typeof first.kind === "number"
                ? (first as ts.Node)
                : undefined;
            if (node) lastAsked = node;
            fault?.(key, node);
            return (value as (...inner: unknown[]) => unknown).apply(
              checker,
              args,
            );
          }
        : value;
  return wrapped as unknown as ts.TypeChecker;
}
/** The captured file of the node last asked about, if any. */
const askedFile = (): string | undefined => {
  const file = lastAsked?.getSourceFile()?.fileName;
  return file === undefined ? undefined : fromVirtual(file);
};
import {
  CONTEXT_PATTERNS,
  fromVirtual,
  projectModel,
  relativeSpecifier,
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
const MODULE_VERSION = `45+typescript-${ts.version}`;

/** Observation counters for tests (programs built, files extracted). Not a correctness input. */
export const statistics = {
  programs: 0,
  extracted: 0,
  reused: 0,
  /** Neutral programs built for the differential analysis (untrusted.ts). */
  neutralPrograms: 0,
  neutralExtracted: 0,
  /** Re-indexes that extracted only the edited file (C-38). */
  scoped: 0,
  /** Programs built to compare an edited file's checker surface (C-38). */
  surfacePrograms: 0,
  /** Why a scoped analysis was not used, by reason (C-38). */
  declined: {} as Record<string, number>,
};

/** Counts why a scoped analysis was not used; the full analysis follows. */
const declined = (reason: string): undefined => {
  statistics.declined[reason] = (statistics.declined[reason] ?? 0) + 1;
};

/** A program's name in `loadedBy`: its config, or "(inferred)". */
const groupName = (group: ProjectGroup) => group.config ?? "(inferred)";

/** Whether a bound source file is an ES or CommonJS module, as `moduleKind` reads it. */
const moduleKindOf = (source: ts.SourceFile | undefined) => {
  const flags = source as
    | (ts.SourceFile & {
        externalModuleIndicator?: unknown;
        commonJsModuleIndicator?: unknown;
      })
    | undefined;
  return !!flags?.externalModuleIndicator || !!flags?.commonJsModuleIndicator;
};

/**
 * A scoped analysis (C-38): only `path` is extracted, in its own project.
 * `broken` records anything that would make the result differ from a full
 * analysis's; the caller then runs the full analysis.
 */
interface Scope {
  path: string;
  /** The session of each project that owns the file (several when tied). */
  sessions: Map<ProjectGroup, Session>;
  broken: boolean;
}

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
  /**
   * The compiler threw on this file: it fails with `message`, and the
   * program is rebuilt without it, resuming the warm-up.
   */
  drop(path: string, message: string): void;
  /** Files this session has failed for compiler exceptions so far. */
  readonly drops: number;
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
  /**
   * Fails files with syntactic diagnostics the parser alone does not
   * report; true to rebuild. A file the compiler throws on goes to `fail`
   * (the session's one cap on contained exceptions).
   */
  validate:
    | ((
        program: ts.Program,
        fail: (path: string, message: string) => void,
      ) => boolean)
    | undefined,
  hooks: TypeScriptModuleOptions,
  /**
   * Files this program loads from other projects that the compiler failed
   * on there: they count toward this program's cap too.
   */
  inherited: () => number = () => 0,
): Session {
  let host = makeHost();
  /**
   * The host's own realpath. Building a program replaces `host.realpath`
   * with a wrapper over that program and never restores it, so every
   * program built on a reused host would wrap the previous program's
   * wrapper and keep that program alive. Each build starts from this.
   */
  let ownRealpath = host.realpath;
  const replaceHost = () => {
    host = makeHost();
    ownRealpath = host.realpath;
  };
  let fullWarmup = !lazyDependencies;
  /** Captured files whose warm-up overflowed: never warmed again. */
  const warmSkip = new Set<string>();
  /**
   * Files an earlier checker of this session warmed. A program rebuilt
   * because the compiler threw on a file resumes the warm-up with the files
   * not yet warmed: repeating it from the start would cost a whole warm-up
   * per failing file. Any other rebuild warms from the start (cleared).
   */
  const warmed = new Set<string>();
  let lastProgram: ts.Program | undefined;
  const compile = () => {
    statistics.programs++;
    if (ownRealpath) host.realpath = ownRealpath;
    const program = ts.createProgram({
      rootNames: roots(),
      options,
      host,
      ...(projectReferences?.length ? { projectReferences } : {}),
    });
    try {
      const checker = attributed(program.getTypeChecker(), hooks.checkerFault);
      if (hooks.taintSteps !== undefined)
        setTaintBudget(checker, hooks.taintSteps);
      return { program, checker };
    } catch (error) {
      lastProgram = program;
      throw error;
    }
  };
  /**
   * A build's exception, as its kind and message only: the exception holds
   * the compiler's stack frames and through them its checker, which must
   * not outlive the build.
   */
  type Thrown = { limit: boolean; message: string };
  const thrown = (error: unknown): Thrown => ({
    limit: isStackLimit(error),
    message: compilerFailure(error),
  });
  /** Builds a program and its checker, or says what was thrown. */
  const attempt = ():
    | { program: ts.Program; checker: ts.TypeChecker }
    | Thrown => {
    try {
      return compile();
    } catch (error) {
      return thrown(error);
    }
  };
  /** The file whose warm-up threw, with what was thrown. */
  const warmProgram = (
    program: ts.Program,
    checker: ts.TypeChecker,
  ): ({ path: string; blame: string | undefined } & Thrown) | undefined => {
    const owned = fullWarmup ? undefined : new Set(program.getRootFileNames());
    for (const source of program.getSourceFiles()) {
      const path = fromVirtual(source.fileName);
      if (
        path === undefined ||
        !captured.has(path) ||
        warmSkip.has(path) ||
        warmed.has(path) ||
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
      lastAsked = undefined;
      try {
        warm(source);
      } catch (error) {
        return { path, blame: askedFile(), ...thrown(error) };
      }
      warmed.add(path);
    }
    return undefined;
  };
  /** Files this session failed for compiler exceptions. */
  let compilerFailures = 0;
  /**
   * Fails a file the compiler threw on: it is absent from every later
   * program. Past MAX_COMPILER_FAILURES, every remaining root fails too.
   */
  const failCompiler = (path: string, message: string) => {
    // Already failed (by the cap, say): neither counted nor relabelled.
    if (failures.has(path)) return;
    failures.set(path, message);
    if (++compilerFailures + inherited() < MAX_COMPILER_FAILURES) return;
    for (const root of roots()) {
      const other = root.slice(1);
      if (!failures.has(other))
        failures.set(
          other,
          `${COMPILER_FAILURE}: the compiler threw on ${MAX_COMPILER_FAILURES} files of this project, so the rest were not analysed`,
        );
    }
  };
  /** Flow-graph answers per flow node, kept across this session's builds. */
  const flowMemo = new WeakMap<object, boolean>();
  /** Source files already checked for non-returning flow. */
  const flowChecked = new WeakSet<ts.SourceFile>();
  /** Fails the captured files whose flow analysis would not return; true if any. */
  const failNonReturning = (program: ts.Program): boolean => {
    let failedAny = false;
    for (const source of program.getSourceFiles()) {
      const path = fromVirtual(source.fileName);
      if (path === undefined || !captured.has(path) || flowChecked.has(source))
        continue;
      flowChecked.add(source);
      const at = nonReturningFlow(source, flowMemo);
      if (!at) continue;
      const { line, character } = source.getLineAndCharacterOfPosition(
        at.getStart(source),
      );
      failCompiler(
        path,
        `${COMPILER_FAILURE}: its control-flow analysis would not return (the compiler follows a cycle of flow nodes from line ${line + 1}, column ${character + 1} without a limit)`,
      );
      failedAny = true;
    }
    return failedAny;
  };
  /**
   * The root whose addition makes building the program throw (not a stack
   * limit), by bisecting the root list: the shortest prefix that throws ends
   * with it. Deterministic; a fresh host per attempt.
   */
  const firstThrowing = (): string[] => {
    const list = roots();
    const throws = (count: number) => {
      try {
        ts.createProgram({
          rootNames: list.slice(0, count),
          options,
          host: makeHost(),
          ...(projectReferences?.length ? { projectReferences } : {}),
        }).getTypeChecker();
        return false;
      } catch (inner) {
        return !isStackLimit(inner);
      }
    };
    let low = 0;
    let high = list.length;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (throws(middle)) high = middle;
      else low = middle;
    }
    return high > 0 ? [list[high - 1]!.slice(1)] : [];
  };
  const build = (): { program: ts.Program; checker: ts.TypeChecker } => {
    for (;;) {
      const compiled = attempt();
      if ("message" in compiled) {
        const limit = compiled.limit;
        // The binder completes a file by setting classifiableNames; the
        // file it was inside when the stack ran out (or the compiler
        // threw) has locals but not that. Otherwise, reproduce file by file.
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
        lastProgram = undefined;
        const culprits = unfinished.length
          ? unfinished
          : limit
            ? roots()
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
                })
            : firstThrowing();
        // Not reproducible file by file: fail this config's files only.
        if (!culprits.length)
          culprits.push(...roots().map((root) => root.slice(1)));
        for (const path of culprits)
          if (limit)
            failures.set(
              path,
              "The TypeScript binder exhausted its stack on this file",
            );
          else failCompiler(path, compiled.message);
        replaceHost();
        continue;
      }
      // A file failed by the syntax phase is absent from the next build.
      if (validate?.(compiled.program, failCompiler)) continue;
      // A file whose flow analysis would not return (flow.ts) fails before
      // any checker query reaches it, and the program is built without it.
      if (failNonReturning(compiled.program)) continue;
      const failedWarm = warmProgram(compiled.program, compiled.checker);
      if (failedWarm === undefined) return compiled;
      // The compiler threw while checking this file: the checker is
      // untrustworthy; the file fails and the program is built without it.
      if (!failedWarm.limit) {
        const blamed = failedWarm.blame;
        failCompiler(
          blamed !== undefined && captured.has(blamed)
            ? blamed
            : failedWarm.path,
          failedWarm.message,
        );
        continue;
      }
      if (fullWarmup) warmSkip.add(failedWarm.path);
      fullWarmup = true;
      warmed.clear();
    }
  };
  let current: ReturnType<typeof build> | undefined = build();
  const session: Session = {
    get program() {
      return current!.program;
    },
    get checker() {
      return current!.checker;
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
      warmed.clear();
      // The old program is not needed while the next one is built.
      current = undefined;
      current = build();
      return broadened;
    },
    drop(path, message) {
      failCompiler(path, message);
      session.rebuilds++;
      current = undefined;
      current = build();
    },
    get drops() {
      return compilerFailures;
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

/**
 * A file extracted with a checker whose taint walk stopped at its budget
 * (taint.ts): which links depend on a failed file is unknown, so every link
 * that could have a target is unresolved with `taint-budget-exhausted` and
 * keeps no target or library fact. Structural `contains` links and links
 * already failed (`invalid-code`) are unchanged.
 */
function withoutTaint(result: ParseResult): ParseResult {
  if (result.status === "failed") return result;
  return {
    ...result,
    links: result.links.map((link) => {
      const data = { ...((link.data ?? {}) as { [key: string]: Json }) };
      if (link.kind === "contains" || data.reason === "invalid-code")
        return link;
      delete data.targets;
      delete data.libraryFacts;
      data.reason = "taint-budget-exhausted";
      return { ...link, data };
    }),
  };
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

/**
 * One digest of the module's failed files and their content (path and
 * hash, sorted), recorded on every result so that an unchanged re-index can
 * recognise them; none when no file failed. A digest, not the map: every
 * result is stored on its own, and a map of N failed files in each of M
 * results is N x M in the store (microsoft/TypeScript: 12,473 failed files
 * in 27,190 results, about 52 GB as JSON; docs/changes/C-26.md).
 */
const failedDigest = (
  entries: readonly (readonly [string, string])[],
): string | undefined =>
  entries.length
    ? contentHash(
        Buffer.from(
          JSON.stringify(
            [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
          "utf8",
        ),
      )
    : undefined;

/** A projected source can change even unrelated compiler answers, through
 * ambient declarations or receiver types. Keep existing answers and mark
 * new answers, including ones whose target lies beyond the entry package. */
function withWorkspaceAssumptions(
  projected: ParseResult,
  plain: ParseResult,
): ParseResult {
  if (plain.status === "failed" || projected.status === "failed") return plain;
  const key = (link: LinkDraft) =>
    JSON.stringify([link.sourceKey, siteOf(link), link.targetName]);
  const existing = new Map(plain.links.map((link) => [key(link), link]));
  return {
    ...projected,
    links: projected.links.map((link) => {
      if (link.kind === "contains") return link;
      const previous = existing.get(key(link));
      const data = { ...((link.data ?? {}) as { [key: string]: Json }) };
      const entry = data.unbuiltEntry as { assumed?: true } | undefined;
      const changed = !previous || outcomeOf(previous) !== outcomeOf(link);
      const before = previous?.data as
        | {
            reason?: string;
            targets?: TargetFact[];
            libraryFacts?: LibraryTarget[];
          }
        | undefined;
      if (previous && before?.reason === "invalid-code") return previous;
      if (
        previous &&
        before &&
        !before.reason &&
        (before.targets?.length || before.libraryFacts?.length) &&
        (changed || entry?.assumed)
      )
        return previous;
      if (changed || entry?.assumed) {
        if (!entry?.assumed) {
          if (previous) return previous;
          delete data.targets;
          delete data.libraryFacts;
          data.reason = "workspace-build-output-missing";
          return { ...link, data };
        }
        assume(data, unbuiltEntryAssumption);
        return { ...link, data };
      }
      return link;
    }),
  };
}

/** A file that cannot be read: failed, with its syntax errors, no facts. */
const invalidResult = (
  failure: { diagnostics: Diagnostic[] },
  failedFilesDigest: string | undefined,
): ParseResult => ({
  status: "failed",
  diagnostics: failure.diagnostics.map((item) => ({ ...item })),
  symbols: [],
  links: [],
  data: {
    analyzer: MODULE_VERSION,
    invalid: true,
    ...(failedFilesDigest ? { failedFilesDigest } : {}),
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
    const assumptions = merged.assumes as string[] | undefined;
    if (assumptions?.includes(unbuiltEntryAssumption)) {
      const entries = new Map(
        datas
          .filter((data) =>
            (data.assumes as string[] | undefined)?.includes(
              unbuiltEntryAssumption,
            ),
          )
          .map((data) => [
            JSON.stringify(data.unbuiltEntry),
            data.unbuiltEntry,
          ]),
      );
      if (entries.size === 1)
        merged.unbuiltEntry = entries.values().next().value!;
      else {
        delete merged.unbuiltEntry;
        delete merged.targets;
        delete merged.libraryFacts;
        merged.reason = "ambiguous-project";
        merged.assumes = assumptions.filter(
          (name) => name !== unbuiltEntryAssumption,
        );
      }
    }
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

/**
 * A TypeScript module instance. The default export is `typescriptModule()`;
 * tests pass `options` (see TypeScriptModuleOptions) to inject limits and
 * faults without changing any global state.
 */
export function typescriptModule(
  hooks: TypeScriptModuleOptions = {},
): LanguageModule {
  const module: LanguageModule = {
    id: "typescript",
    version: MODULE_VERSION,
    // `.d.ts`, `.d.mts` and `.d.cts` are covered by the `.ts`, `.mts` and `.cts` claims.
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    contextFiles: CONTEXT_PATTERNS,
    dependencyInputs: true,
    incrementalAnalysis: true,
    analyze(context) {
      const files = context.files.filter(readable);
      // Unchanged snapshot: stored facts came from a complete analysis of these
      // exact sources and contexts by this module version, so they are reused
      // without building a program. The core retries a failed file whose content
      // marker is absent; if every changed file is such a failed file with the
      // same content as recorded (`failedFilesDigest`), nothing else can
      // differ: only it is parsed again, for its diagnostics.
      const changed = new Set(context.changedFiles);
      const kept = files.filter((file) => !changed.has(file.path));
      const dataOf = (file: GraphFile) =>
        (file.result.data ?? {}) as {
          analyzer?: unknown;
          failedFilesDigest?: string;
          invalid?: boolean;
        };
      const recorded = kept[0] && dataOf(kept[0]).failedFilesDigest;
      // The recorded failed files, if only their markers changed: the kept
      // files that failed as invalid code and every changed file, each with
      // its current content.
      const expected = failedDigest([
        ...kept
          .filter((file) => dataOf(file).invalid === true)
          .map((file) => [file.path, file.hash] as const),
        ...files
          .filter((file) => changed.has(file.path))
          .map((file) => [file.path, file.hash] as const),
      ]);
      if (
        !context.changedContextFiles.length &&
        kept.every(
          (file) =>
            dataOf(file).analyzer === MODULE_VERSION &&
            dataOf(file).failedFilesDigest === recorded,
        ) &&
        [...changed].every((path) =>
          files.some((item) => item.path === path),
        ) &&
        expected === recorded
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
      const buildModel = () =>
        projectModel(
          files,
          context.contextFiles,
          context.dependencyInputs,
          hooks.programCharacters,
        );
      /**
       * A failed file (its own syntax errors) that declares no global name
       * and that stored links name only as the specifier of an import with
       * no bindings (`import "./fixture"`): no declaration binds it, so a
       * program that asks for it has an empty failed-file walk (taint.ts),
       * before and after an edit that keeps the edited file's imports. Any
       * other failed file in a program a scoped analysis relies on: no
       * scoped analysis.
       */
      const quietFailures = new Map<string, boolean>();
      const storedResults = [
        ...files,
        ...(context.previousFiles?.values() ?? []),
      ].map((item) => ({ item, links: JSON.stringify(item.result.links) }));
      const sideEffectImport = (file: GraphFile, start: number) => {
        const source = ts.createSourceFile(
          toVirtual(file.path),
          file.text,
          ts.ScriptTarget.Latest,
          true,
        );
        return source.statements.some(
          (statement) =>
            ts.isImportDeclaration(statement) &&
            !statement.importClause &&
            statement.moduleSpecifier.getStart(source) === start,
        );
      };
      const quiet = (path: string): boolean => {
        const known = quietFailures.get(path);
        if (known !== undefined) return known;
        const file = files.find((item) => item.path === path);
        const failure =
          file?.result.status === "failed" &&
          (file.result.data as { invalid?: unknown } | undefined)?.invalid ===
            true
            ? syntaxFailure(path, file.text)
            : undefined;
        const named = JSON.stringify(path);
        const answer =
          !!failure &&
          !failure.names.length &&
          storedResults.every(
            ({ item, links }) =>
              !links.includes(named) ||
              item.result.links.every(
                (link) =>
                  !JSON.stringify(link).includes(named) ||
                  (link.kind === "imports" &&
                    sideEffectImport(item, link.range.start)),
              ),
          );
        quietFailures.set(path, answer);
        return answer;
      };
      const candidate = scopedCandidate(context, files);
      if (candidate) {
        // Anything a scoped attempt throws leaves the full analysis to
        // decide (it builds its own model and programs).
        let scoped: ScopedAnalysis | undefined;
        try {
          scoped = scopedAnalysis(
            candidate.path,
            candidate.previous,
            candidate.retried,
          );
        } catch {
          declined("an exception");
        }
        if (scoped) return scoped;
      }
      // The full analysis reads the installed declarations afresh.
      if (context.dependencyInputs) context.dependencyInputs.refreshed = true;
      return run(buildModel());
      /**
       * A stored result a scoped analysis can stand on: analysed by this
       * version, not failed, and without a compiler limit (whose answers
       * depend on what was asked before).
       */
      function complete(result: ParseResult): boolean {
        const data = (result.data ?? {}) as { analyzer?: unknown };
        return (
          result.status !== "failed" &&
          data.analyzer === MODULE_VERSION &&
          !result.diagnostics.some((item) =>
            /exhausted its stack|overflowed/.test(item.message),
          ) &&
          !result.links.some(
            (link) =>
              (link.data as { reason?: unknown } | undefined)?.reason ===
              "compiler-limit",
          )
        );
      }
      /**
       * One edited file whose old and new syntactic surfaces match, in a
       * project whose stored results are all complete (no failed file, no
       * compiler limit): the only case a scoped analysis is tried for.
       */
      function scopedCandidate(
        context: Parameters<NonNullable<LanguageModule["analyze"]>>[0],
        files: readonly GraphFile[],
      ):
        | { path: string; previous: GraphFile; retried: GraphFile[] }
        | undefined {
        const previousFiles = context.previousFiles;
        if (!previousFiles || context.changedContextFiles.length)
          return declined("no previous facts");
        // The core retries every failed file whose failure is not certified
        // as its content (a broken config, for one) on every index: such a
        // file with the same content as before is not an edit.
        const byHash = new Map(files.map((file) => [file.path, file.hash]));
        const retried = context.changedFiles
          .map((changed) => previousFiles.get(changed))
          .filter(
            (old): old is GraphFile =>
              old?.result.status === "failed" &&
              old.hash === byHash.get(old.path),
          );
        const edited = context.changedFiles.filter(
          (changed) => !retried.some((old) => old.path === changed),
        );
        if (edited.length !== 1) return declined("not one edited file");
        const path = edited[0]!;
        const previous = previousFiles.get(path);
        if (!previous || !files.some((file) => file.path === path))
          return declined("no previous facts");
        const stored = (result: ParseResult) =>
          complete(result) &&
          Array.isArray((result.data as { loadedBy?: unknown }).loadedBy);
        // Another file may have failed for its own syntax errors (stored
        // as invalid code): the programs this analysis builds must then not
        // load it (checked there). Any other failure: no scoped analysis.
        const invalid = (result: ParseResult) =>
          result.status === "failed" &&
          (result.data as { analyzer?: unknown; invalid?: unknown } | undefined)
            ?.analyzer === MODULE_VERSION &&
          (result.data as { invalid?: unknown }).invalid === true;
        if (
          !stored(previous.result) ||
          // The edited file itself was not renamed for the compiler (rename.ts).
          (previous.result.data as { renamedForCompiler?: unknown })
            .renamedForCompiler !== undefined ||
          (previous.result.data as { dynamicScopeOccurrences?: unknown })
            .dynamicScopeOccurrences !== undefined ||
          files.some(
            (file) =>
              file.path !== path &&
              !retried.some((old) => old.path === file.path) &&
              !stored(file.result) &&
              !invalid(file.result),
          )
        )
          return declined("a stored result it cannot stand on");
        // A program that asked for a failed file has a failed-file walk
        // (taint), which can read the edited file's bodies.
        const loaders = new Set(
          (previous.result.data as { loadedBy: string[] }).loadedBy,
        );
        if (
          files.some(
            (file) =>
              file.result.status === "failed" &&
              (
                (file.result.data as { loadedBy?: string[] } | undefined)
                  ?.loadedBy ?? []
              ).some((name) => loaders.has(name)) &&
              !quiet(file.path),
          )
        )
          return declined("a loading program reads a failed file");
        const current = files.find((file) => file.path === path)!;
        const before = syntacticSurface(path, previous.text);
        if (
          !hooks.trustSurface &&
          (before === undefined ||
            before !== syntacticSurface(path, current.text))
        )
          return declined("syntactic surface");
        return { path, previous, retried };
      }
      /**
       * Extracts only the edited file, in its own project, and keeps every
       * other stored result, when nothing another file's analysis reads of
       * it changed: its checker surface is the same before and after in
       * every program that loads it (scoped.ts). Undefined otherwise.
       */
      function scopedAnalysis(
        path: string,
        previous: GraphFile,
        retried: readonly GraphFile[],
      ): ScopedAnalysis | undefined {
        const model = buildModel();
        if (model.omitted.size || model.failures.has(path))
          return declined("a failed config or project");
        // A retried failure must come out as before: the failure its broken
        // config or manifest gives (the full analysis's first results).
        const again: AnalyzedFile[] = [];
        for (const old of retried) {
          const message = model.failures.get(old.path);
          const result = message === undefined ? undefined : failed(message);
          if (!result || JSON.stringify(result) !== JSON.stringify(old.result))
            return declined("a retried failure");
          again.push({ path: old.path, result });
        }
        if (model.renames.has(path))
          return declined("renamed for the compiler");
        // Fresh names come from every text: the old text must give the same.
        const fresh = freshNames(
          files.map((file) => (file.path === path ? previous.text : file.text)),
        );
        if (JSON.stringify(fresh) !== JSON.stringify(model.fresh))
          return declined("fresh names");
        const owners = model.groups.filter((group) =>
          group.roots.includes(toVirtual(path)),
        );
        if (!owners.length) return declined("no owning project");
        const byName = new Map<string, ProjectGroup | null>();
        for (const group of model.groups)
          byName.set(
            groupName(group),
            byName.has(groupName(group)) ? null : group,
          );
        const loadedBy = (previous.result.data as { loadedBy: string[] })
          .loadedBy;
        const loaders = loadedBy.map((name) => byName.get(name));
        if (
          owners.some((owner) => !loadedBy.includes(groupName(owner))) ||
          loaders.some((group) => !group)
        )
          return declined("loading programs unknown");
        const scope: Scope = { path, sessions: new Map(), broken: false };
        // Failures the programs below find (a syntax error, a compiler
        // exception) other than a quiet failed file: then no scoped result.
        const failuresBefore = new Set(model.parseFailures.keys());
        const analysed = run(model, scope);
        const item = analysed.find((entry) => entry.path === path);
        if (
          scope.broken ||
          scope.sessions.size !== owners.length ||
          analysed.length !== 1 ||
          !item ||
          !complete(item.result)
        )
          return declined("edited file's own analysis");
        const virtual = toVirtual(path);
        for (const group of hooks.trustSurface
          ? []
          : (loaders as ProjectGroup[])) {
          const roots = group.roots;
          // An owning project's extraction program: its files are reused.
          const session = scope.sessions.get(group);
          const host = session?.host ?? model.host(group);
          const now = ts.createProgram({
            rootNames: roots,
            options: group.options,
            host,
            ...(session ? { oldProgram: session.program } : {}),
            ...(group.references?.length
              ? { projectReferences: group.references }
              : {}),
          });
          const source = now.getSourceFile(virtual);
          // A program that asks for a failed file other than a quiet one has
          // a failed-file walk (taint), which can read the edited file's
          // bodies: no scoped analysis.
          if (
            !source ||
            [...model.requested(host)].some((asked) => !quiet(asked))
          )
            return declined("a loading program");
          // The same program with the file's previous text.
          const earlier: ts.CompilerHost = {
            ...host,
            getSourceFile: (name, version, onError, create) =>
              // The host caches what it parsed, so the other files are the
              // same objects (never a program's project-reference redirect).
              name === virtual
                ? ts.createSourceFile(name, previous.text, version, true)
                : host.getSourceFile(name, version, onError, create),
          };
          const before = ts.createProgram({
            rootNames: roots,
            options: group.options,
            host: earlier,
            oldProgram: now,
            ...(group.references?.length
              ? { projectReferences: group.references }
              : {}),
          });
          statistics.surfacePrograms += 2;
          let old: string | undefined;
          let next: string | undefined;
          try {
            old = checkerSurface(before, before.getTypeChecker(), virtual);
            next = checkerSurface(now, now.getTypeChecker(), virtual);
          } catch {
            return declined("checker threw");
          }
          if (old === undefined || old !== next)
            return declined("checker surface");
          if (
            moduleKindOf(before.getSourceFile(virtual)) !== moduleKindOf(source)
          )
            return declined("module kind");
        }
        for (const failure of model.parseFailures.keys())
          if (!failuresBefore.has(failure) && !quiet(failure))
            return declined("new failures");
        // Declarations of the file may have moved: other files' target
        // facts follow them (the store's IDs are identity and ordinal).
        const keys = rekey(previous.result.symbols, item.result.symbols);
        if (!keys && !hooks.trustSurface)
          return declined("declarations do not pair");
        const moved: AnalyzedFile[] = [];
        for (const file of keys ? files : []) {
          if (file.path === path) continue;
          const next = moveTargets(file.result, path, keys!);
          if (!next) return declined("unknown target key");
          if (next !== file.result)
            moved.push({ path: file.path, result: next });
        }
        const digest = (previous.result.data as { failedFilesDigest?: string })
          .failedFilesDigest;
        const result: ParseResult = {
          ...item.result,
          data: {
            ...(item.result.data as { [key: string]: Json }),
            loadedBy,
            ...(digest === undefined ? {} : { failedFilesDigest: digest }),
          },
        };
        statistics.scoped++;
        return {
          files: [{ path, result }, ...moved, ...again],
          resolutionFiles: [
            path,
            ...moved.map((entry) => entry.path),
            ...again.map((entry) => entry.path),
          ],
        };
      }
      function run(model: ProjectModel, scope?: Scope): AnalyzedFile[] {
        const libraries = libraryReader(
          model.manifests,
          files,
          model.workspaceRoots,
          model.workspaceBoundaries,
          model.workspaceCatalogs,
          context.dependencyInputs,
        );
        const byPath = new Map(files.map((file) => [file.path, file]));
        const captured = new Set(byPath.keys());
        const results: AnalyzedFile[] = [];
        // A broken config or manifest fails only the files it governs, not the module.
        // (A scoped analysis delivers these itself.)
        if (!scope)
          for (const [path, message] of model.failures)
            results.push({ path, result: failed(message) });
        const tiedResults = new Map<string, ParseResult[]>();
        /** Projects analysed so far: the captured files their programs loaded. */
        const loadedBy = new Map<ProjectGroup, Set<string>>();
        /** The failed files each project's program asked for (C-38). */
        const askedBy = new Map<ProjectGroup, ReadonlySet<string>>();
        const deliver = (path: string, result: ParseResult) => {
          if (model.ties.has(path))
            tiedResults.set(path, [...(tiedResults.get(path) ?? []), result]);
          else results.push({ path, result });
        };
        /**
         * One rule for a file the compiler threw on while a later project was
         * analysed, when earlier projects had already published or read it:
         * the store has one result per file, so it is failed for the store.
         * Its published result becomes the failed-file result; published links
         * that target it are `target-unavailable`; and every other link of a
         * project whose program read it is flagged
         * `no-unseen-declarations` (computed with a file the store now calls
         * unreadable: unverified, W2-D).
         */
        const retract = (path: string, message: string) => {
          const readers = new Set<string | null>();
          for (const [group, loaded] of loadedBy)
            if (loaded.has(path)) readers.add(group.config);
          const redecide = (result: ParseResult): ParseResult => {
            if (result.status === "failed") return result;
            const project = (result.data as { project?: string | null })
              ?.project;
            const read = project !== undefined && readers.has(project);
            return {
              ...result,
              links: result.links.map((link) => {
                const data = (link.data ?? {}) as { [key: string]: Json };
                const targets = (data.targets ?? []) as unknown as TargetFact[];
                if (targets.some((target) => target.file === path)) {
                  const next: { [key: string]: Json } = {
                    ...data,
                    reason: "target-unavailable",
                  };
                  delete next.targets;
                  delete next.libraryFacts;
                  return { ...link, data: next };
                }
                if (
                  !read ||
                  link.kind === "contains" ||
                  data.reason === "invalid-code"
                )
                  return link;
                const next = { ...data };
                assume(next, "no-unseen-declarations");
                return { ...link, data: next };
              }),
            };
          };
          for (const item of results)
            item.result =
              item.path === path ? failed(message) : redecide(item.result);
          for (const [other, variants] of tiedResults)
            tiedResults.set(
              other,
              variants.map((variant) =>
                other === path ? failed(message) : redecide(variant),
              ),
            );
        };
        for (const group of model.groups) {
          if (!group.roots.length) continue;
          if (scope && !group.roots.includes(toVirtual(scope.path))) continue;
          const roots = () =>
            group.roots.filter(
              (root) => !model.parseFailures.has(root.slice(1)),
            );
          const ownRoots = new Set(group.roots.map((root) => root.slice(1)));
          let latestHost: ts.CompilerHost | undefined;
          /** Compiler failures of other projects that this program loads. */
          const inherited = () => {
            if (!latestHost) return 0;
            let count = 0;
            for (const path of model.requested(latestHost))
              if (
                !ownRoots.has(path) &&
                model.parseFailures.get(path)?.startsWith(COMPILER_FAILURE)
              )
                count++;
            return count;
          };
          let normal: Session | undefined = openSession(
            roots,
            group.options,
            () => (latestHost = model.host(group)),
            model.parseFailures,
            captured,
            group.references,
            model.hasWorkspacePackages,
            // Any syntactic diagnostic fails a file: also the compiler's
            // syntax-phase checks the parser does not make (TypeScript-only
            // syntax in a JS file, TS8xxx).
            (program, fail) => {
              let failedAny = false;
              for (const source of program.getSourceFiles()) {
                const path = fromVirtual(source.fileName);
                if (path === undefined || !captured.has(path)) continue;
                let extra: readonly ts.Diagnostic[];
                try {
                  hooks.syntaxFault?.(path);
                  extra = program.getSyntacticDiagnostics(source);
                } catch (error) {
                  // The compiler threw on this file: it fails, absent from the
                  // next build, under the session's cap.
                  fail(path, compilerFailure(error));
                  failedAny = true;
                  continue;
                }
                if (extra.length && model.failSyntax(path, extra))
                  failedAny = true;
              }
              return failedAny;
            },
            hooks,
            inherited,
          );
          if (model.dependencyLimit(group)) {
            for (const root of group.roots)
              deliver(
                root.slice(1),
                operationalFailure(
                  "Installed declarations exceed the TypeScript program's input budget",
                ),
              );
            continue;
          }
          const provenance = new WeakMap<
            ts.Program,
            ReturnType<typeof entryProvenance>
          >();
          const resolveModule = (
            session: Session,
            specifier: ts.StringLiteralLike,
          ): ReturnType<RenameContext["resolveModule"]> => {
            const source = specifier.getSourceFile();
            const from = fromVirtual(source.fileName);
            if (from === undefined) return undefined;
            const selected = model.selectSpecifier(specifier.text, from);
            if (selected === undefined) return undefined;
            const { host, program } = session;
            const mode = relativeSpecifier(selected)
              ? program.getModeForUsageLocation(source, specifier)
              : undefined;
            const resolve = (
              text: string,
              resolutionMode: ts.ResolutionMode,
              resolutionHost = host,
            ) =>
              ts.resolveModuleName(
                text,
                source.fileName,
                group.options,
                resolutionHost,
                undefined,
                undefined,
                resolutionMode,
              ).resolvedModule;
            let resolved = resolve(selected, mode);
            if (!resolved && mode === ts.ModuleKind.ESNext) {
              // Preserve the legacy extension-only edge when adding a file
              // extension would reach that same file in the real mode. A
              // permissive lookup can also find an index or a package entry,
              // which an ESM directory import must never target.
              const fallback = resolve(selected, undefined);
              if (!fallback) return undefined;
              const candidate = posix.resolve(
                posix.dirname(source.fileName),
                selected,
              );
              const withoutDirectory = {
                ...host,
                directoryExists: (name: string) =>
                  name !== candidate &&
                  name !== candidate + "/" &&
                  (host.directoryExists?.(name) ?? true),
              };
              // A permissive result proves a directory edge when the literal
              // requests a directory, or withholding that directory changes
              // the compiler's selection. An empty directory proves nothing.
              if (
                /(?:\/|(?:^|\/)\.\.?)$/.test(selected) ||
                (host.directoryExists?.(candidate) &&
                  resolve(selected, undefined, withoutDirectory)
                    ?.resolvedFileName !== fallback.resolvedFileName)
              )
                return { reason: "directory-import-not-allowed-in-esm" };
              if (
                // With rootDirs, a directory entry and an explicitly
                // extended file in another overlay can select the same path.
                posix.dirname(fallback.resolvedFileName) ===
                  posix.dirname(candidate) &&
                resolve(selected + fallback.extension, mode)
                  ?.resolvedFileName === fallback.resolvedFileName
              )
                resolved = fallback;
            }
            const path =
              resolved &&
              fromVirtual(
                host.realpath?.(resolved.resolvedFileName) ??
                  resolved.resolvedFileName,
              );
            return path === undefined ? undefined : { path };
          };
          /**
           * What a captured target file is. `script` means only: analysed, no
           * syntax errors, and no ES or CommonJS exports. A file that failed to
           * parse or bind is `unavailable`; one with syntax errors and no exports
           * found is `partial` (its exports cannot be ruled out).
           */
          const moduleKind = (
            session: Session,
            path: string,
          ): "module" | "script" | "invalid" | "unavailable" => {
            if (model.syntaxFailures.has(path)) return "invalid";
            if (model.parseFailures.has(path) || model.failures.has(path))
              return "unavailable";
            const source =
              session.program.getSourceFile(toVirtual(path)) ??
              session.host.getSourceFile(
                toVirtual(path),
                ts.ScriptTarget.Latest,
              );
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
              /(^|[^.\w$])(module\.exports|exports\.[\w$]+)\s*=/.test(
                source.text,
              )
            )
              return "module";
            return "script";
          };
          /**
           * One extraction attempt. An exception becomes plain data: it holds
           * the compiler's stack frames and through them the checker, which a
           * rebuild must be free to release.
           */
          const extractOnce = (
            session: Session,
            path: string,
            data: { [key: string]: Json },
            diagnostics: Diagnostic[],
            renamed: Renamed | undefined,
            skip: Set<string>,
          ):
            | { result: ParseResult }
            | { limit: string }
            | { drop: string; blame: string | undefined }
            | { internal: string } => {
            lastAsked = undefined;
            if (exhaustedSessions.has(session))
              markTaintExhausted(session.checker);
            try {
              if (injectedExtractionFaults.has(path))
                throw new TypeError("injected internal fault (test)");
              const source = session.program.getSourceFile(toVirtual(path));
              if (!source) {
                const failure = session.failures.get(path);
                // The parser or binder exhausted its stack on this file: an
                // environment limit, like the checker's, not invalid code.
                if (failure?.includes("exhausted its stack"))
                  return {
                    result: operationalFailure(
                      `${failure} (a resource limit of the TypeScript compiler in this environment, not a defect in the file; it is retried on the next index)`,
                    ),
                  };
                // The compiler threw on it, or its project is too large: a
                // failed file with that reason.
                if (
                  failure?.startsWith(COMPILER_FAILURE) ||
                  model.omitted.has(path)
                )
                  return { result: failed(failure!) };
                const refused = model.refusedIn(group, path);
                if (refused) return { result: failed(refused) };
                // Anything else the compiler threw is an internal error.
                throw Error(failure ?? "The compiler did not load this source");
              }
              if (!provenance.has(session.program))
                provenance.set(
                  session.program,
                  entryProvenance(
                    session.program,
                    model.unbuiltEntries(session.host),
                    captured,
                  ),
                );
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
                  resolveModule: (specifier) =>
                    resolveModule(session, specifier),
                  hasDenoImports: model.hasDenoImports,
                  selectSpecifier: model.selectSpecifier,
                  workspaceReason: model.workspaceReason,
                  unbuilt: provenance.get(session.program),
                  workspaceBoundaryKnown: model.workspaceBoundaryKnown,
                  skip,
                  moduleKind: (target) => moduleKind(session, target),
                  anyFailed: unseen.size > 0,
                  failedNames,
                },
                libraries,
              );
              // The core validates the batch as a whole. Check this file's
              // positions here so bad compiler facts can use the same drop
              // and rebuild path as a compiler exception.
              const length = byPath.get(path)!.text.length;
              if (
                source.text.length !== length ||
                result.symbols.some(
                  ({ range }) => !validSourceRange(range, length),
                ) ||
                result.links.some(
                  ({ range }) => !validSourceRange(range, length),
                ) ||
                result.diagnostics.some(
                  ({ range }) => range && !validSourceRange(range, length),
                )
              )
                return {
                  drop: `${COMPILER_FAILURE}: Invalid UTF-16 range in the extracted facts for ${path}`,
                  blame: path,
                };
              statistics.extracted++;
              if (taintExhausted(session.checker)) {
                // Later checkers of this session (rebuilt from this program,
                // one file fewer at most) skip the walk: a rebuild per failing
                // file would otherwise repeat it to the budget each time.
                exhaustedSessions.add(session);
                return { result: withoutTaint(result) };
              }
              return { result };
            } catch (error) {
              if (error instanceof CheckerLimit) return { limit: error.key };
              if (isCompilerAssertion(error))
                return { drop: compilerFailure(error), blame: askedFile() };
              return { internal: internalErrorMessage(path, error) };
            }
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
              const outcome = extractOnce(
                session,
                path,
                data,
                diagnostics,
                renamed,
                skip,
              );
              if ("result" in outcome) return outcome.result;
              // A rebuild below inherits a walk that reached its budget.
              if (taintExhausted(session.checker))
                exhaustedSessions.add(session);
              if ("limit" in outcome) {
                if (
                  attempt < MAX_LIMIT_RETRIES &&
                  session.rebuilds <= MAX_PROGRAM_REBUILDS
                ) {
                  // The checker's state is untrustworthy after an overflow:
                  // retry with dependencies warmed before omitting a lookup.
                  if (!session.rebuild()) skip.add(outcome.limit);
                  continue;
                }
                // Never leave an overflowed checker in use for the next file.
                session.rebuild();
                return operationalFailure(
                  `The TypeScript checker exhausted its stack more than ${MAX_LIMIT_RETRIES} times in this file`,
                );
              }
              if ("drop" in outcome) {
                // A compiler assertion or invalid range makes the file's facts
                // unavailable. Rebuild without it before extracting other files.
                const blamed =
                  outcome.blame !== undefined && captured.has(outcome.blame)
                    ? outcome.blame
                    : path;
                session.drop(blamed, outcome.drop);
                if (session === normal) {
                  markUnseen(blamed);
                  retract(blamed, outcome.drop);
                }
                if (blamed !== path) continue;
                return failed(outcome.drop);
              }
              return operationalFailure(outcome.internal);
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
          // The global names a failed file declares: as far as the parser read
          // it, or, for a readable file left out (the compiler threw on it, or
          // its project is too large), all of them.
          const namesOf = (path: string): readonly string[] =>
            model.syntaxFailures.get(path)?.names ??
            (model.omitted.has(path) ||
            model.refusedIn(group, path) !== undefined ||
            model.parseFailures.get(path)?.startsWith(COMPILER_FAILURE)
              ? model.globalNames(path)
              : []);
          for (const path of [...unseen].sort())
            for (const name of namesOf(path))
              failedNames.set(name, [...(failedNames.get(name) ?? []), path]);
          /** A file the compiler threw on while extracting: unseen from now on. */
          const markUnseen = (path: string) => {
            if (unseen.has(path)) return;
            unseen.add(path);
            for (const name of namesOf(path))
              failedNames.set(
                name,
                [...(failedNames.get(name) ?? []), path].sort(),
              );
          };
          // A file dropped while this project is extracted (the compiler threw
          // on it) changes the program: the project is extracted again from its
          // first file, so files before and after the drop agree. Each round
          // needs a further drop, and drops are capped (MAX_COMPILER_FAILURES).
          let analysed: [string, ParseResult][] = [];
          for (;;) {
            analysed = [];
            const dropsBefore = normal.drops;
            for (const root of group.roots) {
              const path = root.slice(1);
              if (scope && path !== scope.path) continue;
              // A file that cannot be read is not valid code: it has failed, with
              // its syntax errors (first by position) as diagnostics.
              const syntax = model.syntaxFailures.get(path);
              if (syntax) {
                analysed.push([path, invalidResult(syntax, undefined)]);
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
              const diagnostics: Diagnostic[] = group.limitations.map(
                (message) => ({
                  message,
                }),
              );
              if (renamed?.uncertain.length)
                diagnostics.push({
                  message: `${renamed.uncertain.length} occurrence(s) of require/module/exports cannot be decided statically (with, direct eval, reassignment, or a createRequire base other than this file); their links are unresolved`,
                });
              analysed.push([
                path,
                extractWith(normal, path, data, diagnostics, renamed),
              ]);
            }
            if (normal.drops === dropsBefore) break;
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
          loadedBy.set(
            group,
            new Set(
              normal.program
                .getSourceFiles()
                .map((source) => fromVirtual(source.fileName))
                .filter(
                  (path): path is string =>
                    path !== undefined && captured.has(path),
                ),
            ),
          );
          askedBy.set(group, new Set(model.requested(normal.host)));
          // The differential pass shares the original parse cache. Its lookups
          // do not need the original program or checker.
          const baseHost = normal.host;
          const projectedEntries = model.unbuiltEntries(baseHost);
          const workspaceAssumed =
            projectedEntries &&
            [...projectedEntries.values()].some((entry) => entry.assumed);
          if (scope) {
            // Anything that makes this project's answers depend on the files
            // extracted with it, or on a second program: no scoped result.
            scope.sessions.set(group, normal);
            if (
              normal.drops ||
              normal.rebuilds ||
              [...unseen].some((asked) => !quiet(asked)) ||
              assumedTexts.size ||
              workspaceAssumed
            )
              scope.broken = true;
          }
          normal = undefined;
          const differential = (
            texts: ReadonlyMap<string, string>,
            plainWorkspaceEntries: boolean,
          ) => {
            statistics.neutralPrograms++;
            const failures = new Map(model.parseFailures);
            const neutral = openSession(
              () => group.roots.filter((root) => !failures.has(root.slice(1))),
              group.options,
              () =>
                model.host(group, {
                  texts,
                  base: baseHost,
                  failures,
                  plainWorkspaceEntries,
                }),
              failures,
              captured,
              group.references,
              model.hasWorkspacePackages,
              undefined,
              hooks,
            );
            return (path: string) => {
              const renamed = model.renames.get(path);
              // The assumed loader becomes an undeclared name (see rename.ts).
              const context: Renamed | undefined =
                texts.has(path) && renamed?.assumed.length
                  ? {
                      ...renamed,
                      uncertain: [...renamed.uncertain, ...renamed.assumed],
                      assumed: [],
                    }
                  : renamed;
              const other = extractWith(neutral, path, {}, [], context);
              statistics.neutralExtracted++;
              return other;
            };
          };
          if (assumedTexts.size) {
            const withoutBundler = differential(assumedTexts, false);
            analysed = analysed.map(([path, result]) => [
              path,
              result.status === "failed"
                ? result
                : labelled(result, differing(result, withoutBundler(path))),
            ]);
          }
          if (workspaceAssumed) {
            const withoutWorkspace = differential(new Map(), true);
            let plain: [string, ParseResult][] = analysed.map(
              ([path, result]) => [
                path,
                result.status === "failed" ? result : withoutWorkspace(path),
              ],
            );
            if (assumedTexts.size) {
              const withoutEither = differential(assumedTexts, true);
              plain = plain.map(([path, result]) => [
                path,
                result.status === "failed"
                  ? result
                  : labelled(result, differing(result, withoutEither(path))),
              ]);
            }
            analysed = analysed.map(([path, result], index) => [
              path,
              withWorkspaceAssumptions(result, plain[index]![1]),
            ]);
          }
          for (const [path, result] of analysed) {
            let final = result;
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
        // Every result names the programs that loaded its file (C-38): an edit
        // of the file is compared in each of them before other files' results
        // are kept. A failed file names the programs that asked for it: an
        // edit read by one of those is never scoped.
        if (!scope)
          for (const item of results) {
            const data = item.result.data as
              | { [key: string]: Json }
              | undefined;
            if (data?.analyzer !== MODULE_VERSION) continue;
            const names = new Set<string>();
            for (const [group, loaded] of item.result.status === "failed"
              ? askedBy
              : loadedBy)
              if (loaded.has(item.path)) names.add(groupName(group));
            item.result = {
              ...item.result,
              data: { ...data, loadedBy: [...names].sort() },
            };
          }
        // Every result records the digest of the module's failed files and
        // their content, so an unchanged re-index can recognise them (above).
        // (A scoped analysis parses only some files: it keeps the edited
        // file's recorded digest, the failed files being the same.)
        const failedFilesDigest =
          !scope &&
          failedDigest(
            files
              .filter((file) => model.syntaxFailures.has(file.path))
              .map((file) => [file.path, file.hash] as const),
          );
        if (failedFilesDigest)
          for (const item of results) {
            const data = item.result.data as
              | { [key: string]: Json }
              | undefined;
            if (data?.analyzer === MODULE_VERSION)
              item.result = {
                ...item.result,
                data: { ...data, failedFilesDigest },
              };
          }
        // Only failures reproduced from this file alone may outlive a project
        // analysis. Config/ownership failures, compiler/checker limits, internal
        // exceptions and diagnostics added by a Program remain retryable. Compare
        // the whole diagnostic set: a local syntax error must not hide another,
        // context-dependent failure. Tied configs may order diagnostics differently.
        const diagnosticSet = (diagnostics: readonly Diagnostic[]) =>
          JSON.stringify(
            diagnostics.map((item) => JSON.stringify(item)).sort(),
          );
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
      }
    },
    resolutionNeedsFiles: false,
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
  return module;
}
export default typescriptModule();
