import ts from "typescript";
import { contentHash } from "../../index.js";
import type {
  AnalyzedFile,
  Diagnostic,
  GraphFile,
  Json,
  LanguageModule,
  LinkDraft,
  LinkResolution,
  ParseResult,
} from "../../types.js";
import { CheckerLimit, extractFile, type TargetFact } from "./extract.js";
import type { Renamed } from "./rename.js";
import {
  errorPositions,
  neutralizeAssumed,
  neutralizeSpans,
  untrustedSpans,
} from "./untrusted.js";

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
  toVirtual,
} from "./project.js";

/**
 * TypeScript and JavaScript through the TypeScript compiler. Analyze-only: one
 * Program per owning config, built over the captured snapshot through a virtual
 * host. Analysis records each link's checker targets as (file, symbol key)
 * facts; resolve maps those facts to symbol IDs. See docs/changes/W2-D.md.
 */
// Bump the leading number whenever extraction or resolution semantics change.
const MODULE_VERSION = `8+typescript-${ts.version}`;

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
  /** A fresh program and checker (the old checker is untrustworthy). */
  rebuild(): void;
}

/**
 * Opens a session. The host caches parsed files, so rebuilding a program
 * after a checker overflow (see CheckerLimit) re-binds but never re-parses.
 * The binder writes into cached SourceFiles: after a binder overflow that
 * cache is corrupt, so the host (and its cache) is replaced. The binder runs
 * inside getTypeChecker(): a binder overflow is traced to the file(s) that
 * cause it, which then fail alone (like parser failures). The warm-up asks
 * for variable types and function return types of every captured file in
 * program order, so a file's answers never depend on which other file
 * happened to be extracted before a rebuild.
 */
function openSession(
  roots: () => string[],
  options: ts.CompilerOptions,
  makeHost: () => ts.CompilerHost,
  failures: Map<string, string>,
  captured: ReadonlySet<string>,
): Session {
  let host = makeHost();
  /** Captured files whose warm-up overflowed: never warmed again. */
  const warmSkip = new Set<string>();
  let lastProgram: ts.Program | undefined;
  const compile = () => {
    statistics.programs++;
    const program = ts.createProgram({ rootNames: roots(), options, host });
    try {
      return { program, checker: program.getTypeChecker() };
    } catch (error) {
      lastProgram = program;
      throw error;
    }
  };
  const warmAll = (
    program: ts.Program,
    checker: ts.TypeChecker,
  ): string | undefined => {
    for (const source of program.getSourceFiles()) {
      const path = fromVirtual(source.fileName);
      if (path === undefined || !captured.has(path) || warmSkip.has(path))
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
      const failedWarm = warmAll(compiled.program, compiled.checker);
      if (failedWarm === undefined) return compiled;
      warmSkip.add(failedWarm);
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
      session.rebuilds++;
      current = build();
    },
  };
  return session;
}

/** A link's comparable outcome: its target set and reason. */
const outcomeOf = (link: LinkDraft): string => {
  const data = (link.data ?? {}) as { targets?: TargetFact[]; reason?: string };
  const targets = (data.targets ?? [])
    .map((target) => `${target.file}\0${target.key}`)
    .sort();
  return JSON.stringify([targets, data.reason ?? null]);
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
 * Labels links that depend on untrusted input. Partial structure: a link
 * with targets and no other reason becomes unresolved `partial-declaration`,
 * its targets kept (never completing a candidate set). Bundler assumption:
 * `assumes: "bundler-require"`. When both apply, partial-declaration wins.
 */
function labelled(
  result: ParseResult,
  partial: ReadonlySet<number> | undefined,
  assumed: ReadonlySet<number> | undefined,
): ParseResult {
  const links = result.links.map((link, index) => {
    const isPartial = !!partial?.has(index);
    if (!isPartial && !assumed?.has(index)) return link;
    const data = { ...((link.data ?? {}) as { [key: string]: Json }) };
    if (
      isPartial &&
      (data.targets as Json[] | undefined)?.length &&
      !data.reason
    )
      data.reason = "partial-declaration";
    else if (assumed?.has(index)) data.assumes = "bundler-require";
    return { ...link, data };
  });
  return { ...result, links };
}

const failed = (message: string): ParseResult => ({
  status: "failed",
  diagnostics: [{ message }],
  symbols: [],
  links: [],
});

/**
 * Merges one file's results from equally ranked configs, independent of
 * their order. Symbols are syntactic and must be identical. For each link the
 * merged facts are the weakest, most qualified of the variants:
 * - targets: the union (sorted);
 * - reason: none if no variant has one and the targets agree or every
 *   variant was complete (then two or more targets are candidates); the one
 *   reason if every variant gives the same reason and the same targets;
 *   otherwise `ambiguous-project`, with `tiedReasons` listing them;
 * - `assumes`: kept if any variant has it;
 * - any other field that differs between variants is not picked from one of
 *   them: it moves to `byProject` (config → value), for every variant.
 */
function mergeTied(
  variants: ParseResult[],
  configs: (string | null)[],
): ParseResult {
  if (variants.some((variant) => variant.status === "failed")) {
    // The weakest: a failure (the same message whatever the order).
    const failures = variants
      .filter((variant) => variant.status === "failed")
      .map((variant) => variant.diagnostics.map((d) => d.message).join("; "));
    return failed([...new Set(failures)].sort().join("; "));
  }
  const [first] = variants;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (
    variants.some(
      (variant) =>
        !same(variant.symbols, first!.symbols) ||
        variant.links.length !== first!.links.length ||
        variant.links.some(
          (link, index) =>
            link.kind !== first!.links[index]!.kind ||
            !same(link.range, first!.links[index]!.range),
        ),
    )
  )
    return failed(
      `Equally ranked configs ${configs.join(", ")} produced different structure for this file`,
    );
  const names = configs.map((config) => config ?? "(inferred)");
  const links = first!.links.map((link, index) => {
    const datas = variants.map(
      (variant) =>
        (variant.links[index]!.data ?? {}) as { [key: string]: Json },
    );
    if (datas.every((data) => same(data, datas[0]))) return link;
    const keyed = (data: { [key: string]: Json }) =>
      ((data.targets ?? []) as unknown as TargetFact[])
        .map((t) => `${t.file}\0${t.key}`)
        .sort();
    const targets = new Map<string, TargetFact>();
    for (const data of datas)
      for (const target of (data.targets ?? []) as unknown as TargetFact[])
        targets.set(`${target.file}\0${target.key}`, { ...target });
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
    const merged: { [key: string]: Json } = {};
    const keys = [...new Set(datas.flatMap((data) => Object.keys(data)))]
      .filter((key) => !["targets", "reason", "assumes"].includes(key))
      .sort();
    const byProject: { [key: string]: Json } = {};
    for (const key of keys) {
      if (datas.every((data) => same(data[key], datas[0]![key]))) {
        if (datas[0]![key] !== undefined) merged[key] = datas[0]![key]!;
      } else
        datas.forEach((data, at) => {
          const entry = (byProject[names[at]!] ??= {}) as {
            [key: string]: Json;
          };
          if (data[key] !== undefined) entry[key] = data[key]!;
        });
    }
    if (Object.keys(byProject).length) merged.byProject = byProject;
    if (targets.size)
      merged.targets = [...targets.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, t]) => ({ ...t }));
    const allComplete = reasons.length === 0;
    if (!allComplete) {
      const everyVariantSame =
        sameTargets &&
        reasons.length === 1 &&
        datas.every((data) => data.reason === reasons[0]);
      merged.reason = everyVariantSame ? reasons[0]! : "ambiguous-project";
      if (!everyVariantSame) merged.tiedReasons = reasons;
    }
    if (!sameTargets || !allComplete) merged.projects = [...configs];
    if (datas.some((data) => data.assumes)) merged.assumes = "bundler-require";
    return { ...link, data: merged };
  });
  const diagnostics = [
    ...new Map(
      variants
        .flatMap((variant) => variant.diagnostics)
        .map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]),
    ).entries(),
  ]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, diagnostic]) => diagnostic);
  return {
    ...first!,
    status: variants.some((variant) => variant.status === "partial")
      ? "partial"
      : first!.status,
    diagnostics,
    links,
    data: (() => {
      // A tie has no single owner: `projects` lists them; `project` is absent.
      const merged: { [key: string]: Json } = {
        ...(first!.data as { [key: string]: Json }),
        projects: [...configs],
      };
      delete merged.project;
      return merged;
    })(),
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
    // Unchanged snapshot: stored facts came from a complete analysis of these exact
    // sources and contexts by this module version, so they are reused unparsed.
    if (
      !context.changedFiles.length &&
      !context.changedContextFiles.length &&
      files.every(
        (file) =>
          file.result.status !== "failed" &&
          (file.result.data as { analyzer?: unknown } | undefined)?.analyzer ===
            MODULE_VERSION,
      )
    ) {
      statistics.reused++;
      return files.map((file) => ({ path: file.path, result: file.result }));
    }
    const model = projectModel(files, context.contextFiles);
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
    /** Untrusted spans (syntax-error tails) and their neutral text, per file. */
    const neutralMemo = new Map<string, string | null>();
    for (const group of model.groups) {
      if (!group.roots.length) continue;
      const roots = () =>
        group.roots.filter((root) => !model.parseFailures.has(root.slice(1)));
      const normal = openSession(
        roots,
        group.options,
        () => model.host(group),
        model.parseFailures,
        captured,
      );
      const resolveModule = (specifier: string, from: string) => {
        const resolved = ts.resolveModuleName(
          specifier,
          toVirtual(from),
          group.options,
          normal.host,
        ).resolvedModule?.resolvedFileName;
        return resolved === undefined ? undefined : fromVirtual(resolved);
      };
      /**
       * What a captured target file is. `script` means only: analysed, no
       * syntax errors, and no ES or CommonJS exports. A file that failed to
       * parse or bind is `unavailable`; one with syntax errors and no exports
       * found is `partial` (its exports cannot be ruled out).
       */
      const moduleKind = (
        path: string,
      ): "module" | "script" | "partial" | "unavailable" => {
        if (model.parseFailures.has(path) || model.failures.has(path))
          return "unavailable";
        const source =
          normal.program.getSourceFile(toVirtual(path)) ??
          normal.host.getSourceFile(toVirtual(path), ts.ScriptTarget.Latest);
        if (!source) return "unavailable";
        const flags = source as ts.SourceFile & {
          externalModuleIndicator?: unknown;
          commonJsModuleIndicator?: unknown;
          parseDiagnostics?: readonly ts.Diagnostic[];
        };
        if (
          !!flags.externalModuleIndicator ||
          !!flags.commonJsModuleIndicator ||
          /(^|[^.\w$])(module\.exports|exports\.[\w$]+)\s*=/.test(source.text)
        )
          return "module";
        return flags.parseDiagnostics?.length ? "partial" : "script";
      };
      /** Extracts one file, rebuilding the session after checker overflows. */
      const extractWith = (
        session: Session,
        path: string,
        data: { [key: string]: Json },
        diagnostics: Diagnostic[],
        renamed: Renamed | undefined,
        openRule = true,
      ): ParseResult => {
        if (session.rebuilds > MAX_PROGRAM_REBUILDS)
          return failed(
            `The TypeScript checker overflowed so often in this project (${session.rebuilds} rebuilds) that the remaining files were not analysed`,
          );
        const skip = new Set<string>();
        for (let attempt = 0; ; attempt++) {
          try {
            const source = session.program.getSourceFile(toVirtual(path));
            if (!source)
              throw Error(
                session.failures.get(path) ??
                  "The compiler did not load this source",
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
                ...(renamed ? { renamed } : {}),
                resolveModule,
                skip,
                moduleKind,
                openRule,
              },
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
              // rebuild it, and answer that node without asking next time.
              skip.add(error.key);
              session.rebuild();
              continue;
            }
            // Never leave an overflowed checker in use for the next file.
            if (error instanceof CheckerLimit) session.rebuild();
            return failed(
              error instanceof CheckerLimit
                ? `The TypeScript checker exhausted its stack more than ${MAX_LIMIT_RETRIES} times in this file`
                : `TypeScript extraction failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      };
      const analysed: [string, ParseResult][] = [];
      for (const root of group.roots) {
        const path = root.slice(1);
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

      // ----- differential analysis (untrusted.ts) -----
      // Untrusted input anywhere in this program: syntax-error tails of
      // declarations, and free require/module read under the bundler
      // assumption. Each kind gets one neutral program over the same
      // snapshot; a link whose outcome differs there depends on it.
      const spanTexts = new Map<string, string>();
      const assumedTexts = new Map<string, string>();
      for (const source of normal.program.getSourceFiles()) {
        const path = fromVirtual(source.fileName);
        if (path === undefined || !captured.has(path)) continue;
        if (!neutralMemo.has(path)) {
          const errors = errorPositions(
            source,
            normal.program.getSyntacticDiagnostics(source),
          );
          const spans = untrustedSpans(source, errors);
          neutralMemo.set(
            path,
            spans.length ? neutralizeSpans(source, spans).text : null,
          );
        }
        const neutral = neutralMemo.get(path);
        if (neutral) spanTexts.set(path, neutral);
        const assumed = model.renames.get(path)?.assumed ?? [];
        if (assumed.length)
          assumedTexts.set(
            path,
            neutralizeAssumed(source.text, assumed, model.fresh.uncertain),
          );
      }
      const dependent = (texts: Map<string, string>, assumes: boolean) => {
        const marks = new Map<string, Set<number>>();
        if (!texts.size) return marks;
        statistics.neutralPrograms++;
        const failures = new Map(model.parseFailures);
        const neutral = openSession(
          () => group.roots.filter((root) => !failures.has(root.slice(1))),
          group.options,
          () => model.host(group, { texts, base: normal.host, failures }),
          failures,
          captured,
        );
        for (const [path, result] of analysed) {
          if (result.status === "failed") continue;
          const renamed = model.renames.get(path);
          // The assumed loader becomes an undeclared name (see rename.ts).
          const context: Renamed | undefined =
            assumes && renamed?.assumed.length
              ? {
                  ...renamed,
                  uncertain: [...renamed.uncertain, ...renamed.assumed],
                  assumed: [],
                }
              : renamed;
          // The neutral program answers only what the kept text supports.
          const other = extractWith(neutral, path, {}, [], context, false);
          statistics.neutralExtracted++;
          marks.set(path, differing(result, other));
        }
        return marks;
      };
      const partial = dependent(spanTexts, false);
      const assumed = dependent(assumedTexts, true);
      for (const [path, result] of analysed) {
        const p = partial.get(path);
        const a = assumed.get(path);
        deliver(path, p || a ? labelled(result, p, a) : result);
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
        | { targets?: TargetFact[]; reason?: string }
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
      if (ids.length === 1)
        resolutions.push({ linkId: link.id, targetId: ids[0]! });
      else if (ids.length >= 2)
        resolutions.push({ linkId: link.id, candidateIds: ids });
    }
    return resolutions;
  },
};
export default module;
