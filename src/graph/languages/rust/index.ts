// SPDX-License-Identifier: MIT
import type {
  AnalyzedFile,
  ContextFile,
  GraphFile,
  LanguageModule,
  LinkResolution,
} from "../../types.js";
import { crates } from "./cargo.js";
import { implies } from "./cfg.js";
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
  toolchain?: {
    rustAnalyzer: string;
    configuration: string;
    /** Design B: each enclosing function's trace (see toolchain-join.ts). */
    functionTraces?: Record<string, { entries: Json[]; at: number[] }>;
  };
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
          ...rest
        } = (l.data ?? {}) as Record<string, Json>;
        void _toolchain;
        void _toolchainOutcome;
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
 * C-43: decide each link the strict join answered (design B, deny by
 * default). The toolchain sees one configuration. A definite answer is wrong
 * only if the same written site resolves differently in another
 * configuration where it compiles, and a site's resolution depends only on
 * the bindings it passes through. So an answer decides only when no binding
 * on its trace is selected:
 * - a selected binding is anything written under a cfg attribute (`test`
 *   included) that the site's own conditions do not imply, itself or through
 *   an enclosing item, module, impl, trait, block or file; or emitted by a
 *   macro whose expansion source-only does not read;
 * - a path's trace is each segment's binding as rust-analyzer resolved it,
 *   and the `use` hops a segment may pass through;
 * - a receiver-typed link's trace is everything named in the enclosing
 *   function up to the site, and also any method or field of that name, trait
 *   `use`, cfg-gated field or `Deref`/`Index` impl the lookup could meet;
 * - an item of another crate than `std`, `core` or `alloc` on the trace,
 *   or a trace that cannot be completed, leaves the link confirm-only.
 * Also: a link under a cfg other than `test` takes no answer; a name an
 * opaque item may shadow is confirm-only; an import of a name bound in more
 * than one namespace takes no answer. Then a source-only definite target that
 * differs is kept and counted, a source-only library answer is kept, and a
 * candidate set holding the answer, or an unresolved link, becomes definite,
 * recorded on the link (`toolchain`) for the resolve phase to apply.
 */
function decideToolchain(
  updated: readonly { path: string }[],
  facts: readonly { symbols: GraphSymbol[]; links: GraphLink[] }[],
  byPath: Map<string, { result: AnalyzedFile["result"] }>,
  resolutions: Map<string, LinkResolution>,
  toolchain: NonNullable<RustAnalysisInput["toolchain"]>,
  moduleGated: ReadonlySet<string> = new Set(),
  moduleTwin: ReadonlySet<string> = new Set(),
  /** Each symbol's module-chain conditions (`test` included). */
  moduleChain: ReadonlyMap<string, string[]> = new Map(),
): ToolchainDecisions {
  void moduleGated;
  void moduleTwin;
  const counts: Record<string, number> = {};
  const disagreements: Json[] = [];
  const bump = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  // ---- Design B: the facts the rule reads.
  const identityOf = new Map<string, string>();
  const placeOf = new Map<string, string>();
  const symbolFact = new Map<
    string,
    {
      file: string;
      kind: string;
      name: string;
      identity: string;
      start: number;
      end: number;
      conditions: string[];
      opaque: boolean;
      gatedFields: string[];
      /** Named fields (not cfg-gated): name and declared type text. */
      fieldTypes: Map<string, string>;
    }
  >();
  updated.forEach((f, i) => {
    byPath.get(f.path)?.result.symbols.forEach((symbol, j) => {
      const id = facts[i]!.symbols[j]!.id;
      const data = (symbol.data ?? {}) as Record<string, Json>;
      identityOf.set(id, `${symbol.kind}\u0000${symbol.identity}`);
      placeOf.set(id, `${f.path}\u0000${symbol.identity}`);
      symbolFact.set(id, {
        file: f.path,
        kind: symbol.kind,
        name: symbol.name,
        identity: symbol.identity,
        start: symbol.range.start,
        end: symbol.range.end,
        conditions: ((data.conditions ?? []) as string[]).map(String),
        opaque: !!data.underOpaqueAttribute,
        gatedFields: ((data.gatedFields ?? []) as Json[]).map(String),
        fieldTypes: new Map(
          ((data.fields ?? []) as Json[]).flatMap((x) =>
            Array.isArray(x) && typeof x[1] === "string"
              ? [[String(x[0]), x[1]] as [string, string]]
              : [],
          ),
        ),
      });
    });
  });
  const lastSegment = (name: string) =>
    name.split("::").at(-1)!.replace(/<.*$/, "");
  /** Conditions the site's own do not imply (`?` markers never are). */
  const unmet = (conditions: readonly string[], site: readonly string[]) =>
    conditions.some((c) => !implies(site, c));
  /** A checkout item is selected for this site (design B, rule a). */
  const selectedItem = (id: string, site: readonly string[]) => {
    const fact = symbolFact.get(id);
    if (!fact) return true;
    if (fact.opaque) return true;
    return unmet([...fact.conditions, ...(moduleChain.get(id) ?? [])], site);
  };
  // Members (impl and trait items), by name, with their conditions.
  const members = new Map<string, string[][]>();
  // Deref, DerefMut, Index and IndexMut impls, by the type they are for.
  const derefImpls = new Map<string, string[][]>();
  for (const [id, fact] of symbolFact) {
    const chain = [...fact.conditions, ...(moduleChain.get(id) ?? [])];
    const member =
      fact.identity.startsWith("impl ") ||
      (fact.identity.includes("::") &&
        ["function", "method", "const", "type"].includes(fact.kind));
    if (member) {
      const list = members.get(fact.name) ?? [];
      list.push(fact.opaque ? ["?opaque"] : chain);
      members.set(fact.name, list);
    }
    const deref =
      fact.kind === "impl" &&
      /^impl\b.*\b(Deref|DerefMut|Index|IndexMut)\b.*\bfor\s+&?\s*(?:mut\s+)?([A-Za-z_][\w]*)/.exec(
        fact.identity,
      );
    if (deref) {
      const list = derefImpls.get(deref[2]!) ?? [];
      list.push(fact.opaque ? ["?opaque"] : chain);
      derefImpls.set(deref[2]!, list);
    }
  }
  // Imports, per file: their scope, the name they bind, glob or not, and
  // their conditions (a selected import is one the site does not imply).
  const importsByFile = new Map<
    string,
    {
      scope: string;
      name: string;
      glob: boolean;
      conditions: string[];
      /** Source-only resolved it to an item that is not a trait. */
      notTrait: boolean;
    }[]
  >();
  const selectedImportNames = new Map<string, string[][]>();
  updated.forEach((f, i) => {
    const list: {
      scope: string;
      name: string;
      glob: boolean;
      conditions: string[];
      notTrait: boolean;
    }[] = [];
    for (const [j, l] of (byPath.get(f.path)?.result.links ?? []).entries()) {
      if (l.kind !== "imports") continue;
      const resolved = resolutions.get(facts[i]!.links[j]!.id)?.targetId;
      const notTrait = !!resolved && symbolFact.get(resolved)?.kind !== "trait";
      const data = (l.data ?? {}) as Record<string, Json>;
      const glob = !!data.glob || l.targetName.endsWith("*");
      const name =
        (typeof data.alias === "string" && data.alias) ||
        lastSegment(l.targetName);
      const conditions = ((data.conditions ?? []) as Json[]).map(String);
      list.push({
        scope: typeof data.scope === "string" ? data.scope : "",
        name,
        glob,
        conditions,
        notTrait: !glob && notTrait,
      });
      if (conditions.length && !glob) {
        const named = selectedImportNames.get(name) ?? [];
        named.push(conditions);
        selectedImportNames.set(name, named);
      }
    }
    importsByFile.set(f.path, list);
  });
  const inScopeChain = (scope: string, site: string) =>
    scope === "" || site === scope || site.startsWith(`${scope}::`);
  // Functions with a cfg-gated statement or item inside them.
  const gatedFunctions = new Set<string>();
  const functionsByFile = new Map<
    string,
    [string, { start: number; end: number; conditions: string[] }][]
  >();
  for (const [id, fact] of symbolFact)
    if (fact.kind === "function" || fact.kind === "method") {
      const list = functionsByFile.get(fact.file) ?? [];
      list.push([id, fact]);
      functionsByFile.set(fact.file, list);
    }
  updated.forEach((f) => {
    const result = byPath.get(f.path)?.result;
    if (!result) return;
    const functions = functionsByFile.get(f.path) ?? [];
    // Only facts with conditions can be gated statements.
    const conditioned = [
      ...result.links.map((l) => ({
        range: l.range,
        conditions: (
          ((l.data ?? {}) as { conditions?: Json[] }).conditions ?? []
        ).map(String),
      })),
      ...result.symbols.map((x) => ({
        range: x.range,
        conditions: (
          ((x.data ?? {}) as { conditions?: Json[] }).conditions ?? []
        ).map(String),
      })),
    ].filter((x) => x.conditions.length);
    for (const [id, fn] of functions)
      if (
        conditioned.some(
          (x) =>
            x.range.start > fn.start &&
            x.range.end <= fn.end &&
            unmet(x.conditions, fn.conditions),
        )
      )
        gatedFunctions.add(id);
  });
  const STANDARD = new Set(["std", "core", "alloc"]);
  type Entry =
    | { k: "item"; id: string }
    | { k: "generated" }
    | { k: "field"; owner: string; name: string }
    | { k: "local"; defined: boolean }
    | { k: "library"; crate: string };
  /** The checkout symbols by name, for names written in a type. */
  const symbolsByName = new Map<string, string[]>();
  for (const [id, fact] of symbolFact) {
    const list = symbolsByName.get(fact.name) ?? [];
    list.push(id);
    symbolsByName.set(fact.name, list);
  }
  /** Whether a written type names a selected item or `use` binding. */
  const typeNamesSelected = (text: string, site: readonly string[]) =>
    (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).some(
      (name) =>
        (symbolsByName.get(name) ?? []).some((id) => selectedItem(id, site)) ||
        (selectedImportNames.get(name) ?? []).some((cs) => unmet(cs, site)),
    );
  /** Design B: why a trace leaves the answer undecided, or null. */
  const traceVerdict = (
    entries: readonly Entry[],
    site: readonly string[],
    receiver: boolean,
  ): string | null => {
    const selected = receiver ? "selected-receiver" : "selected-binding";
    let dependency = false;
    for (const entry of entries) {
      if (entry.k === "item") {
        if (selectedItem(entry.id, site)) return selected;
      } else if (entry.k === "generated") return selected;
      else if (entry.k === "field") {
        // A named field: selected with the type that declares it, when the
        // field itself is under a cfg the site does not imply, or when its
        // declared type names a selected item or a name a selected `use`
        // binds (a field whose type is a cfg-chosen alias).
        const owner = symbolFact.get(entry.owner);
        if (
          selectedItem(entry.owner, site) ||
          (owner?.gatedFields ?? []).includes(entry.name) ||
          typeNamesSelected(owner?.fieldTypes.get(entry.name) ?? "", site)
        )
          return selected;
      } else if (entry.k === "local") {
        if (!entry.defined) return "trace-incomplete";
      } else if (!STANDARD.has(entry.crate)) dependency = true;
    }
    return dependency ? "dependency-on-trace" : null;
  };
  // Sixth review A: a name a module binds in more than one namespace
  // (cortex-m-rt: `pub use macros::exception;` beside `pub use
  // self::Exception as exception;`) is imported in all of them, while the
  // toolchain names one. Bindings per scope and name: declared items (not
  // impl members) and named `use` items; and, per answer, the scopes whose
  // `use` re-exports it.
  const bindings = new Map<string, number>();
  const reexportedFrom = new Map<string, Set<string>>();
  const bind = (key: string) => bindings.set(key, (bindings.get(key) ?? 0) + 1);
  updated.forEach((f, i) => {
    const result = byPath.get(f.path)?.result;
    if (!result) return;
    for (const symbol of result.symbols) {
      if (symbol.identity.startsWith("impl ") || symbol.kind === "impl")
        continue;
      const segments = symbol.identity.split("::");
      bind(
        `${f.path}\u0000${segments.slice(0, -1).join("::")}\u0000${segments.at(-1)}`,
      );
    }
    result.links.forEach((l, j) => {
      if (l.kind !== "imports") return;
      const data = (l.data ?? {}) as Record<string, Json>;
      const name =
        (typeof data.alias === "string" && data.alias) ||
        lastSegment(l.targetName);
      if (name === "*" || name === "self" || data.glob) return;
      const scope = typeof data.scope === "string" ? data.scope : "";
      bind(`${f.path}\u0000${scope}\u0000${name}`);
      const r = resolutions.get(facts[i]!.links[j]!.id);
      for (const target of [
        ...(r?.targetId ? [r.targetId] : []),
        ...(r?.candidateIds ?? []),
      ]) {
        const places = reexportedFrom.get(target) ?? new Set<string>();
        places.add(`${f.path}\u0000${scope}`);
        reexportedFrom.set(target, places);
      }
    });
  });
  /** The imported name is bound more than once where it comes from. */
  const importNamespaces = (target: string, name: string): boolean => {
    const place = placeOf.get(target);
    const scopes = new Set(reexportedFrom.get(target) ?? []);
    if (place !== undefined) {
      const [file, identity] = place.split("\u0000") as [string, string];
      scopes.add(
        `${file}\u0000${identity.split("::").slice(0, -1).join("::")}`,
      );
    }
    for (const scope of scopes)
      if ((bindings.get(`${scope}\u0000${name}`) ?? 0) > 1) return true;
    return false;
  };
  /**
   * The selection label (design B, kept as a label): why the route saw a
   * build-condition selection on this site's trace, or null when the checks
   * below found none. Not a claim of configuration-independence: an answer
   * is definite for the configuration it records (D17, clarified).
   */
  const designB = (
    file: string,
    l: AnalyzedFile["result"]["links"][number],
    rest: Record<string, Json>,
    tcTrace: Json | undefined,
    target: string | undefined,
    candidates: readonly string[],
  ): string | null => {
    const site = ((rest.conditions ?? []) as Json[]).map(String);
    const trace = (tcTrace ?? {}) as {
      receiver?: boolean;
      enclosing?: string;
      entries?: Entry[];
      upTo?: number;
    };
    if (!trace.receiver) {
      // A path: each segment's binding, the `use` hops a segment may
      // pass through, and any selected source-only candidate.
      const verdict = traceVerdict(
        [
          ...(trace.entries ?? []),
          ...(target ? [{ k: "item" as const, id: target }] : []),
        ],
        site,
        false,
      );
      if (verdict) return verdict;
      const segments = String(rest.pathSyntax ?? l.targetName)
        .replace(/<[^<>]*>/g, "")
        .split("::")
        .map((x) => x.trim())
        .filter(Boolean);
      const scope = typeof rest.scope === "string" ? rest.scope : "";
      const keyword = new Set(["crate", "self", "super", "Self", "$crate"]);
      const first = segments[0];
      if (first !== undefined && !keyword.has(first)) {
        for (const use of importsByFile.get(file) ?? [])
          if (
            inScopeChain(use.scope, scope) &&
            (use.glob || use.name === first) &&
            unmet(use.conditions, site)
          )
            return "selected-binding";
      }
      for (const segment of segments.slice(1))
        if (
          (selectedImportNames.get(segment) ?? []).some((cs) => unmet(cs, site))
        )
          return "selected-binding";
      if (candidates.some((c) => c !== target && selectedItem(c, site)))
        return "selected-binding";
    } else {
      // A receiver: the enclosing function's trace up to the site, and
      // what method lookup could meet.
      const fn = trace.enclosing
        ? toolchain.functionTraces?.[trace.enclosing]
        : undefined;
      if (!fn || trace.upTo === undefined) return "trace-incomplete";
      const entries = fn.entries.slice(0, trace.upTo) as Entry[];
      const verdict = traceVerdict(entries, site, true);
      if (verdict) return verdict;
      if (gatedFunctions.has(trace.enclosing!)) return "selected-receiver";
      const name = lastSegment(l.targetName.split(".").at(-1) ?? "");
      if ((members.get(name) ?? []).some((cs) => unmet(cs, site)))
        return "selected-receiver";
      const scope = typeof rest.scope === "string" ? rest.scope : "";
      const traceNames = new Set(
        entries.flatMap((entry) =>
          entry.k === "item" && symbolFact.has(entry.id)
            ? [symbolFact.get(entry.id)!.name]
            : [],
        ),
      );
      for (const use of importsByFile.get(file) ?? [])
        if (
          inScopeChain(use.scope, scope) &&
          unmet(use.conditions, site) &&
          // One that may bring a trait. (One that binds a name on the
          // receiver's trace is covered below, wherever it is.)
          !use.notTrait
        )
          return "selected-receiver";
      // A name on the trace that a selected `use` binds anywhere in the
      // package, as for a path's later segments: `crate::Engine::new().run()`
      // through `#[cfg(feature = "fast")] pub(crate) use fe::Engine;` in
      // another file (manager's review of 90c66e77, item 5).
      for (const traced of traceNames)
        if (
          (selectedImportNames.get(traced) ?? []).some((cs) => unmet(cs, site))
        )
          return "selected-receiver";
      for (const entry of entries) {
        if (entry.k !== "item") continue;
        const fact = symbolFact.get(entry.id);
        if (!fact) continue;
        if ((derefImpls.get(fact.name) ?? []).some((cs) => unmet(cs, site)))
          return "selected-receiver";
      }
    }
    return null;
  };
  updated.forEach((f, i) => {
    const a = byPath.get(f.path);
    if (!a) return;
    a.result.links = a.result.links.map((l, j) => {
      const data = (l.data ?? {}) as Record<string, Json>;
      if (!("tc" in data)) return l;
      const { tc, tcTrace, ...rest } = data;
      const target = String(tc);
      const id = facts[i]!.links[j]!.id;
      // Every answer not applied records why on the link
      // (`toolchainOutcome`), so the measurement counts each guard exactly.
      const kept = (why: string) => {
        bump(why);
        return { ...l, data: { ...rest, toolchainOutcome: why } };
      };
      if (!identityOf.has(target)) return kept("withheld:no-symbol");
      const r = resolutions.get(id);
      // Sixth review A: an import decides only when the imported name is in
      // exactly one namespace where it comes from (as this index sees it).
      if (
        l.kind === "imports" &&
        r?.targetId !== target &&
        importNamespaces(target, lastSegment(l.targetName))
      )
        return kept("withheld:import-namespaces");
      const reasons = uncertaintyReasons(rest.uncertainty);
      // The selection label (no gate): what build conditions the trace met.
      const selection = beyondTest(rest.conditions as Json[] | undefined)
        ? "cfg-link"
        : !r?.targetId && reasons.includes("opaque-item-may-shadow-name")
          ? "opaque-shadow"
          : designB(f.path, l, rest, tcTrace, target, [
              ...((rest.targets ?? []) as Json[]).map(String),
              ...(r?.candidateIds ?? []),
            ]);
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
        if (r.libraries?.length) return kept("kept:library-candidates");
        from = "candidates";
      } else {
        // Seventh review (mutation table): an open link whose stored
        // targets are every definition of a cfg-conditional name (a
        // complete lookup) narrows only within them; an answer outside
        // them is the join's error, never this configuration's answer.
        const listed = ((rest.targets ?? []) as Json[]).map(String);
        if (
          listed.length &&
          reasons.includes("conditional-name-may-be-absent") &&
          !listed.includes(target)
        )
          return kept("kept:outside-candidate-set");
        from = "unresolved";
      }
      bump(`definite:${from}`);
      // The label of each upgrade, so every report can give Level 2
      // counting only none-seen links (D17 clarified).
      if (from !== "definite")
        bump(selection ? "label:seen" : "label:none-seen");
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
        // Whether the route saw a build-condition selection on the trace.
        selection: selection ? "seen" : "none-seen",
        ...(selection ? { selectionReason: selection } : {}),
        // The complete route-off data, so the configuration-free view can
        // always be read back (an upgrade clears open-link data).
        ...(from === "definite" ? {} : { routeOff: { ...rest } }),
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
    // Design B: every symbol's module-chain conditions (`test` included).
    const moduleChain = new Map<string, string[]>();
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
        if (modules.length) moduleChain.set(symbol.id, modules);
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
              moduleChain,
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
    // C-43: the toolchain's answer, where the source-only one is still open.
    const upgraded = new Map<string, string>();
    for (const link of ctx.links) {
      const record = (link.data as { toolchain?: Record<string, Json> })
        ?.toolchain;
      if (
        record?.origin === "toolchain" &&
        typeof record.target === "string" &&
        record.from !== "definite"
      )
        upgraded.set(link.id, record.target);
    }
    if (upgraded.size) {
      const seen = new Set<string>();
      resolutions = resolutions.map((r) => {
        const target = upgraded.get(r.linkId);
        if (target === undefined) return r;
        seen.add(r.linkId);
        return r.candidateIds || (!r.targetId && !r.library)
          ? { linkId: r.linkId, targetId: target }
          : r;
      });
      for (const [linkId, targetId] of upgraded)
        if (!seen.has(linkId)) resolutions.push({ linkId, targetId });
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
        const traces = route?.traces.get(path);
        return {
          path,
          module,
          result: answers
            ? {
                ...result,
                links: result.links.map((link, index) =>
                  answers.has(index)
                    ? {
                        ...link,
                        data: {
                          ...((link.data ?? {}) as Record<string, Json>),
                          tc: answers.get(index)!,
                          // Design B: transient, removed by the decision.
                          ...(traces?.has(index)
                            ? { tcTrace: traces.get(index) as unknown as Json }
                            : {}),
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
              functionTraces: Object.fromEntries(
                route.functionTraces,
              ) as unknown as Record<string, { entries: Json[]; at: number[] }>,
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
