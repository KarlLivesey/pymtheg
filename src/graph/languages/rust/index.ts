// SPDX-License-Identifier: MIT
import type {
  AnalyzedFile,
  ContextFile,
  GraphFile,
  LanguageModule,
  LibraryTarget,
  LinkResolution,
} from "../../types.js";
import { crates } from "./cargo.js";
import type { AddedLink, GraphLink, GraphSymbol, Json } from "../../types.js";
import { rustRoute } from "./toolchain-route.js";
import { parseRust } from "./parse.js";
import { fileFacts } from "../../identity.js";
import { resolveRust, type RustDecisionScope } from "./resolve.js";
import { count } from "../../work.js";
import { macroScopeAssumption } from "./macro-scope.js";
import { runRustPhase } from "./phase-runner.js";
import { rustFingerprint } from "./incremental.js";
import { linkOrder, pathOrder, symbolOrder } from "./order.js";

const TARGET_HINT_LIMIT = 16;

type RustAnalysisInput = {
  projectId: string;
  files: readonly Pick<GraphFile, "path" | "module" | "result">[];
  contextFiles: Parameters<typeof crates>[0];
  /**
   * C-43: the toolchain route is on and answered. Links carrying `tc` (a
   * checkout symbol id from the strict join) are decided here.
   */
  toolchain?: { rustAnalyzer: string; configuration: string };
  /** C-36: annotate only these files; every file still supplies facts. */
  scope?: readonly string[];
};

/** Toolchain answers by outcome, and the first disagreements. */
export interface ToolchainDecisions {
  counts: Record<string, number>;
  disagreements: Json[];
}
const DISAGREEMENT_LIMIT = 50;
const beyondTest = (gates: readonly Json[] | undefined) =>
  (gates ?? []).some((gate) => gate !== "test");
/**
 * The reasons a source-only link records, one by one: the resolver joins
 * several with "; " (`uncertainty`). Every reason test reads this list,
 * never the joined string.
 */
export const uncertaintyReasons = (value: Json | undefined): string[] =>
  typeof value === "string" && value
    ? value
        .split(";")
        .map((reason) => reason.trim())
        .filter(Boolean)
    : [];
/** Link data that explains an open link; dropped when the toolchain decides it. */
const OPEN_DATA = [
  "uncertainty",
  "targets",
  "targetCount",
  "opaqueAttributes",
  "cause",
  "assumes",
];

const cargoInputs = (files: readonly ContextFile[]) =>
  files.map(({ path, status, text }) => ({ path, status, text }));

type Crates = ReadonlyMap<string, ReturnType<typeof crates>[number]>;
export const crateRoots = (
  contextFiles: Parameters<typeof crates>[0],
  files: readonly Pick<GraphFile, "path">[],
): Crates =>
  new Map(
    crates(contextFiles, new Set(files.map((f) => f.path))).map((c) => [
      c.root,
      c,
    ]),
  );

/** The facts the analysis pass starts from: the parse facts without earlier annotations. */
export function analysisInput(
  f: Pick<GraphFile, "path" | "result">,
  roots: Crates,
): Pick<GraphFile, "path" | "result"> {
  const crate = roots.get(f.path);
  const metadata = (f.result.data ?? {}) as Record<string, Json>;
  const contexts = (metadata.attributeContexts ?? []) as {
    sourceConditions?: string[];
  }[];
  const initialConditions = (d: Record<string, Json>): string[] => [
    ...new Set(
      metadata.hasSourceConditions
        ? (contexts[Number(d.attributeContext)]?.sourceConditions ?? [])
        : ((d.conditions ?? []) as string[]),
    ),
  ];
  return {
    path: f.path,
    result: {
      ...f.result,
      links: f.result.links.map((l) => {
        const {
          targets,
          targetCount,
          uncertainty,
          assumes,
          cause,
          opaqueAttributes,
          receiverTyping,
          // C-43: a previous run's toolchain record and outcome are decided
          // again (and re-added last, as in a cold run, so stored rows
          // compare byte for byte).
          toolchain: _toolchain,
          toolchainOutcome: _toolchainOutcome,
          // D24: a previous run's library offer too; the resolve phase
          // applies any offer it finds, so a stale one must not survive a
          // run that is partial, failed or off.
          toolchainLibrary: _toolchainLibrary,
          ...rest
        } = (l.data ?? {}) as Record<string, Json>;
        void _toolchain;
        void _toolchainOutcome;
        void _toolchainLibrary;
        return {
          ...l,
          data: {
            ...rest,
            conditions: initialConditions(rest),
          } as Record<string, Json>,
        };
      }),
      symbols: f.result.symbols.map((s) => {
        const { underOpaqueAttribute, opaqueAttributes, ...rest } = (s.data ??
          {}) as Record<string, Json>;
        return {
          ...s,
          data: {
            ...rest,
            conditions: initialConditions(rest),
            ...(s.key === "file"
              ? {
                  unitKind: crate ? "crate" : "module",
                  crateName: crate?.name ?? "",
                  targetKind: crate?.kind ?? "",
                  edition: crate?.edition ?? null,
                  manifest: crate?.manifest ?? "",
                  workspace: crate?.workspace ?? null,
                }
              : {}),
          } as Record<string, Json>,
        };
      }),
    },
  };
}

type RustRecord = Pick<GraphFile, "path" | "module" | "result">;

/**
 * The resolve phase's input, built from stored file records exactly as the
 * store presents it: every Rust symbol and parsed link, unresolved. The resolve
 * phase orders them by path and position (C-24).
 */
function resolutionInput(
  projectId: string,
  records: readonly RustRecord[],
  contextFiles: Parameters<typeof crates>[0],
) {
  const rust = records.filter((file) => file.module === "rust");
  const facts = rust.map((file) => fileFacts(projectId, file));
  return {
    projectId,
    contextFiles,
    files: rust.map(({ path, module, result }) => {
      const { status, diagnostics, data } = result;
      return {
        path,
        module,
        result: {
          status,
          diagnostics,
          ...(data === undefined ? {} : { data }),
        },
      };
    }),
    symbols: facts.flatMap((fact) => fact.symbols),
    links: facts.flatMap((fact) => fact.links),
  };
}

type ScopedRequest = RustAnalysisInput & {
  scope: readonly string[];
  /** The stored record of every edited file, before the edit. */
  previous: readonly RustRecord[];
};

/**
 * C-36: why the edited files' links cannot be re-decided alone, or undefined
 * with their analyzed results when they can. Every other file keeps its
 * stored annotations and decisions only when (1) each edited file is clean
 * before and after, (2) its surface is unchanged, before and after analysis,
 * and (3) no lookup cut was met while deciding its links, with its new facts
 * and with its old ones, in the analysis and the resolution pass. Answers
 * met without a cut do not depend on which lookups ran before them, so the
 * edited file's decisions equal a cold index's, and adding or removing its
 * lookups cannot change another file's. When all of an edited file's facts,
 * before and after analysis, are the same up to offset ranks, its old lookups
 * are its new ones, and the new check stands for both.
 */
function scopedAnalysis(request: ScopedRequest):
  | { reason: string }
  | {
      files: Pick<GraphFile, "path" | "result">[];
      cuts: number;
      isomorphic: boolean;
    } {
  const { projectId, files, contextFiles, scope, previous } = request;
  const before = new Map(previous.map((file) => [file.path, file]));
  const current = new Map(files.map((file) => [file.path, file]));
  const roots = crateRoots(contextFiles, files);
  // Isomorphic: every fact of the file is the same up to offset ranks, so
  // its old and new lookups are the same and one check covers both.
  let isomorphic = true;
  for (const path of scope) {
    const old = before.get(path),
      now = current.get(path);
    if (!old || !now) return { reason: "previous-record" };
    if (old.result.status !== "clean" || now.result.status !== "clean")
      return { reason: "status" };
    const oldInput = analysisInput(old, roots).result,
      newInput = analysisInput(now, roots).result;
    if (
      rustFingerprint(oldInput, "surface") !==
      rustFingerprint(newInput, "surface")
    )
      return { reason: "surface" };
    isomorphic &&=
      rustFingerprint(oldInput, "all") === rustFingerprint(newInput, "all");
  }
  const restored = files.map((file) => before.get(file.path) ?? file);
  const analysis = rustPhases.analyze({
    projectId,
    files,
    contextFiles,
    scope,
  });
  if (analysis.decisionCuts) return { reason: "lookup-cut" };
  if (
    !isomorphic &&
    rustPhases.analyze({ projectId, files: restored, contextFiles, scope })
      .decisionCuts
  )
    return { reason: "lookup-cut" };
  const analyzed = new Map(analysis.files.map((file) => [file.path, file]));
  for (const path of scope) {
    const now = analyzed.get(path)!.result,
      old = before.get(path)!.result;
    if (rustFingerprint(now, "surface") !== rustFingerprint(old, "surface"))
      return { reason: "analyzed-surface" };
    isomorphic &&= rustFingerprint(now, "all") === rustFingerprint(old, "all");
  }
  const after = files.map((file) => {
    const result = analyzed.get(file.path)?.result;
    return result ? { ...file, result } : file;
  });
  for (const records of isomorphic ? [after] : [after, restored])
    if (
      rustPhases.resolve({
        ...resolutionInput(projectId, records, contextFiles),
        scope,
      }).decisionCuts
    )
      return { reason: "lookup-cut" };
  return { files: analysis.files, cuts: analysis.cuts, isomorphic };
}

/**
 * C-43: decide each link the strict join answered, against the source-only
 * answer and the cfg conditions this analysis found:
 * - a link under a cfg condition other than `test` takes no answer (the
 *   toolchain sees one configuration);
 * - an answer whose target is under such a condition (its own, or that of
 *   a module it is declared in, or a module no declaration reaches), or
 *   shares its kind and identity with a symbol under such a condition (a cfg
 *   variant: two items of one path can only both exist under cfg), takes no
 *   answer, and a candidate set holding such a symbol stays a candidate set;
 * - a link whose source-only answer records conditional candidates
 *   (`conditional-name-may-be-absent`, or twins among its targets) is only
 *   ever confirmed, never narrowed;
 * - a source-only definite target that differs is kept, and counted;
 * - a source-only library answer is kept;
 * - a candidate set holding the answer, or an unresolved link, becomes
 *   definite. The answer is recorded on the link (`toolchain`), and the
 *   resolve phase applies it where the source-only answer is still open.
 */
function decideToolchain(
  updated: readonly { path: string }[],
  facts: readonly { symbols: GraphSymbol[]; links: GraphLink[] }[],
  byPath: Map<string, { result: AnalyzedFile["result"] }>,
  resolutions: Map<string, LinkResolution>,
  toolchain: NonNullable<RustAnalysisInput["toolchain"]>,
  moduleGated: ReadonlySet<string> = new Set(),
  moduleTwin: ReadonlySet<string> = new Set(),
): ToolchainDecisions {
  const counts: Record<string, number> = {};
  const disagreements: Json[] = [];
  const bump = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  /**
   * D24: a library answer is offered here and decided in the resolve phase.
   * The analysis cannot see source-only library targets: the resolver proves
   * those in the resolve phase only. Here only the cfg-link gate applies; an
   * answer that passes it is recorded as `toolchainLibrary` (the key, the
   * written path, the run), which claims nothing on its own. The resolve
   * phase applies it where the final source-only answer is still open.
   */
  const decideLibrary = (
    l: AnalyzedFile["result"]["links"][number],
    data: Record<string, Json>,
  ) => {
    const { tcl, ...rest } = data;
    if (beyondTest(rest.conditions as Json[] | undefined)) {
      bump("library:withheld:cfg-link");
      return {
        ...l,
        data: { ...rest, toolchainOutcome: "library:withheld:cfg-link" },
      };
    }
    bump("library:offered");
    return {
      ...l,
      data: {
        ...rest,
        toolchainLibrary: {
          library: tcl,
          // The path the code writes, beside the declaring path the key uses.
          written: l.targetName,
          rustAnalyzer: toolchain.rustAnalyzer,
          configuration: toolchain.configuration,
        },
      } as Record<string, Json>,
    };
  };
  // Final symbol conditions, and how many symbols share each identity.
  const gated = new Set<string>();
  /** Symbols under their own cfg (the rest of `gated` is module twins). */
  const ownGated = new Set<string>();
  const identityOf = new Map<string, string>();
  /** Identities (kind and in-file path) some gated symbol has. */
  const gatedIdentities = new Set<string>();
  updated.forEach((f, i) => {
    const symbols = byPath.get(f.path)?.result.symbols;
    if (!symbols) return;
    symbols.forEach((symbol, j) => {
      const id = facts[i]!.symbols[j]!.id;
      const data = (symbol.data ?? {}) as Record<string, Json>;
      const identity = `${symbol.kind}\u0000${symbol.identity}`;
      identityOf.set(id, identity);
      // Its own cfg, or a module chain with a twin of its path or with
      // conditions the source cannot see (review B1:
      // `#[cfg(unix)] #[path = "sys/unix.rs"] mod imp;` and its twin). A
      // module merely under cfg (a default feature) has no other item at the
      // path, so an answer into it stands (second review, narrowed).
      if (beyondTest(data.conditions as Json[] | undefined)) ownGated.add(id);
      if (
        beyondTest(data.conditions as Json[] | undefined) ||
        moduleTwin.has(id)
      ) {
        gated.add(id);
        gatedIdentities.add(identity);
      }
    });
  });
  const variant = (id: string) =>
    gated.has(id) || gatedIdentities.has(identityOf.get(id) ?? "");
  /** For candidate sets: any cfg on the item or its module chain. */
  const conditional = (id: string) => variant(id) || moduleGated.has(id);
  /** Two candidates of one kind and in-file path: cfg twins. */
  const twins = (ids: readonly string[]) =>
    new Set(ids.map((c) => identityOf.get(c) ?? c)).size < ids.length;
  // Fourth and fifth reviews: a name defined more than once under cfg in one
  // file selects between items the toolchain sees only one of:
  // - `use` items (`#[cfg(feature = "fast")] pub use z_fmt::ZGrayV08 as
  //   ZGray;` beside a `not` twin naming ZGrayV09; `#[cfg(test)] use
  //   mdb::MockDb as Db;` beside `#[cfg(not(test))] use rdb::RealDb as Db;`);
  // - `type` aliases (`#[cfg(feature = "fast")] pub type Backend = FastB;`
  //   beside a `not` twin naming SlowB);
  // - function twins, through their return types (`#[cfg(feature = "fast")]
  //   fn mk() -> FastT` beside a `not` twin returning SlowT).
  // `test` counts here: a test double is a real second definition. A name
  // with one definition (ordinary `#[cfg(test)] mod tests` code) selects
  // nothing. The items the definitions do not all name are cfg-selected: an
  // answer into one, or into an item it holds (`Backend::b_new()` and
  // `h.inner.run2()` reaching `FastB`'s methods), may confirm source-only's
  // own definite target but never narrows or decides anything else.
  // Places are file and in-file path, so members are found by prefix.
  const placeOf = new Map<string, string>();
  updated.forEach((f, i) => {
    byPath.get(f.path)?.result.symbols.forEach((symbol, j) => {
      placeOf.set(
        facts[i]!.symbols[j]!.id,
        `${f.path}\u0000${symbol.identity}`,
      );
    });
  });
  const conditioned = (data: Record<string, Json>) =>
    ((data.conditions ?? []) as Json[]).length > 0;
  const lastSegment = (name: string) =>
    name.split("::").at(-1)!.replace(/<.*$/, "");
  const targetsOf = (linkId: string): string[] => {
    const r = resolutions.get(linkId);
    return [
      ...(r?.targetId ? [r.targetId] : []),
      ...(r?.candidateIds ?? []),
    ].flatMap((id) => {
      const place = placeOf.get(id);
      return place === undefined ? [] : [place];
    });
  };
  /** Per selecting name (file and in-file path): each definition's items. */
  const definitions = new Map<string, Set<string>[]>();
  const define = (key: string, items: readonly string[]) => {
    const list = definitions.get(key) ?? [];
    list.push(new Set(items));
    definitions.set(key, list);
  };
  updated.forEach((f, i) => {
    const result = byPath.get(f.path)?.result;
    if (!result) return;
    // The `types` links, for the types aliases and return types name.
    const typeLinks: {
      name: string;
      id: string;
      start: number;
      end: number;
    }[] = [];
    result.links.forEach((l, j) => {
      const link = facts[i]!.links[j]!;
      const data = (l.data ?? {}) as Record<string, Json>;
      if (l.kind === "imports" && conditioned(data)) {
        const name =
          (typeof data.alias === "string" && data.alias) ||
          lastSegment(l.targetName);
        const scope = typeof data.scope === "string" ? data.scope : "";
        define(
          `${f.path}\u0000${scope ? `${scope}::` : ""}${name}`,
          targetsOf(link.id),
        );
      }
      if (l.kind === "types")
        typeLinks.push({
          name: lastSegment(l.targetName),
          id: link.id,
          start: l.range.start,
          end: l.range.end,
        });
    });
    result.symbols.forEach((symbol) => {
      const data = (symbol.data ?? {}) as Record<string, Json>;
      if (!conditioned(data) || symbol.identity.startsWith("impl ")) return;
      const written =
        symbol.kind === "type" && typeof data.aliasType === "string"
          ? data.aliasType
          : symbol.kind === "function" && typeof data.returnType === "string"
            ? data.returnType
            : undefined;
      if (!written) return;
      const words = new Set(written.match(/\w+/g) ?? []);
      define(
        `${f.path}\u0000${symbol.kind === "function" ? "fn " : ""}${symbol.identity}`,
        typeLinks
          .filter(
            (t) =>
              t.start >= symbol.range.start &&
              t.end <= symbol.range.end &&
              words.has(t.name),
          )
          .flatMap((t) => targetsOf(t.id)),
      );
    });
  });
  const selectedPlaces = new Set<string>();
  for (const list of definitions.values()) {
    if (list.length < 2) continue;
    for (const items of list)
      for (const place of items)
        if (!list.every((other) => other.has(place))) selectedPlaces.add(place);
  }
  /** An item cfg selects through a name, or an item inside one. */
  const cfgSelected = (id: string): boolean => {
    const place = placeOf.get(id);
    if (place === undefined || selectedPlaces.size === 0) return false;
    const [file, identity] = place.split("\u0000") as [string, string];
    // A method's identity is `impl Type::m` or `impl Trait for Type<T>::m`;
    // the item it is in is `Type`.
    const owned = identity.startsWith("impl ")
      ? identity.slice(5).split(" for ").at(-1)!
      : identity;
    const segments = owned
      .split("::")
      .map((segment) => segment.replace(/<.*$/, ""));
    for (let n = 1; n <= segments.length; n++)
      if (selectedPlaces.has(`${file}\u0000${segments.slice(0, n).join("::")}`))
        return true;
    return false;
  };
  updated.forEach((f, i) => {
    const a = byPath.get(f.path);
    if (!a) return;
    a.result.links = a.result.links.map((l, j) => {
      const data = (l.data ?? {}) as Record<string, Json>;
      if ("tcl" in data) return decideLibrary(l, data);
      if (!("tc" in data)) return l;
      const { tc, ...rest } = data;
      const target = String(tc);
      const id = facts[i]!.links[j]!.id;
      // Every answer not applied records why on the link
      // (`toolchainOutcome`), so the measurement counts each guard exactly.
      const kept = (why: string) => {
        bump(why);
        return { ...l, data: { ...rest, toolchainOutcome: why } };
      };
      if (beyondTest(rest.conditions as Json[] | undefined))
        return kept("withheld:cfg-link");
      if (!identityOf.has(target)) return kept("withheld:no-symbol");
      if (variant(target))
        return kept(
          moduleTwin.has(target) && !ownGated.has(target)
            ? "withheld:module-twin"
            : "withheld:cfg-variant",
        );
      const r = resolutions.get(id);
      // An item cfg selects through a name: confirm only (see above).
      if (r?.targetId !== target && cfgSelected(target))
        return kept("withheld:cfg-selected");
      // Review B1: a link whose source-only answer records conditional
      // candidates (a name that cfg may remove, or twins under cfg) is never
      // narrowed by the one configuration the toolchain sees; it may only be
      // confirmed.
      // Reasons are joined with "; " when there are several. A name cfg may
      // remove allows only the one target source-only recorded (taking it
      // narrows nothing); a set of several candidates holding a conditional
      // one or cfg twins is never narrowed.
      const candidates = (rest.targets ?? []) as string[];
      const reasons = uncertaintyReasons(rest.uncertainty);
      const single = candidates.length === 1 && candidates[0] === target;
      const conditionalSet = (ids: readonly string[]) =>
        ids.length > 1 && (ids.some(conditional) || twins(ids));
      if (
        !r?.targetId &&
        ((reasons.includes("conditional-name-may-be-absent") && !single) ||
          conditionalSet(candidates) ||
          conditionalSet(r?.candidateIds ?? []))
      )
        return kept("withheld:conditional-candidates");
      let from: "definite" | "candidates" | "unresolved";
      if (r?.targetId) {
        if (r.targetId !== target) {
          if (disagreements.length < DISAGREEMENT_LIMIT)
            disagreements.push({
              file: f.path,
              range: [l.range.start, l.range.end],
              kind: l.kind,
              name: l.targetName,
              sourceOnly: r.targetId,
              toolchain: target,
            });
          return kept("kept:source-only-differs");
        }
        from = "definite";
      } else if (r?.library) return kept("kept:source-only-library");
      else if (r?.candidateIds) {
        if (!r.candidateIds.includes(target))
          return kept("kept:outside-candidate-set");
        if (r.libraries?.length || r.candidateIds.some(variant))
          return kept("withheld:cfg-variant");
        from = "candidates";
      } else from = "unresolved";
      bump(`definite:${from}`);
      // The open link's data stays until the stored link takes the answer:
      // the record lists what then goes (`clears`), and the link decider
      // removes it only then. A link whose source-only answer is kept in
      // the resolve phase keeps its route-off data exactly (fifth review).
      const decided: Record<string, Json> = { ...rest };
      const clears =
        from === "definite" ? [] : OPEN_DATA.filter((key) => key in rest);
      decided.toolchain = {
        origin: "toolchain",
        rustAnalyzer: toolchain.rustAnalyzer,
        configuration: toolchain.configuration,
        upgrade: "definite",
        from,
        ...(from === "definite" ? {} : { target }),
        ...(clears.length ? { clears } : {}),
      };
      return { ...l, data: decided };
    });
  });
  return { counts, disagreements };
}

export const rustPhases = {
  analyzeScoped(request: ScopedRequest) {
    const scoped = scopedAnalysis(request);
    if ("files" in scoped) return { scoped: true as const, ...scoped };
    const { scope: _scope, previous: _previous, ...full } = request;
    return {
      scoped: false as const,
      reason: scoped.reason,
      ...rustPhases.analyze(full),
    };
  },
  analyze({
    projectId,
    files: listed,
    contextFiles: contexts,
    toolchain,
    scope,
  }: RustAnalysisInput): {
    files: AnalyzedFile[];
    toolchain?: ToolchainDecisions;
    cuts: number;
    decisionCuts: number;
  } {
    const files = pathOrder(listed),
      contextFiles = pathOrder(contexts);
    const inScope = scope ? new Set(scope) : undefined;
    const roots = crateRoots(contextFiles, files);
    const analyzed = files
      .filter((f) => f.result.status !== "failed")
      .map((f) => analysisInput(f, roots));
    const byPath = new Map(analyzed.map((a) => [a.path, a]));
    const updated = files.map((f) => ({
      ...f,
      result: byPath.get(f.path)?.result ?? f.result,
    }));
    const facts = updated.map((f) => fileFacts(projectId, f));
    const unknown = new Map<
      string,
      {
        targets?: string[];
        targetCount?: number;
        reason: string;
        files?: string[] | undefined;
        attributes?: string[] | undefined;
      }
    >();
    const presence = new Map<string, string[]>();
    const conditions = new Map<string, string[]>();
    const assumedScope = new Set<string>();
    const notes = new Map<string, Record<string, Json>>();
    // C-43 review: symbols declared in a cfg-gated module (or a module no
    // declaration reaches), for the toolchain's cfg-variant guard only.
    const moduleGated = new Set<string>();
    // Of those, the ones whose module path has a twin at some level of the
    // chain, or whose module conditions cannot be seen.
    const moduleTwin = new Set<string>();
    const decide: RustDecisionScope = inScope ? { files: inScope } : {};
    const resolutions = resolveRust(
      {
        projectId,
        files: updated,
        contextFiles,
        symbols: symbolOrder(facts.flatMap((f) => f.symbols)),
        links: linkOrder(facts.flatMap((f) => f.links)),
      },
      (l, targets, reason, files, attributes) =>
        unknown.set(l.id, {
          ...(reason === "invalid-code"
            ? {}
            : targets.length > TARGET_HINT_LIMIT
              ? { targetCount: targets.length }
              : { targets: targets.map((t) => t.id).sort() }),
          reason:
            reason !== "invalid-code" && targets.length > TARGET_HINT_LIMIT
              ? reason + "; too-many-targets"
              : reason,
          files: files ? [...new Set(files)].sort() : undefined,
          attributes: attributes?.length
            ? [...new Set(attributes)].sort()
            : undefined,
        }),
      (symbol, attributes, gates, modules) => {
        presence.set(symbol.id, attributes);
        conditions.set(symbol.id, gates);
        if (beyondTest(modules)) moduleGated.add(symbol.id);
        if (
          modules.includes("?module-twin") ||
          modules.includes("?module-not-declared")
        )
          moduleTwin.add(symbol.id);
      },
      (link, gates) => conditions.set(link.id, gates),
      undefined,
      undefined,
      (link, extra) => notes.set(link.id, extra),
      (link, assumed) => {
        unknown.delete(link.id);
        if (assumed) assumedScope.add(link.id);
      },
      undefined,
      decide,
    );
    for (let i = 0; i < updated.length; i++) {
      const f = updated[i]!,
        a = inScope && !inScope.has(f.path) ? undefined : byPath.get(f.path);
      if (a)
        a.result.symbols = a.result.symbols.map((symbol, j) => {
          const id = facts[i]!.symbols[j]!.id,
            attributes = presence.get(id);
          symbol = {
            ...symbol,
            data: {
              ...(symbol.data as Record<string, Json>),
              conditions:
                conditions.get(id) ??
                (symbol.data as Record<string, Json>).conditions ??
                [],
            },
          };
          return attributes?.length
            ? {
                ...symbol,
                data: {
                  ...(symbol.data as Record<string, Json>),
                  underOpaqueAttribute: true,
                  opaqueAttributes: attributes,
                },
              }
            : symbol;
        });
      if (a)
        a.result.links = a.result.links.map((l, j) => {
          const id = facts[i]!.links[j]!.id,
            u = unknown.get(id),
            gates = conditions.get(id),
            note = notes.get(id);
          if (gates)
            l = {
              ...l,
              data: { ...(l.data as Record<string, Json>), conditions: gates },
            };
          if (note)
            l = {
              ...l,
              data: { ...(l.data as Record<string, Json>), ...note },
            };
          if (assumedScope.has(id))
            l = {
              ...l,
              data: {
                ...(l.data as Record<string, Json>),
                assumes: [macroScopeAssumption],
              },
            };
          return u
            ? {
                ...l,
                data: {
                  ...(l.data as Record<string, Json>),
                  ...(u.reason === "invalid-code"
                    ? { cause: { files: u.files ?? [] } }
                    : u.targetCount !== undefined
                      ? { targetCount: u.targetCount }
                      : { targets: u.targets ?? [] }),
                  uncertainty: u.reason,
                  ...(u.reason !== "invalid-code" && u.attributes?.length
                    ? { opaqueAttributes: u.attributes }
                    : {}),
                },
              }
            : l;
        });
    }
    return {
      files: inScope ? analyzed.filter((a) => inScope.has(a.path)) : analyzed,
      cuts: decide.runCuts ?? 0,
      decisionCuts: decide.decisionCuts ?? 0,
      ...(toolchain
        ? {
            toolchain: decideToolchain(
              updated,
              facts,
              byPath,
              new Map(resolutions.map((r) => [r.linkId, r])),
              toolchain,
              moduleGated,
              moduleTwin,
            ),
          }
        : {}),
    };
  },
  resolve(
    input: Parameters<typeof resolveRust>[0] & { scope?: readonly string[] },
  ) {
    const ctx = {
      ...input,
      files: pathOrder(input.files),
      contextFiles: pathOrder(input.contextFiles),
      symbols: symbolOrder(input.symbols),
      links: linkOrder(input.links),
    };
    const links: AddedLink[] = [];
    const decide: RustDecisionScope = ctx.scope
      ? { files: new Set(ctx.scope) }
      : {};
    let resolutions = resolveRust(
      ctx,
      undefined,
      undefined,
      undefined,
      (l) => links.push(l),
      undefined,
      undefined,
      undefined,
      undefined,
      decide,
    );
    // C-43: the toolchain's answer, where the source-only one is still open:
    // a checkout target, or (D24) a library target.
    const upgraded = new Map<string, LinkResolution>();
    for (const link of ctx.links) {
      const record = (link.data as { toolchain?: Record<string, Json> })
        ?.toolchain;
      if (record?.origin !== "toolchain" || record.from === "definite")
        continue;
      if (typeof record.target === "string")
        upgraded.set(link.id, { linkId: link.id, targetId: record.target });
    }
    // D24: library answers the analysis offered, applied where the final
    // source-only answer is open: unresolved, or a candidate set that already
    // holds the identical library target. A source-only checkout or library
    // target stays. The stored target's evidence records the decision.
    const offered = new Map<string, LibraryTarget>();
    for (const link of ctx.links) {
      const offer = (
        link.data as {
          toolchainLibrary?: { library?: Omit<LibraryTarget, "evidence"> };
        }
      )?.toolchainLibrary?.library;
      if (offer)
        offered.set(link.id, {
          ...offer,
          evidence: "toolchain-declaring-path",
        });
    }
    if (offered.size) {
      const keyOf = (t: { ecosystem: string; unit: string; symbol?: string }) =>
        `${t.ecosystem}\u0000${t.unit}\u0000${t.symbol ?? ""}`;
      const seen = new Set<string>();
      resolutions = resolutions.map((r) => {
        const library = offered.get(r.linkId);
        if (!library) return r;
        seen.add(r.linkId);
        if (r.targetId || r.library) return r;
        if (r.candidateIds)
          return (r.libraries ?? []).some((t) => keyOf(t) === keyOf(library))
            ? { linkId: r.linkId, library }
            : r;
        return { linkId: r.linkId, library };
      });
      for (const [linkId, library] of offered)
        if (!seen.has(linkId)) resolutions.push({ linkId, library });
    }
    if (upgraded.size) {
      const seen = new Set<string>();
      resolutions = resolutions.map((r) => {
        const answer = upgraded.get(r.linkId);
        if (answer === undefined) return r;
        seen.add(r.linkId);
        return r.candidateIds || (!r.targetId && !r.library) ? answer : r;
      });
      for (const [linkId, answer] of upgraded)
        if (!seen.has(linkId)) resolutions.push(answer);
    }
    return {
      result: {
        resolutions,
        links,
        missingLinkReason: "analysis-resolution-disagreement",
      },
      cuts: decide.runCuts ?? 0,
      decisionCuts: decide.decisionCuts ?? 0,
    };
  },
};

const rust: LanguageModule = {
  id: "rust",
  version: "48",
  extensions: [".rs"],
  contextFiles: [
    "Cargo.toml",
    "Cargo.lock",
    "**/.cargo/config.toml",
    "**/.cargo/config",
  ],
  incrementalAnalysis: true,
  parse: parseRust,
  async analyze({
    projectId,
    files,
    contextFiles,
    signal,
    previousFiles,
    changedContextFiles,
    toolchain,
  }) {
    if (!files.length) return [];
    // C-43: the opt-in toolchain route's answers, joined to the parsed links.
    const route = toolchain
      ? await rustRoute(toolchain, projectId, files, contextFiles)
      : undefined;
    const context: RustAnalysisInput = {
      projectId,
      files: files.map(({ path, module, result }) => {
        const answers = route?.answers.get(path);
        const libraries = route?.libraryAnswers.get(path);
        return {
          path,
          module,
          result:
            answers || libraries
              ? {
                  ...result,
                  links: result.links.map((link, index) =>
                    answers?.has(index)
                      ? {
                          ...link,
                          data: {
                            ...((link.data ?? {}) as Record<string, Json>),
                            tc: answers.get(index)!,
                          },
                        }
                      : libraries?.has(index)
                        ? {
                            ...link,
                            data: {
                              ...((link.data ?? {}) as Record<string, Json>),
                              // D24: the toolchain's library answer.
                              tcl: libraries.get(index)! as unknown as Json,
                            },
                          }
                        : link,
                  ),
                }
              : result,
        };
      }),
      contextFiles: cargoInputs(contextFiles),
      ...(route
        ? {
            toolchain: {
              rustAnalyzer: route.rustAnalyzer,
              configuration: route.configuration,
            },
          }
        : {}),
    };
    // A changed manifest, lockfile or Cargo configuration, and any edit the
    // indexer cannot compare with a previous record, use the full pass. So
    // does the toolchain route (C-27, C-43): its answers come from a full
    // rust-analyzer run of the snapshot.
    if (!toolchain && previousFiles?.size && !changedContextFiles.length) {
      const request = {
        ...context,
        scope: [...previousFiles.keys()],
        previous: [...previousFiles.values()].map(
          ({ path, module, result }) => ({ path, module, result }),
        ),
      };
      const output = signal
        ? await runRustPhase(
            { phase: "analyzeScoped", context: request },
            signal,
          )
        : rustPhases.analyzeScoped(request);
      count("analyze.rust.lookupCuts", output.cuts);
      if (output.scoped) {
        count("analyze.rust.scopedFiles", request.scope.length);
        if (output.isomorphic) count("analyze.rust.isomorphicScopes");
        return { files: output.files, resolutionFiles: request.scope };
      }
      count(`analyze.rust.fullPass.${output.reason}`);
      return output.files;
    }
    const output = signal
      ? await runRustPhase({ phase: "analyze", context }, signal)
      : rustPhases.analyze(context);
    count("analyze.rust.lookupCuts", output.cuts);
    if (toolchain && output.toolchain)
      toolchain.note({
        status: "merged",
        decided: output.toolchain.counts,
        disagreements: output.toolchain.disagreements,
      });
    return output.files;
  },
  async resolve({
    projectId,
    files,
    contextFiles,
    symbols,
    links,
    signal,
    resolutionFiles,
  }) {
    if (!links.length) return [];
    if (resolutionFiles) {
      // The scoped analysis proved these decisions with this exact input:
      // every stored record's links and symbols, ordered by the phase.
      // Without declared scoped link kinds the indexer passes whole records.
      const records = files as readonly Partial<RustRecord>[];
      if (records.some((file) => !file.result?.symbols))
        throw Error("Rust scoped resolution needs whole file records");
      const input = {
        ...resolutionInput(
          projectId,
          (records as readonly RustRecord[]).map(
            ({ path, module, result }) => ({ path, module, result }),
          ),
          cargoInputs(contextFiles),
        ),
        scope: [...resolutionFiles],
      };
      const output = signal
        ? await runRustPhase({ phase: "resolve", context: input }, signal)
        : rustPhases.resolve(input);
      count("resolve.rust.decisionFiles", resolutionFiles.size);
      count("resolve.rust.lookupCuts", output.cuts);
      if (output.decisionCuts)
        throw Error("Rust scoped resolution met a lookup cycle after analysis");
      return output.result;
    }
    // Parsed drafts and raw source text are not consumed by the resolver.
    const input = {
      projectId,
      contextFiles: cargoInputs(contextFiles),
      files: files
        .filter((file) => file.module === "rust")
        .map(({ path, module, result }) => {
          const { status, diagnostics, data } = result;
          return {
            path,
            module,
            result: {
              status,
              diagnostics,
              ...(data === undefined ? {} : { data }),
            },
          };
        }),
      symbols: symbols.filter((symbol) => symbol.module === "rust"),
      links,
    };
    const output = signal
      ? await runRustPhase({ phase: "resolve", context: input }, signal)
      : rustPhases.resolve(input);
    count("resolve.rust.decisionFiles", input.files.length);
    count("resolve.rust.lookupCuts", output.cuts);
    return output.result;
  },
};
export default rust;
