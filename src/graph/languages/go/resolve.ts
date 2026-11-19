// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import type {
  AddedLink,
  ContextFile,
  GraphFile,
  GraphLink,
  GraphSymbol,
  Json,
  LibraryTarget,
  LinkResolution,
  ResolutionContext,
  ResolutionResult,
} from "../../types.js";
import {
  directoryOfImport,
  importPathOf,
  libraryOrigin,
  moduleOf,
  readLayout,
  type LibraryOrigin,
} from "./gomod.js";
import type { GoProjectLayout } from "./gomod.js";
import {
  releasedBy,
  stdTable,
  type StdMember,
  type StdNamed,
  type StdType,
} from "./stdlib.js";
import {
  fileConstraint,
  impliesAnyTags,
  satisfiableAnyTags,
  satisfiableOrdinary,
  type Formula,
} from "./constraints.js";
import {
  BUILTIN_FUNCTIONS,
  PREDECLARED_TYPES,
  PREDECLARED_VALUES,
  TYPE_KINDS,
  type Desc,
  type FileFact,
  type TypeRef,
  type TypeTerm,
} from "./model.js";

/** Above this many possible targets an unknown-receiver call stays unresolved. */
export const CANDIDATE_LIMIT = 20;
/** Interface dispatch lists a proven set (the method and its structural implementers): a higher cap. */
export const DISPATCH_LIMIT = 50;
const MAX_DEPTH = 12;
/** Embedding depth and per-depth path limits for selector search; beyond them: not known. */
const MAX_EMBED_DEPTH = 6;
const MAX_EMBED_PATHS = 64;
/** Configurations (choices of build variant) one selection may search; beyond: not known. */
const MAX_VARIANT_RUNS = 32;

interface Pkg {
  key: string;
  directory: string;
  name: string;
  files: string[];
  importPath?: string;
  symbol?: GraphSymbol;
}
interface FileInfo {
  path: string;
  directory: string;
  fact: FileFact;
  pkg?: Pkg;
  /** Import name -> project packages (empty for external/unresolved) and import path. */
  imports: Map<string, ImportEntry>;
  dots: ImportEntry[];
}
/**
 * An import as names see it. `pkgs`: the project packages names bind to (empty
 * when outside the project, or when which destination Go uses is uncertain:
 * then names through it are treated like an external package's). `reach`: every
 * project package it may be, for reachability. `uncertain`: more than one
 * possible destination, not all captured in the project.
 */
interface ImportEntry {
  path: string;
  pkgs: Pkg[];
  reach: Pkg[];
  uncertain?: true;
  /** Every file of the imported package failed: these are the cause. */
  failed?: string[];
}
/**
 * What is known about a value's type. `external`: declared outside the project (its
 * members are not in the graph). `opaque`: known not to be resolvable (local named
 * type, constraint-less type parameter). `unknown`: not syntactically evident.
 */
type TypeValue =
  | { kind: "project"; syms: GraphSymbol[] }
  /** `shadowable`: a predeclared name in a lossy package (an unseen declaration may shadow it). */
  /**
   * `std` (C-17): the standard-library type the table proves it to be; only
   * library targets use it, every other decision treats the value as external.
   */
  | { kind: "external"; name: string; shadowable?: true; std?: StdType }
  | { kind: "cont"; e: Desc; key?: Desc; ch?: boolean; file: string }
  | { kind: "func"; r: Desc[]; file: string }
  | { kind: "tparam"; c?: TypeRef; file: string }
  | { kind: "opaque" }
  | { kind: "unknown" }
  /** It needs code in failed files (`cause`): every link depending on it fails. */
  | { kind: "failed"; cause: string[] };
type Entity =
  | { e: "pkg"; pkgs: Pkg[]; path: string }
  | { e: "syms"; syms: GraphSymbol[] }
  | { e: "value"; type: TypeValue }
  /**
   * Something declared outside the project (function, type or variable).
   * `std` (C-17): what the standard-library table proves it is.
   */
  | { e: "external"; name: string; std?: StdEntity }
  /**
   * Not knowable: in a lossy package an unseen declaration may own the name.
   * `cause`: the failed files that might declare it (the link is invalid code).
   */
  | { e: "unknown"; cause?: string[] }
  | { e: "none" };
const NONE: Entity = { e: "none" };
const UNSEEN: Entity = { e: "unknown" };
const UNKNOWN: TypeValue = { kind: "unknown" };
const OPAQUE: TypeValue = { kind: "opaque" };
/** Result of Go's selector rule for one name on a type. */
type Selection =
  /** Exactly one declaration path at the shallowest depth (syms > 1 only for build variants). */
  | { kind: "found"; syms: GraphSymbol[]; pointer: boolean }
  /** Several paths at the shallowest depth: illegal in Go. */
  | { kind: "ambiguous"; syms: GraphSymbol[] }
  | { kind: "none" }
  /** An external or unresolvable embedded type could supply or shadow the name. */
  | { kind: "unknown" }
  /** Unknown because of code in failed files (`cause`): links on it fail. */
  | { kind: "failed"; cause: string[] }
  /**
   * Only when asked for (C-17): the name is a member of a standard-library
   * type embedded in a project type, at the shallowest depth and alone there.
   */
  | { kind: "library"; member: StdMember };
/** A standard-library thing an expression denotes (C-17). */
type StdEntity =
  /** A value of this type (a variable, constant or field). */
  | { t: "value"; type: StdType }
  /** A function or method value with these result types. */
  | { t: "func"; results: StdType[] }
  /** A named type (a conversion's result). */
  | { t: "type"; type: StdType };
/** The structure of a type, from `view`. */
interface View {
  /** An interface type: these interfaces' flat method set. */
  iface?: GraphSymbol[];
  /** Fields and methods declared at this level (for non-interfaces). */
  members: (name: string) => GraphSymbol[];
  embedded: { value: TypeValue; pointer: boolean; key: string }[];
  /** The structure cannot be fully determined. */
  unknown?: true;
  /** Methods declared on the type itself: known even when the rest is unknown. */
  declared?: (name: string) => GraphSymbol[];
  /** Only because of a type outside the project (cannot hold project-unexported names). */
  externalOnly?: true;
  /**
   * A type declared in several build variants: a method of this name is
   * declared in a file that may or may not be built with this variant.
   */
  uncertain?: (
    name: string,
    from?: string,
  ) => { method: GraphSymbol; built: false | undefined }[];
}
interface InterfaceMethod {
  /** Name, plus the declaring package for an unexported name. */
  key: string;
  name: string;
  sig: Identity;
  /** Declaring package of an unexported method (it is a different identifier elsewhere). */
  access?: string | undefined;
}
export interface Decision {
  ids: string[];
  /** Only a definite decision may become a single target. */
  definite: boolean;
  /** Candidate cap for this kind of decision. */
  limit?: number;
  /** Why the set may omit a target (absent: complete); every reason that applies. */
  open?: OpenReason[];
  /** An interface-dispatch set (always open: structural match unverified). */
  dispatch?: true;
  /**
   * Dispatch only: a type declared in a failed or untrusted file could be a
   * member (layer 1), so the set carries `declarations-may-be-unseen`; with no
   * valid member left it is unresolved with that reason, not plain unresolved.
   */
  unseen?: true;
  /** Failed: it needs code in these failed files (`invalid-code`). */
  invalid?: string[];
  /**
   * Decided by the opt-in toolchain route (W3-L): a definite target, a verified
   * implementer set, or (where the source-only route had a definite project
   * target) an external or builtin callee.
   */
  toolchain?: "definite" | "verified" | "external" | "library";
  /** What the source-only route decided, for the report. */
  from?: "definite" | "candidates" | "unresolved" | "invalid";
  /** The source-only route's different definite target (a disagreement). */
  sourceOnly?: string;
}
/** A toolchain fact on a link, written by `analyze` (toolchain-facts.ts). */
export interface ToolchainFact {
  /** Call category (go/types), e.g. func, method, iface, typeparam, conversion. */
  c?: string;
  /** Declaration of the callee or used object in the project: file, UTF-16 offset, name. */
  at?: [string, number, string];
  /** A standard-library or dependency object: package path and name. */
  ext?: string;
  /** A builtin (universe) object. */
  b?: true;
  /** Interface call: the project methods it can reach (verified implementer set). */
  d?: [string, number, string][];
  /** Interface call: implementers outside the project among the loaded packages. */
  x?: number;
  /** Import: the imported package's directory in the project (main module or vendor/). */
  dir?: string;
  /**
   * A standard-library or dependency object as go/types selected it: the
   * declaring package's path, the symbol (`Name`, or `Owner.Name` for a
   * field or concrete method with its declaring named type; absent when the
   * owner is not a named type of that package, or for an interface method),
   * and whether the package is in GOROOT (`std`) or a dependency (`dep`).
   */
  l?: [string, string | null, "std" | "dep"];
}
/** A toolchain `implements` pair on the type's file: type offset, interface file, offset, how. */
export type ToolchainPair = [number, string, number, "value" | "pointer"];
/**
 * What the failed-file backstop follows of a value's type: nothing but the
 * lookups (`none`), its member set (`embedded`: beyond depth 0; `n`: the member
 * sought), a container's element or key (`comp`), or a function's result.
 */
type Use =
  | { k: "none" }
  | { k: "members"; embedded: boolean; n?: string }
  | { k: "comp"; key: boolean; then: Use }
  | { k: "result"; i: number; then: Use };
/** Why a candidate set is open, i.e. may omit the true target. */
export type OpenReason =
  /** Dispatch on an interface that a type outside the project could satisfy. */
  | "external-implementers-possible"
  /** A name-only set: the receiver's type, and so its package, is unknown. */
  | "receiver-type-unknown"
  /** Declarations of a declaration-lossy package (see W2-B.md) may be unseen. */
  | "declarations-may-be-unseen"
  /** Which `replace` destination Go uses is not proven; one is not captured. */
  | "import-destination-uncertain"
  /** Interface dispatch: members match by name and count only, not proven. */
  | "structural-match-unverified";
const UNRESOLVED: Decision = { ids: [], definite: false };
/** An import two modules provide (Go: "ambiguous import"). */
const AMBIGUOUS_IMPORT: Decision = { ids: [], definite: false };
/**
 * How each property of decisions is combined when their targets together are
 * the answer (a call through several possible function values). Every field of
 * `Decision` must have a rule here (a missing one is a compile error), so no
 * property of a part is dropped: reasons are unioned, openness is the weakest,
 * any part unknown leaves the whole without targets, any failure fails it.
 */
const COMBINE: {
  [K in keyof Required<Decision>]: (
    values: Decision[K][],
  ) => Decision[K] | undefined;
} = {
  ids: (values) =>
    values.some((ids) => !ids.length) ? [] : unique(values.flat()),
  definite: (values) => values.every(Boolean),
  limit: (values) => {
    const limits = values.filter((value) => value !== undefined);
    return limits.length ? Math.min(...limits) : undefined;
  },
  open: (values) => {
    const all = unique(values.flatMap((value) => value ?? []));
    return all.length ? all : undefined;
  },
  dispatch: (values) => (values.some(Boolean) ? true : undefined),
  unseen: (values) => (values.some(Boolean) ? true : undefined),
  invalid: (values) => {
    const all = values.flatMap((value) => value ?? []);
    return all.length ? unique(all).sort() : undefined;
  },
  // Toolchain decisions are never combined (they decide one link); the first
  // part's value, if any, is kept.
  toolchain: (values) => values.find((value) => value !== undefined),
  from: (values) => values.find((value) => value !== undefined),
  sourceOnly: (values) => values.find((value) => value !== undefined),
};
const combine = (parts: Decision[]): Decision => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(COMBINE) as (keyof Decision)[]) {
    const merge = COMBINE[key] as (values: unknown[]) => unknown;
    const value = merge(parts.map((part) => part[key]));
    if (value !== undefined) out[key] = value;
  }
  const decision = out as unknown as Decision;
  // A failure fails the whole: no targets.
  return decision.invalid ? { ...decision, ids: [] } : decision;
};
/** A failed link: it needs code in these failed files (no target, no candidates). */
const failed = (files: string[]): Decision => ({
  ids: [],
  definite: false,
  invalid: unique(files).sort(),
});

const directoryOf = (path: string) => {
  const directory = posix.dirname(path);
  return directory === "." ? "" : directory;
};
const exported = (name: string) => /^\p{Lu}/u.test(name);
const unique = <T>(items: T[]) => [...new Set(items)];
/** Package name a non-project import is conventionally referred to by (only used to recognise qualifiers). */
export function conventionalName(path: string): string {
  const parts = path.split("/");
  let last = parts.at(-1) ?? path;
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts.at(-2)!;
  last = last.replace(/\.v\d+$/, "");
  if (last.startsWith("go-")) last = last.slice(3);
  return last.replace(/[.-]/g, "_");
}

/**
 * The names an unnamed import of a package whose clause is not in the
 * checkout may bind (C-14): the last path element, or the one before a
 * `/vN` suffix, without a `.vN` suffix, a `go-` prefix or a `-go` or
 * `.go` suffix, with hyphens dropped or written as underscores.
 */
export function plausibleNames(path: string): string[] {
  const parts = path.split("/");
  const last = parts.at(-1) ?? path;
  const bases = [last];
  if (/^v\d+$/.test(last) && parts.length > 1) bases.push(parts.at(-2)!);
  const seen = new Set<string>();
  const queue = [...bases];
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const next of [
      name.replace(/\.v\d+$/, ""),
      name.replace(/^go-/, ""),
      name.replace(/(-go|\.go)$/, ""),
    ])
      if (next && next !== name) queue.push(next);
  }
  const out = new Set<string>();
  for (const name of seen)
    for (const form of [name, name.replace(/-/g, ""), name.replace(/-/g, "_")])
      if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(form)) out.add(form);
  return [...out].sort();
}

export function resolveGo(
  moduleId: string,
  context: ResolutionContext,
): ResolutionResult {
  return new GoResolver(moduleId, context).run();
}

/** A link whose possible targets exceed the cap for its kind of decision. */
export interface Overflow {
  candidates: number;
  cap: number;
}
/** Facts about a parsed link that only whole-project resolution can establish. */
export interface LinkNote {
  overflow?: Overflow;
  /** The candidate set is open: it may omit the true target, for these reasons. */
  open?: OpenReason[];
  /** The call really is to a builtin (no package-level declaration shadows it). */
  builtin?: true;
  /** Failed (`invalid-code`): the code it needs is in these failed files. */
  invalid?: string[];
  /**
   * Unresolved, with a member selected on a value of a library type: the
   * member's declaring owner is not provable from the checkout (C-14).
   */
  library?: "library-member-unproven";
  /** Decided by the toolchain route (see Decision.toolchain). */
  toolchain?: {
    upgrade: "definite" | "verified" | "external" | "library";
    from: "definite" | "candidates" | "unresolved" | "invalid";
    sourceOnly?: string;
  };
}

/**
 * Runs the same resolution over provisional IDs (`draft:<file>\0<key>`) to find
 * links whose candidate sets exceed their cap. Used by `analyze`, the only phase
 * that may write link data, so the reason is recorded on the link itself.
 */
export function linkNotes(
  moduleId: string,
  files: readonly GraphFile[],
  contextFiles: readonly ContextFile[],
): Map<string, Map<number, LinkNote>> {
  const symbols: GraphSymbol[] = [];
  const links: GraphLink[] = [];
  const id = (path: string, key: string) => `draft:${path}\u0000${key}`;
  for (const file of files) {
    if (file.module !== moduleId || file.result.status === "failed") continue;
    for (const symbol of file.result.symbols)
      symbols.push({
        ...symbol,
        id: id(file.path, symbol.key),
        ordinal: 0,
        file: file.path,
        module: moduleId,
        status: file.result.status,
      });
    file.result.links.forEach((link, index) =>
      links.push({
        ...link,
        id: `${file.path}\u0000${index}`,
        file: file.path,
        module: moduleId,
        origin: "parse",
        sourceId:
          link.sourceKey === null ? null : id(file.path, link.sourceKey),
        targetId: null,
        resolution: "unresolved",
        candidates: [],
        sourceStatus: file.result.status,
        targetStatus: null,
      }),
    );
  }
  const resolver = new GoResolver(moduleId, {
    projectId: "go-overflow",
    files,
    contextFiles,
    symbols,
    links,
  });
  resolver.run();
  const output = new Map<string, Map<number, LinkNote>>();
  const note = (linkId: string): LinkNote => {
    const split = linkId.lastIndexOf("\u0000");
    const path = linkId.slice(0, split);
    let group = output.get(path);
    if (!group) output.set(path, (group = new Map()));
    const index = Number(linkId.slice(split + 1));
    let item = group.get(index);
    if (!item) group.set(index, (item = {}));
    return item;
  };
  for (const [linkId, overflow] of resolver.overflow)
    note(linkId).overflow = overflow;
  for (const linkId of resolver.builtins) note(linkId).builtin = true;
  for (const [linkId, reasons] of resolver.open) note(linkId).open = reasons;
  for (const [linkId, files] of resolver.invalid) note(linkId).invalid = files;
  for (const linkId of resolver.libraryMembers)
    note(linkId).library = "library-member-unproven";
  for (const [linkId, decided] of resolver.toolchain)
    note(linkId).toolchain = decided;
  return output;
}

class GoResolver {
  /** Links whose candidate sets exceeded their cap: unresolved, never truncated. */
  readonly overflow = new Map<string, Overflow>();
  /** Calls whose builtin name is not shadowed by a package-level declaration. */
  readonly builtins = new Set<string>();
  /** Candidate links whose set may omit a target outside the project. */
  readonly open = new Map<string, OpenReason[]>();
  /** Links that failed because the code they need is in failed files. */
  readonly invalid = new Map<string, string[]>();
  /** Members selected on a library-typed value whose owner is unproven (C-14). */
  readonly libraryMembers = new Set<string>();
  /** Links the toolchain route decided (W3-L), for the link notes. */
  readonly toolchain = new Map<string, NonNullable<LinkNote["toolchain"]>>();
  /** Failed files by directory (a file that cannot be read is not valid code). */
  private failedFiles = new Map<string, { path: string; test: boolean }[]>();
  private layout: GoProjectLayout;
  private files = new Map<string, FileInfo>();
  private pkgs = new Map<string, Pkg>();
  private symbolsById = new Map<string, GraphSymbol>();
  /** Function-local and anonymous types by file and identity. */
  private localTypes = new Map<string, GraphSymbol>();
  /**
   * Packages with a declaration-lossy file (layer 1, see W2-B.md): unseen
   * declarations may exist in them.
   */
  private lossyPackages = new Set<string>();
  /** Placeholders for directories whose every file failed (reach only). */
  private failedOnly = new Map<string, Pkg>();
  private byFileKey = new Map<string, GraphSymbol>();
  private decls = new Map<string, Map<string, GraphSymbol[]>>();
  private members = new Map<string, GraphSymbol[]>();
  private methodsByName = new Map<string, GraphSymbol[]>();
  private embedsBySource = new Map<string, GraphLink[]>();
  private implementers = new Map<string, GraphSymbol[]>();
  /** Proven implementers plus types not refuted (an external embedded type might supply a method). */
  private possible = new Map<string, GraphSymbol[]>();
  /** Interfaces whose method set is fully known, so their implementer list is complete. */
  private complete = new Set<string>();
  private memo = new Map<string, TypeValue>();
  /**
   * How many answers the depth limit or a cycle guard has cut short. A cached
   * answer (`memo`, `views`, `hiddenMemo`, `externalMemo`) is kept only when
   * none was cut short while computing it, so the order in which deep and
   * shallow routes first reach a type cannot change any answer.
   */
  private cutoffs = 0;
  private cut<T>(value: T): T {
    this.cutoffs++;
    return value;
  }
  private selections = new Map<string, Selection>();

  private readonly context: ResolutionContext;
  constructor(
    private readonly moduleId: string,
    context: ResolutionContext,
    /**
     * Only to name an open set's reasons: resolve as if no file were lossy
     * (failed files' directories are not treated as holding unseen ones).
     */
    private readonly ignoreLossy = false,
  ) {
    // One fixed order, whatever order the store supplies: the caches and the
    // depth limit make which route reaches a type first matter, so the
    // outcome must not depend on how the files were read.
    this.context = ordered(context);
    this.layout = readLayout(context.contextFiles);
  }

  run(): ResolutionResult {
    this.index();
    const added: AddedLink[] = [];
    this.implementsLinks(added);
    this.toolchainImplements(added);
    for (const pkg of this.pkgs.values())
      if (pkg.symbol)
        for (const path of pkg.files) {
          const file = this.byFileKey.get(`${path}\u0000file`);
          if (file)
            added.push({
              key: `contains:package:${pkg.name}:${path}`,
              file: pkg.symbol.file,
              sourceId: pkg.symbol.id,
              kind: "contains",
              targetName: posix.basename(path),
              range: pkg.symbol.range,
              targetId: file.id,
            });
        }
    const resolutions: LinkResolution[] = [];
    for (const link of this.context.links) {
      const name = link.data as { builtinName?: boolean } | undefined;
      let decision: Decision;
      try {
        if (
          name?.builtinName &&
          this.lookupName(link.targetName, link.file).e === "none"
        )
          this.builtins.add(link.id);
        decision = this.resolveLink(link);
      } catch {
        // Never let one link fail the project: an unexpected failure (for
        // example on pathological input) leaves that link unresolved.
        decision = UNRESOLVED;
      }
      const source = decision;
      // The opt-in toolchain route decides where it has a fact (W3-L).
      const decided = this.toolchainDecision(link, decision);
      if (decided) {
        decision = decided;
        this.toolchain.set(link.id, {
          upgrade: decided.toolchain!,
          from: decided.from!,
          ...(decided.sourceOnly ? { sourceOnly: decided.sourceOnly } : {}),
        });
      }
      // A target outside the checkout (C-14), only where there is no
      // checkout target, candidate set or failure: the toolchain's selection
      // when it has one, else what the source proves.
      if (!decision.invalid?.length && !decision.ids.length) {
        let library: LibraryTarget | LibraryTarget[] | undefined;
        let fromToolchain = false;
        try {
          library = this.toolchainLibrary(link);
          fromToolchain = !!library;
          library ??= this.libraryOf(link);
          if (!library && (link.kind === "calls" || link.kind === "references"))
            library = this.stdMemberTarget(link);
        } catch {
          library = undefined;
        }
        if (library) {
          if (fromToolchain) {
            const ids = unique(source.ids);
            const sourceTarget =
              ids.length === 1 && source.definite && !source.invalid?.length
                ? ids[0]
                : undefined;
            this.toolchain.set(link.id, {
              upgrade: "library",
              from: source.invalid?.length
                ? "invalid"
                : sourceTarget
                  ? "definite"
                  : ids.length > 1
                    ? "candidates"
                    : "unresolved",
              ...(sourceTarget
                ? { sourceOnly: this.describe(sourceTarget) }
                : {}),
            });
          }
          if (Array.isArray(library))
            // Several imports may declare the qualifier: a set of their units.
            resolutions.push({
              linkId: link.id,
              candidateIds: [],
              libraries: library,
            });
          else resolutions.push({ linkId: link.id, library });
          continue;
        }
      }
      const {
        ids,
        definite,
        limit = CANDIDATE_LIMIT,
        open,
        dispatch,
      } = decision;
      const distinct = unique(ids).sort();
      // Backstop: a link about to be emitted as not resolved (anything but a
      // definite target or an interface-dispatch set over known types) fails
      // when any type its source mentions needs a failed file.
      if (
        !decision.toolchain &&
        !decision.invalid?.length &&
        !(decision.dispatch && distinct.length) &&
        !(distinct.length === 1 && definite) &&
        this.failedFiles.size
      ) {
        let cause: string[] = [];
        try {
          cause = this.involvedCause(link);
        } catch {
          cause = [];
        }
        if (cause.length) {
          this.invalid.set(link.id, cause);
          continue;
        }
      }
      if (decision.invalid?.length) {
        this.invalid.set(link.id, decision.invalid);
        continue;
      }
      if (distinct.length === 1 && definite)
        resolutions.push({ linkId: link.id, targetId: distinct[0]! });
      else if (distinct.length > 1 && distinct.length <= limit) {
        resolutions.push({ linkId: link.id, candidateIds: distinct });
        // A verified implementer set (toolchain) carries only its own reasons.
        if (decision.toolchain) {
          if (open?.length) this.open.set(link.id, [...open]);
          continue;
        }
        const reasons = this.reasons(link, distinct, open);
        // Interface dispatch is always open: membership is unverified.
        if (dispatch && !reasons.includes("structural-match-unverified"))
          reasons.push("structural-match-unverified");
        if (decision.unseen && !reasons.includes("declarations-may-be-unseen"))
          reasons.push("declarations-may-be-unseen");
        if (reasons.length) this.open.set(link.id, reasons);
      } else if (distinct.length > limit)
        // Too many to list: unresolved with the name kept; a cut list could omit the target.
        this.overflow.set(link.id, { candidates: distinct.length, cap: limit });
      else if (decision.unseen)
        // A dispatch with no valid member: unresolved, its members may be unseen.
        this.open.set(link.id, ["declarations-may-be-unseen"]);
      else if (decision === AMBIGUOUS_IMPORT)
        // Several modules provide the package: unresolved, with the reason.
        this.open.set(link.id, ["import-destination-uncertain"]);
      else if (!distinct.length && this.libraryMember(link))
        this.libraryMembers.add(link.id);
    }
    return { resolutions, links: added };
  }

  // ---- the standard-library table (C-17) ---------------------------------

  private directives = new Map<string, string | undefined>();
  /**
   * The `go` directive of the module a file belongs to (a go.mod without one
   * means Go 1.16); undefined outside any module.
   */
  private goDirective(from: string | undefined): string | undefined {
    if (from === undefined) return undefined;
    const directory = directoryOf(from);
    if (!this.directives.has(directory)) {
      const module = moduleOf(this.layout, directory);
      this.directives.set(
        directory,
        module ? (module.go ?? "1.16") : undefined,
      );
    }
    return this.directives.get(directory);
  }

  private stdPackages = new Map<string, string | null>();
  /**
   * The standard-library package a qualifier written in `from` binds, by
   * C-14's rules (`libraryImport`: one import binds it, and it is the
   * standard library), when the table has the package.
   */
  private stdPackage(qualifier: string, from: string): string | undefined {
    const key = `${from}\u0000${qualifier}`;
    let found = this.stdPackages.get(key);
    if (found === undefined) {
      found = null;
      const info = this.files.get(from);
      try {
        const bound = info ? this.libraryImport(qualifier, info) : undefined;
        if (
          bound?.length === 1 &&
          bound[0]!.origin.ecosystem === "go-std" &&
          stdTable().hasPackage(bound[0]!.path)
        )
          found = bound[0]!.path;
      } catch {
        found = null;
      }
      this.stdPackages.set(key, found);
    }
    return found ?? undefined;
  }

  /** The standard-library named type `q.Name` written in `from` denotes. */
  private stdTypeNamed(
    qualifier: string,
    name: string,
    from: string,
  ): StdType | undefined {
    if (!exported(name)) return undefined;
    const pkg = this.stdPackage(qualifier, from);
    const named = pkg === undefined ? undefined : stdTable().named(pkg, name);
    return named ? { k: "named", pkg: named.pkg, name: named.name } : undefined;
  }

  /** What `q.Name` (a qualified name written in `from`) is in the table. */
  private stdQualified(
    desc: Extract<Desc, { k: "sel" }>,
    from: string,
    path?: string,
  ): StdEntity | undefined {
    if (desc.x.k !== "name" || !exported(desc.n)) return undefined;
    const pkg = this.stdPackage(desc.x.n, from);
    if (pkg === undefined || (path !== undefined && path !== pkg))
      return undefined;
    const object = stdTable().object(pkg, desc.n);
    if (!object) return undefined;
    if (object.k === "type")
      return {
        t: "type",
        type: { k: "named", pkg: object.type.pkg, name: object.type.name },
      };
    return object.k === "func"
      ? { t: "func", results: object.results }
      : { t: "value", type: object.type };
  }

  private withStd(
    entity: Extract<Entity, { e: "external" }>,
    std: StdEntity | undefined,
  ): Entity {
    return std ? { ...entity, std } : entity;
  }

  /**
   * The member `name` of a value of a standard-library type: the table's
   * entry, when it is certain (the same on every platform, not ambiguous)
   * and in every Go release the referencing module may be built with.
   */
  private stdMember(
    type: StdType,
    name: string,
    from: string | undefined,
  ): StdMember | undefined {
    const named = stdNamedOf(type);
    const member = named?.members.get(name);
    if (!member || member.kind === "uncertain") return undefined;
    return releasedBy(member.since, this.goDirective(from))
      ? member
      : undefined;
  }

  private stdSelect(
    type: StdType,
    name: string,
    from: string,
  ): StdEntity | undefined {
    const member = this.stdMember(type, name, from);
    if (!member) return undefined;
    return member.kind === "field"
      ? { t: "value", type: member.type ?? { k: "unknown" } }
      : { t: "func", results: member.results ?? [] };
  }

  /**
   * An embedded standard-library type, for Go's selector rule on a project
   * type: its member `name` (and depth inside it), no such member, or
   * unknown from a depth (an uncertain entry, or one a release the module
   * may be built with lacks). Undefined when the table does not know the
   * type (the caller keeps it unknown).
   */
  private stdEmbedded(
    type: StdType,
    name: string,
    from: string | undefined,
  ): { member: StdMember } | { unknownAt?: number } | undefined {
    if (!stdNamedOf(type)) return undefined;
    const entry = stdNamedOf(type)!.members.get(name);
    if (!entry) return {};
    const member = this.stdMember(type, name, from);
    return member ? { member } : { unknownAt: entry.depth };
  }

  /** The library target of a standard-library member: its declaring owner. */
  private stdTarget(member: StdMember): LibraryTarget {
    return {
      ecosystem: "go-std",
      unit: member.ownerPkg,
      symbol: `${member.ownerType}.${member.name}`,
      evidence: "declaring-owner",
    };
  }

  /**
   * A field or method selected on a value whose type the source proves to be
   * a standard-library type, or a project struct that embeds one where Go's
   * selector rule picks the embedded type's member (C-17): its declaring
   * owner from the table.
   */
  private stdMemberTarget(link: GraphLink): LibraryTarget | undefined {
    let desc = (link.data as { expr?: Desc } | undefined)?.expr;
    if (desc?.k === "inst") desc = desc.x;
    if (desc?.k !== "sel" || !exported(desc.n)) return undefined;
    const base = this.denote(staticDesc(desc.x), link.file, 0);
    let type: TypeValue | undefined;
    if (base.e === "value") type = base.type;
    else if (base.e === "external")
      type = base.std?.t === "value" ? externalValue(base) : undefined;
    else if (base.e === "syms" && !base.syms.every(isTypeSymbol))
      type = this.sameType(
        base.syms.map((symbol) => this.valueType(symbol, 1)),
      );
    if (type?.kind === "external" && type.std && !type.shadowable) {
      const member = this.stdMember(type.std, desc.n, link.file);
      return member && this.stdTarget(member);
    }
    if (type?.kind === "project") {
      const found = this.selectName(
        type.syms,
        desc.n,
        link.file,
        undefined,
        false,
        true,
      );
      return found.kind === "library"
        ? this.stdTarget(found.member)
        : undefined;
    }
    return undefined;
  }

  // ---- library targets (C-14) -------------------------------------------

  private originMemo = new Map<string, LibraryOrigin | null>();
  /** The library an import path names from this file's directory (see libraryOrigin). */
  private origin(info: FileInfo, path: string): LibraryOrigin | undefined {
    const key = `${info.directory}\u0000${path}`;
    let found = this.originMemo.get(key);
    if (found === undefined) {
      found = this.testdataProvides(info.directory, path)
        ? null
        : (libraryOrigin(this.layout, info.directory, path, (directory) =>
            this.vendorRoots.has(directory),
          ) ?? null);
      this.originMemo.set(key, found);
    }
    return found ?? undefined;
  }

  /**
   * A file under a `testdata` directory whose tree supplies the imported
   * package itself (`testdata/src/<path>`, the GOPATH layout test harnesses
   * load, such as golang/tools' fake `fmt`): checkout code, never a library.
   */
  private testdataProvides(directory: string, path: string): boolean {
    const parts = directory.split("/");
    for (let index = parts.length - 1; index >= 0; index--)
      if (
        parts[index] === "testdata" &&
        this.fileDirectories.has(
          [...parts.slice(0, index + 1), "src", path].join("/"),
        )
      )
        return true;
    return false;
  }

  /**
   * The library packages a qualifier written in `info` may bind: the
   * qualifier is no package-level or local declaration (locals are bound at
   * parse), every import of the file that can declare it names a package
   * outside the checkout, and none of them is checkout code. An explicit
   * import name binds itself; a standard-library package's name is its last
   * path element (before a `/vN` suffix); an unnamed dependency import binds
   * the package clause of a package the checkout does not hold, which may be
   * any of the path's plausible names (`plausibleNames`). One such import:
   * the target; several: a candidate set of their units.
   */
  private libraryImport(
    qualifier: string,
    info: FileInfo,
  ): { path: string; origin: LibraryOrigin }[] | undefined {
    const entity = this.lookupName(qualifier, info.path);
    if (!(entity.e === "none" || (entity.e === "pkg" && !entity.pkgs.length)))
      return undefined;
    const bound: { path: string; origin: LibraryOrigin }[] = [];
    for (const item of info.fact.imports) {
      if (item.alias === "." || item.alias === "_") continue;
      let names: string[];
      let origin: LibraryOrigin | undefined;
      if (item.alias !== undefined) names = [item.alias];
      else {
        const { pkgs } = this.importTargets(info, item.path);
        origin = pkgs.length ? undefined : this.origin(info, item.path);
        names = pkgs.length
          ? pkgs.map((pkg) => pkg.name)
          : origin?.ecosystem === "go-std"
            ? [conventionalName(item.path)]
            : plausibleNames(item.path);
      }
      if (!names.includes(qualifier)) continue;
      origin ??= this.origin(info, item.path);
      const entry = info.imports.get(qualifier);
      // A binder that is or may be checkout code: not a library at all.
      if (
        !origin ||
        this.importTargets(info, item.path).pkgs.length ||
        (entry && entry.path === item.path && (entry.uncertain || entry.failed))
      )
        return undefined;
      if (!bound.some((other) => other.path === item.path))
        bound.push({ path: item.path, origin });
    }
    return bound.length ? bound : undefined;
  }

  private libraryTarget(
    origin: LibraryOrigin,
    unit: string,
    symbol: string | undefined,
    evidence: LibraryTarget["evidence"],
  ): LibraryTarget {
    return {
      ecosystem: origin.ecosystem,
      unit,
      ...(symbol === undefined ? {} : { symbol }),
      ...(origin.version !== undefined && origin.versionSource !== undefined
        ? { version: origin.version, versionSource: origin.versionSource }
        : {}),
      evidence,
    };
  }

  /**
   * What the source proves about a link into a library: an import's unit
   * (`import-path`); a builtin call no declaration shadows
   * (`declared-builtin`, unit `builtin`); or an exported name selected from
   * a library package's qualifier, as a call, value or type
   * (`import-binding`). A member selected on a value of a library type is
   * not: its declaring owner may be promoted from an embedded type, which
   * only the library's source shows.
   */
  private libraryOf(
    link: GraphLink,
  ): LibraryTarget | LibraryTarget[] | undefined {
    const info = this.files.get(link.file);
    if (!info) return undefined;
    const data = (link.data ?? {}) as {
      expr?: Desc;
      t?: TypeRef;
      path?: string;
      builtinName?: boolean;
    };
    if (link.kind === "imports") {
      if (!data.path) return undefined;
      const origin = this.origin(info, data.path);
      return origin
        ? this.libraryTarget(origin, data.path, undefined, "import-path")
        : undefined;
    }
    if (
      link.kind === "calls" &&
      data.builtinName &&
      data.expr?.k === "name" &&
      data.expr.n === link.targetName &&
      BUILTIN_FUNCTIONS.has(link.targetName) &&
      this.builtins.has(link.id)
    )
      return this.libraryTarget(
        { ecosystem: "go-std" },
        "builtin",
        link.targetName,
        "declared-builtin",
      );
    if (!["calls", "references", "embeds"].includes(link.kind))
      return undefined;
    let qualifier: string;
    let name: string;
    if (data.t) {
      if (!data.t.q || data.t.l !== undefined) return undefined;
      qualifier = data.t.q;
      name = data.t.n;
    } else if (data.expr) {
      const expr = data.expr.k === "inst" ? data.expr.x : data.expr;
      if (expr.k !== "sel" || expr.x.k !== "name") return undefined;
      qualifier = expr.x.n;
      name = expr.n;
    } else return undefined;
    // Another package's unexported name is not accessible.
    if (!exported(name)) return undefined;
    const bound = this.libraryImport(qualifier, info);
    if (!bound) return undefined;
    const targets = bound.map((item) =>
      this.libraryTarget(item.origin, item.path, name, "import-binding"),
    );
    return targets.length === 1 ? targets[0]! : targets;
  }

  /**
   * A member selected on a value whose type is outside the checkout and
   * comes from a library package (`buf.Write` on a `bytes.Buffer`, a field
   * of `os.Stdout`, a method on a library call's result): unresolved, with
   * its reason.
   */
  private libraryMember(link: GraphLink): boolean {
    let desc = (link.data as { expr?: Desc } | undefined)?.expr;
    if (desc?.k === "inst") desc = desc.x;
    if (desc?.k !== "sel") return false;
    const info = this.files.get(link.file);
    if (!info) return false;
    const base = this.denote(staticDesc(desc.x), link.file, 0);
    let type: TypeValue | undefined;
    if (base.e === "value") type = base.type;
    else if (base.e === "external")
      type = { kind: "external", name: base.name };
    else if (base.e === "syms" && !base.syms.every(isTypeSymbol))
      type = this.sameType(
        base.syms.map((symbol) => this.valueType(symbol, 1)),
      );
    if (type?.kind !== "external") return false;
    const name = type.name.replace(/(\(\))+$/, "");
    const dot = name.lastIndexOf(".");
    return dot > 0 && !!this.origin(info, name.slice(0, dot));
  }

  /**
   * The toolchain route's library target (W3-L facts, C-14): a builtin, or
   * the standard-library or dependency object go/types selected. A member
   * gets `declaring-owner` with the declaring named type go/types reports
   * (after promotion); an interface method (dispatch) or a member without a
   * named owner gets none.
   */
  private toolchainLibrary(link: GraphLink): LibraryTarget | undefined {
    const data = link.data as
      | { tc?: ToolchainFact; builtinName?: boolean }
      | undefined;
    const fact = data?.tc;
    if (!fact) return undefined;
    // A method of the predeclared `error` interface (C-17): its owner.
    if (fact.b && fact.l?.[0] === "builtin" && fact.l[1]?.includes("."))
      return this.libraryTarget(
        { ecosystem: "go-std" },
        "builtin",
        fact.l[1],
        "declaring-owner",
      );
    if (fact.b)
      return link.kind === "calls" &&
        data?.builtinName &&
        BUILTIN_FUNCTIONS.has(link.targetName)
        ? this.libraryTarget(
            { ecosystem: "go-std" },
            "builtin",
            link.targetName,
            "declared-builtin",
          )
        : undefined;
    // A method of a standard-library interface is its static callee (C-17):
    // the interface that declares it. Other interfaces' methods are dispatch.
    if (
      !fact.l ||
      (fact.c === "iface" && fact.l[2] !== "std") ||
      fact.c === "typeparam"
    )
      return undefined;
    const [unit, symbol, cls] = fact.l;
    if (!symbol || !unit) return undefined;
    const info = this.files.get(link.file);
    const origin: LibraryOrigin =
      cls === "std"
        ? { ecosystem: "go-std" }
        : ((info && this.origin(info, unit)) ?? { ecosystem: "go" });
    if (origin.ecosystem !== (cls === "std" ? "go-std" : "go"))
      return undefined;
    return this.libraryTarget(
      origin,
      unit,
      symbol,
      symbol.includes(".") ? "declaring-owner" : "import-binding",
    );
  }

  /**
   * Why a set is open, truthfully. `declarations-may-be-unseen` (layer 1) when a
   * member is in a lossy package, or when the set would not be open with no file
   * lossy; `external-implementers-possible` only when
   * it is open even then.
   */
  private reasons(
    link: GraphLink,
    ids: string[],
    open: OpenReason[] | undefined,
  ): OpenReason[] {
    const unseen = "declarations-may-be-unseen" as const;
    const external = "external-implementers-possible" as const;
    const given = open ?? [];
    if (!this.lossyPackages.size) return [...given];
    const lossyMember = ids.some((id) => {
      const symbol = this.symbolsById.get(id);
      return !!symbol && this.lossy(this.pkgOf(symbol));
    });
    // Open for outside implementers only if it still is without the lossy
    // files (the dispatch label "structural only" counts as not).
    if (
      given.includes(external) &&
      !this.shadow().resolveLink(link).open?.includes(external)
    )
      return unique([unseen, ...given.filter((reason) => reason !== external)]);
    return unique(lossyMember ? [...given, unseen] : given);
  }

  private shadowResolver?: GoResolver;
  /** The project without lossy packages (only to name reasons). */
  private shadow(): GoResolver {
    if (!this.shadowResolver) {
      this.shadowResolver = new GoResolver(this.moduleId, this.context, true);
      this.shadowResolver.index();
      this.shadowResolver.implementsLinks([]);
    }
    return this.shadowResolver;
  }

  // ---- indexing ----------------------------------------------------------

  /**
   * Layer 1: files whose package membership cannot be proven, treated exactly
   * like a file without a package clause. Go rejects a directory that mixes
   * package names, but mid-edit (renaming a package file by file) it is routine:
   * - a `_test` package declared by a file that is not a `_test.go` file;
   * - more than one non-`_test` package name among the files with no build
   *   constraint (no `//go:build`, no GOOS/GOARCH suffix), or among files with
   *   the same constraint (they are built together whenever it holds). Which
   *   name is the real one cannot be proven, so every such file is untrusted.
   * A constrained file is not compared with files of another constraint: a
   * `//go:build ignore` generator `package main` beside a library is valid.
   */
  private untrustedMembership(): Set<string> {
    const out = new Set<string>();
    if (this.ignoreLossy) return out;
    const groups = new Map<string, { path: string; name: string }[]>();
    for (const file of this.context.files) {
      if (file.module !== this.moduleId || file.result.status === "failed")
        continue;
      const fact = (
        file.result.data as unknown as { go?: FileFact } | undefined
      )?.go;
      if (fact?.package === undefined) continue;
      if (fact.package.endsWith("_test")) {
        if (!fact.test) out.add(file.path);
        continue;
      }
      const constraint = JSON.stringify([
        fact.build ?? null,
        fact.goos ?? null,
        fact.goarch ?? null,
      ]);
      const key = `${directoryOf(file.path)}\u0000${constraint}`;
      push2(groups, key, { path: file.path, name: fact.package });
    }
    for (const members of groups.values())
      if (new Set(members.map((member) => member.name)).size > 1)
        for (const member of members) out.add(member.path);
    return out;
  }

  /** Directories with a `vendor/` directory holding captured files (C-14). */
  private vendorRoots = new Set<string>();
  /** Directories holding captured files (C-14: test-data package trees). */
  private fileDirectories = new Set<string>();

  private index(): void {
    for (const file of this.context.files) {
      this.fileDirectories.add(directoryOf(file.path));
      const parts = file.path.split("/");
      for (let index = 0; index < parts.length - 1; index++)
        if (parts[index] === "vendor")
          this.vendorRoots.add(parts.slice(0, index).join("/"));
    }
    const untrusted = this.untrustedMembership();
    // Files that failed (a file that cannot be read is not valid code): nothing
    // in them is a target; their directory's packages may hold unseen
    // declarations (layer 1), and links that need them name them as the cause.
    const unknownMembers: { directory: string; test: boolean }[] = [];
    for (const file of this.context.files) {
      if (file.module !== this.moduleId) continue;
      if (file.result.status === "failed") {
        const directory = directoryOf(file.path);
        const test = file.path.endsWith("_test.go");
        push2(this.failedFiles, directory, { path: file.path, test });
        unknownMembers.push({ directory, test });
        continue;
      }
      const data = file.result.data as unknown as { go?: FileFact } | undefined;
      const parsed = data?.go;
      if (!parsed) continue;
      // An untrusted clause (valid code, unprovable membership) counts as no
      // clause: the file joins no package and its directory's packages may hold
      // unseen declarations.
      let fact: FileFact = parsed;
      if (untrusted.has(file.path)) {
        const { package: _package, ...rest } = parsed;
        void _package;
        fact = rest;
        unknownMembers.push({
          directory: directoryOf(file.path),
          test: parsed.test,
        });
      }
      const directory = directoryOf(file.path);
      const info: FileInfo = {
        path: file.path,
        directory,
        fact,
        imports: new Map(),
        dots: [],
      };
      if (fact.package !== undefined) {
        const key = `${directory}\u0000${fact.package}`;
        let pkg = this.pkgs.get(key);
        if (!pkg) {
          pkg = { key, directory, name: fact.package, files: [] };
          const importPath = importPathOf(this.layout, directory);
          if (importPath !== undefined && !fact.package.endsWith("_test"))
            pkg.importPath = importPath;
          this.pkgs.set(key, pkg);
        }
        pkg.files.push(file.path);
        info.pkg = pkg;
      }
      this.files.set(file.path, info);
    }
    // A failed or untrusted file may belong to any package of its directory (an
    // external `_test` package only from a `_test.go` file).
    if (!this.ignoreLossy)
      for (const { directory, test } of unknownMembers)
        for (const pkg of this.pkgs.values())
          if (
            pkg.directory === directory &&
            (test || !pkg.name.endsWith("_test"))
          )
            this.lossyPackages.add(pkg.key);
    // A directory whose every file failed has no package here, but it is still
    // a package at that import path: a lossy placeholder, for reach only.
    if (!this.ignoreLossy)
      for (const directory of this.failedFiles.keys()) {
        if ([...this.pkgs.values()].some((pkg) => pkg.directory === directory))
          continue;
        const pkg: Pkg = {
          key: `${directory}\u0000(failed)`,
          directory,
          name: "(failed)",
          files: [],
        };
        const importPath = importPathOf(this.layout, directory);
        if (importPath !== undefined) pkg.importPath = importPath;
        this.failedOnly.set(pkg.key, pkg);
        this.lossyPackages.add(pkg.key);
      }
    const receiverMethods: {
      pkg: Pkg;
      receiver: string;
      symbol: GraphSymbol;
    }[] = [];
    for (const symbol of this.context.symbols) {
      if (symbol.module !== this.moduleId || !this.files.has(symbol.file))
        continue;
      this.symbolsById.set(symbol.id, symbol);
      if (
        TYPE_KINDS.has(symbol.kind) &&
        (symbol.data as { local?: boolean } | undefined)?.local
      )
        this.localTypes.set(`${symbol.file}\u0000${symbol.identity}`, symbol);
      this.byFileKey.set(`${symbol.file}\u0000${symbol.key}`, symbol);
      const pkg = this.files.get(symbol.file)!.pkg;
      if (!pkg) continue;
      const data = (symbol.data ?? {}) as { receiver?: string; owner?: string };
      if (symbol.kind === "package") pkg.symbol = symbol;
      else if (
        TYPE_KINDS.has(symbol.kind) ||
        symbol.kind === "var" ||
        symbol.kind === "const" ||
        (symbol.kind === "function" && symbol.name !== "init")
      )
        push(this.decls, pkg.key, symbol.name, symbol);
      else if (symbol.kind === "method" && data.receiver !== undefined) {
        // Keyed by the receiver's base type once every declaration is known.
        receiverMethods.push({ pkg, receiver: data.receiver, symbol });
        push2(this.methodsByName, symbol.name, symbol);
      } else if (data.owner !== undefined)
        // Fields and interface methods.
        push2(
          this.members,
          `${pkg.key}\u0000${data.owner}\u0000${symbol.name}`,
          symbol,
        );
    }
    for (const { pkg, receiver, symbol } of receiverMethods) {
      const base = this.receiverBase(pkg, receiver);
      if (base === undefined) this.uncertainMethodSets.add(pkg.key);
      push2(
        this.members,
        `${pkg.key}\u0000${base ?? receiver}\u0000${symbol.name}`,
        symbol,
      );
    }
    for (const link of this.context.links)
      if (link.kind === "embeds" && link.sourceId)
        push2(this.embedsBySource, link.sourceId, link);
    for (const info of this.files.values())
      for (const item of info.fact.imports) {
        const {
          pkgs: targets,
          uncertain,
          failed: cause,
        } = this.importTargets(info, item.path);
        const pkgs = uncertain ? [] : targets;
        const entry: ImportEntry = {
          path: item.path,
          pkgs,
          reach: targets,
          ...(uncertain ? { uncertain: true as const } : {}),
          ...(cause ? { failed: cause } : {}),
        };
        if (item.alias === ".") info.dots.push(entry);
        else if (item.alias === "_") continue;
        else if (item.alias !== undefined) info.imports.set(item.alias, entry);
        else {
          const names = unique([
            ...targets.map((pkg) => pkg.name),
            ...(pkgs.length ? [] : [conventionalName(item.path)]),
          ]);
          for (const name of names) info.imports.set(name, entry);
        }
      }
  }

  /**
   * Go import rules over the snapshot, in the importing file's own module
   * context: the packages the path may be, and whether which one Go uses is
   * uncertain (several possible destinations, not all of them captured: one is
   * outside the project, or a directory has no captured package). Counting the
   * captured candidates is never proof.
   */
  private importMemo = new Map<
    string,
    ReturnType<GoResolver["importTargets"]>
  >();
  private importTargets(
    from: FileInfo,
    path: string,
  ): ReturnType<GoResolver["computeImportTargets"]> {
    // The answer depends on the importing directory (its module) and, for the
    // failed-file cause, on whether the importer is a test file.
    const key = `${from.directory}\u0000${from.fact.test}\u0000${path}`;
    let found = this.importMemo.get(key);
    if (!found)
      this.importMemo.set(key, (found = this.computeImportTargets(from, path)));
    return found;
  }
  private computeImportTargets(
    from: FileInfo,
    path: string,
  ): {
    pkgs: Pkg[];
    uncertain: boolean;
    failed?: string[];
    /** Two modules certainly provide the package: Go rejects the import. */
    ambiguous?: true;
  } {
    // A package under `testdata`, `_x` or `.x` is imported like any other (the
    // go tool skips those directories only when expanding `./...` patterns),
    // and a module may itself sit under one (cli/cli's `.github/…/tool`).
    const { providers } = directoryOfImport(this.layout, from.directory, path);
    if (!providers.length) return { pkgs: [], uncertain: false };
    const parts = path.split("/");
    const internal = parts.lastIndexOf("internal");
    if (internal >= 0) {
      const parent = parts.slice(0, internal).join("/");
      const importer = importPathOf(this.layout, from.directory);
      if (
        importer === undefined ||
        !(
          parent === "" ||
          importer === parent ||
          importer.startsWith(`${parent}/`)
        )
      )
        return { pkgs: [], uncertain: false };
    }
    // A package is there only with a file Go can build ("build constraints
    // exclude all Go files" otherwise); `ignore` is the conventional tag
    // that is never set.
    const found = providers.map((provider) => ({
      provider,
      pkgs: [...this.pkgs.values()].filter(
        (pkg) =>
          provider.directories.includes(pkg.directory) &&
          !pkg.name.endsWith("_test") &&
          pkg.name !== "main" &&
          pkg.files.some((file) => this.buildable(file)),
      ),
    }));
    // Two modules that certainly have the package: an ambiguous import.
    const certain = found.filter(
      (item) =>
        !item.provider.uncertain &&
        item.provider.directories.length === 1 &&
        item.pkgs.length,
    );
    if (certain.length > 1)
      return { pkgs: [], uncertain: false, ambiguous: true };
    const pkgs = unique(found.flatMap((item) => item.pkgs));
    const possible = found.filter(
      (item) => item.pkgs.length || item.provider.uncertain,
    );
    let uncertain: boolean;
    if (possible.length > 1) uncertain = true;
    else {
      // One module: certain unless the package may come from outside, or
      // from one of several replacements of which some are not captured.
      const { provider, pkgs: own } = possible[0] ?? found[0]!;
      const captured = new Set(own.map((pkg) => pkg.directory));
      const count = provider.directories.length + (provider.uncertain ? 1 : 0);
      uncertain =
        count > 1 &&
        (provider.uncertain || captured.size < provider.directories.length);
    }
    // Every file of the package failed (nothing valid there): the import needs
    // code in those files, so it is failed with them as the cause.
    if (!pkgs.length && !providers.some((provider) => provider.uncertain)) {
      const cause = providers
        .flatMap((provider) => provider.directories)
        .flatMap((directory) =>
          this.failedCause(
            directory,
            from.fact.test && from.directory === directory,
          ),
        );
      if (cause.length) return { pkgs, uncertain: false, failed: cause };
    }
    return { pkgs, uncertain };
  }

  private buildableMemo = new Map<string, boolean>();
  /** Can Go build this file in some configuration (`ignore` never set)? */
  private buildable(path: string): boolean {
    let answer = this.buildableMemo.get(path);
    if (answer === undefined) {
      const constraint = this.constraintOf(path);
      answer =
        !constraint ||
        satisfiableAnyTags([
          constraint,
          { k: "not", x: { k: "v", n: "ignore" } },
        ]) !== false;
      this.buildableMemo.set(path, answer);
    }
    return answer;
  }

  private pkgOf(symbol: GraphSymbol): Pkg | undefined {
    return this.files.get(symbol.file)?.pkg;
  }
  /** Declarations in _test.go files are visible only to test files of the same directory. */
  private visible(symbol: GraphSymbol, from: string | undefined): boolean {
    if (from === undefined) return true;
    const declared = this.files.get(symbol.file);
    if (!declared?.fact.test) return true;
    const reader = this.files.get(from);
    return !!reader?.fact.test && reader.directory === declared.directory;
  }
  /** Unexported identifiers are distinct per package: only accessible from their own. */
  private accessible(symbol: GraphSymbol, access: string | undefined): boolean {
    return exported(symbol.name) || this.pkgOf(symbol)?.key === access;
  }

  // ---- names and types ---------------------------------------------------

  private packageDecl(pkg: Pkg, name: string, from: string): GraphSymbol[] {
    return (this.decls.get(pkg.key)?.get(name) ?? []).filter((symbol) =>
      this.visible(symbol, from),
    );
  }

  /**
   * A package has two builds. In the test build a package-level declaration in
   * an in-package `_test.go` file shadows the universe (and anything outside the
   * package block) for every file of the package. So a non-test file's reading
   * of such a name differs between the builds: unknown. The external `_test`
   * package is a different package and shares no scope.
   */
  private testShadowed(info: FileInfo, name: string): boolean {
    if (!info.pkg || info.fact.test) return false;
    return (this.decls.get(info.pkg.key)?.get(name) ?? []).some(
      (symbol) => this.files.get(symbol.file)?.fact.test,
    );
  }

  /**
   * The defined type a method's receiver names: the receiver itself, or, for an
   * alias (`type A = T; func (A) M()` declares T's M), the end of its chain of
   * same-package aliases. Undefined when it cannot be followed exactly (an alias
   * of a pointer, of another package's type, a cycle, build variants).
   */
  private receiverBase(pkg: Pkg, receiver: string): string | undefined {
    const seen = new Set<string>();
    let current = receiver;
    for (;;) {
      const types = (this.decls.get(pkg.key)?.get(current) ?? []).filter(
        isTypeSymbol,
      );
      if (!types.some((symbol) => symbol.kind === "alias")) return current;
      if (types.length !== 1 || seen.has(current)) return undefined;
      seen.add(current);
      const target = (types[0]!.data as { target?: TypeTerm } | undefined)
        ?.target;
      if (
        target?.k !== "n" ||
        target.q !== undefined ||
        target.p ||
        target.a?.length
      )
        return undefined;
      current = target.n;
    }
  }

  /** Packages with a method on an alias receiver that could not be followed. */
  private uncertainMethodSets = new Set<string>();

  /**
   * Failed files of a directory that a reader can see: a non-test reader only
   * the non-test ones; a test file all of them. Sorted.
   */
  private failedCause(directory: string, test: boolean): string[] {
    if (this.ignoreLossy) return [];
    return (this.failedFiles.get(directory) ?? [])
      .filter((file) => test || !file.test)
      .map((file) => file.path)
      .sort();
  }

  /** Layer 1: the package may hold declarations no parse tree shows. */
  private lossy(pkg: Pkg | undefined): boolean {
    return !!pkg && this.lossyPackages.has(pkg.key);
  }

  /**
   * The one package-level lookup (unqualified, qualified, dot-imported and
   * universe names all go through it): `name` in the package block of `pkgs`, as
   * the file `reader` sees it. The valid declarations; or, when there are none,
   * the failed files that could have declared it (a link that needs them fails
   * with them as its cause). Those are each directory's failed non-test files,
   * and its failed `_test.go` files when the test build of the reader's own
   * directory includes them: the reader is a test file there, or the name is a
   * universe name (a test-file declaration shadows it for every file of the
   * package).
   */
  private scopeLookup(
    pkgs: Pkg[],
    name: string,
    reader: FileInfo,
    exportedOnly: boolean,
  ): { syms: GraphSymbol[]; cause: string[] } {
    if (exportedOnly && !exported(name)) return { syms: [], cause: [] };
    const syms = pkgs.flatMap((pkg) =>
      this.packageDecl(pkg, name, reader.path),
    );
    if (syms.length) return { syms, cause: [] };
    const universe =
      PREDECLARED_TYPES.has(name) ||
      PREDECLARED_VALUES.has(name) ||
      BUILTIN_FUNCTIONS.has(name);
    const cause = unique(
      pkgs.flatMap((pkg) =>
        this.failedCause(
          pkg.directory,
          pkg.directory === reader.directory && (reader.fact.test || universe),
        ),
      ),
    ).sort();
    return { syms: [], cause };
  }

  private lookupName(name: string, from: string): Entity {
    const info = this.files.get(from);
    if (!info) return NONE;
    // An intact package-level declaration: a second one would not compile.
    const own = info.pkg
      ? this.scopeLookup([info.pkg], name, info, false)
      : { syms: [], cause: [] };
    if (own.syms.length) return { e: "syms", syms: own.syms };
    // A file-block import cannot share a name with a package-level declaration.
    const imported = info.imports.get(name);
    if (imported?.failed) return { e: "unknown", cause: imported.failed };
    if (imported) return { e: "pkg", pkgs: imported.pkgs, path: imported.path };
    // A failed file of the package could have declared it (a universe name too).
    if (own.cause.length) return { e: "unknown", cause: own.cause };
    // Anything else (dot-import, builtin, predeclared, or nothing) an unseen
    // declaration of a lossy package could shadow; or, read by a non-test file, a
    // declaration in a same-package `_test.go` file shadows in the test build.
    if (this.lossy(info.pkg) || this.testShadowed(info, name)) return UNSEEN;
    const dotted: GraphSymbol[] = [];
    const cause: string[] = [];
    let externalDot = false;
    for (const dot of info.dots) {
      if (dot.failed) cause.push(...dot.failed);
      if (!dot.pkgs.length) externalDot = true;
      const found = this.scopeLookup(dot.pkgs, name, info, true);
      dotted.push(...found.syms);
      cause.push(...found.cause);
    }
    if (dotted.length) return { e: "syms", syms: dotted };
    if (cause.length) return { e: "unknown", cause: unique(cause).sort() };
    // A dot-imported external package may declare it.
    return externalDot && exported(name) ? { e: "external", name } : NONE;
  }

  private typeFromRef(ref: TypeRef, from: string, depth: number): TypeValue {
    if (depth > MAX_DEPTH) return this.cut(UNKNOWN);
    if (ref.l !== undefined) {
      // A function-local type: its symbol in the same file (scope resolved at parse).
      const local = this.localTypes.get(`${from}\u0000${ref.l}`);
      return local ? this.typeSyms([local], depth + 1) : UNKNOWN;
    }
    if (ref.q === "") {
      // A predeclared type name, unless a package declaration shadows it.
      const declared = this.lookupName(ref.n, from);
      if (declared.e === "syms" && declared.syms.every(isTypeSymbol))
        return this.typeSyms(declared.syms, depth + 1);
      if (declared.e === "unknown" && declared.cause)
        return { kind: "failed", cause: declared.cause };
      return declared.e === "unknown"
        ? { kind: "external", name: ref.n, shadowable: true }
        : declared.e === "none" && ref.n === "error"
          ? {
              kind: "external",
              name: ref.n,
              std: { k: "named", pkg: "builtin", name: "error" },
            }
          : { kind: "external", name: ref.n };
    }
    const key = `${from}\u0000${ref.q ?? ""}\u0000${ref.n}`;
    const cached = this.memo.get(key);
    if (cached) return cached;
    const cutoffs = this.cutoffs;
    let value: TypeValue = UNKNOWN;
    if (depth >= MAX_DEPTH) this.cutoffs++;
    else {
      if (ref.q !== undefined) {
        const base = this.lookupName(ref.q, from);
        // A qualifier that is no project import can only be an external import
        // (a valid file's imports are all known).
        const std = this.stdTypeNamed(ref.q, ref.n, from);
        if (base.e === "none" || base.e === "external")
          value = {
            kind: "external",
            name: `${ref.q}.${ref.n}`,
            ...(std && base.e === "none" ? { std } : {}),
          };
        else if (base.e === "unknown" && base.cause)
          value = { kind: "failed", cause: base.cause };
        else if (base.e === "pkg") {
          const reader = this.files.get(from);
          const found = reader
            ? this.scopeLookup(base.pkgs, ref.n, reader, true)
            : { syms: [], cause: [] };
          value = !base.pkgs.length
            ? {
                kind: "external",
                name: `${base.path}.${ref.n}`,
                ...(std ? { std } : {}),
              }
            : found.cause.length
              ? { kind: "failed", cause: found.cause }
              : this.typeSyms(found.syms, depth);
        }
      } else {
        const found = this.lookupName(ref.n, from);
        if (found.e === "syms") value = this.typeSyms(found.syms, depth);
        else if (found.e === "external")
          value = { kind: "external", name: ref.n };
        else if (found.e === "unknown" && found.cause)
          value = { kind: "failed", cause: found.cause };
      }
    }
    // An answer cut short by the depth limit is not this name's type: not kept.
    if (this.cutoffs === cutoffs) this.memo.set(key, value);
    return value;
  }

  /** Aliases being followed: a cycle (`type A = B; type B = A`) is unknown. */
  private aliasesFollowed = new Set<string>();
  /** Follows aliases; non-type symbols give an unknown type. */
  private typeSyms(syms: GraphSymbol[], depth: number): TypeValue {
    if (depth > MAX_DEPTH) return this.cut(UNKNOWN);
    const out: GraphSymbol[] = [];
    for (const symbol of syms) {
      if (!TYPE_KINDS.has(symbol.kind)) return UNKNOWN;
      if (
        symbol.kind === "alias" &&
        (symbol.data as { shape?: string } | undefined)?.shape
      ) {
        out.push(symbol); // an alias of a struct/interface literal
        continue;
      }
      if (symbol.kind === "alias") {
        const data = (symbol.data ?? {}) as {
          underlying?: TypeRef;
          underlyingPointer?: boolean;
        };
        // `type A = *T`: a value of A is a *T, whose method calls resolve on T
        // (pointer method sets are kept where they matter: embedding, through
        // `aliasPointer`, and defined types over A, which are unknown in `view`).
        if (!data.underlying) return UNKNOWN;
        // A cycle on this route: unknown here, not necessarily on another.
        if (this.aliasesFollowed.has(symbol.id)) return this.cut(UNKNOWN);
        this.aliasesFollowed.add(symbol.id);
        let target: TypeValue;
        try {
          target = this.typeFromRef(data.underlying, symbol.file, depth + 1);
        } finally {
          this.aliasesFollowed.delete(symbol.id);
        }
        if (target.kind !== "project")
          return syms.length > 1
            ? this.variantsStd(target, syms, depth)
            : target;
        out.push(...target.syms);
      } else out.push(symbol);
    }
    return out.length ? { kind: "project", syms: unique(out) } : UNKNOWN;
  }

  /**
   * A type name declared in several build variants, one of which is an alias
   * of an external type (C-17): the standard-library type only when every
   * variant is an alias of that same standard-library type; otherwise the
   * value keeps no standard-library type (its members stay unresolved).
   * Other decisions see the first alias's external target, as before.
   */
  private variantsStd(
    target: TypeValue,
    syms: GraphSymbol[],
    depth: number,
  ): TypeValue {
    if (target.kind !== "external" || !target.std) return target;
    const std = JSON.stringify(target.std);
    const agree = syms.every((symbol) => {
      const data = (symbol.data ?? {}) as {
        underlying?: TypeRef;
        shape?: string;
      };
      if (symbol.kind !== "alias" || data.shape || !data.underlying)
        return false;
      const other = this.typeFromRef(data.underlying, symbol.file, depth + 1);
      return other.kind === "external" && JSON.stringify(other.std) === std;
    });
    if (agree) return target;
    const { std: _dropped, ...rest } = target;
    void _dropped;
    return rest;
  }

  /** The type of a value description evaluated in `file`. */
  private typeOf(desc: Desc, file: string, depth: number): TypeValue {
    const entity = this.denote(staticDesc(desc), file, depth + 1);
    if (entity.e === "value") return entity.type;
    if (entity.e === "external") return externalValue(entity);
    if (entity.e === "unknown" && entity.cause)
      return { kind: "failed", cause: entity.cause };
    if (entity.e === "syms")
      return this.sameType(
        entity.syms.map((symbol) => this.valueType(symbol, depth + 1)),
      );
    return UNKNOWN;
  }

  /** Type of a variable, constant or field symbol, evaluated in its own file. */
  private valueType(symbol: GraphSymbol, depth: number): TypeValue {
    if (depth > MAX_DEPTH) return this.cut(UNKNOWN);
    const data = (symbol.data ?? {}) as { d?: Desc; t?: TypeRef; v?: Desc };
    if (symbol.kind === "field") {
      if (data.v) return this.typeOf(data.v, symbol.file, depth + 1);
      if (data.t) return this.typeFromRef(data.t, symbol.file, depth + 1);
    }
    if ((symbol.kind === "var" || symbol.kind === "const") && data.d)
      return this.typeOf(data.d, symbol.file, depth + 1);
    if (TYPE_KINDS.has(symbol.kind)) return UNKNOWN;
    return UNKNOWN;
  }

  private sameType(values: TypeValue[]): TypeValue {
    if (!values.length) return UNKNOWN;
    // Any alternative that needs a failed file makes the whole value fail.
    const failed = values.flatMap((value) =>
      value.kind === "failed" ? value.cause : [],
    );
    if (failed.length) return { kind: "failed", cause: unique(failed).sort() };
    if (values.length === 1) return values[0]!;
    const keyOf = (value: TypeValue) =>
      value.kind === "project"
        ? value.syms
            .map((symbol) => symbol.id)
            .sort()
            .join(",")
        : value.kind === "external"
          ? `x:${value.name}`
          : `${value.kind}:${JSON.stringify(value)}`;
    const first = keyOf(values[0]!);
    if (!values.every((value) => keyOf(value) === first)) return UNKNOWN;
    // The same external name: its standard-library type only when every
    // alternative proves the same one (C-17).
    const head = values[0]!;
    if (head.kind === "external" && head.std) {
      const std = JSON.stringify(head.std);
      if (
        !values.every(
          (value) =>
            value.kind === "external" && JSON.stringify(value.std) === std,
        )
      ) {
        const { std: _dropped, ...rest } = head;
        void _dropped;
        return rest;
      }
    }
    return head;
  }

  /** What an expression denotes: a package, declarations, an external thing, or a typed value. */
  private denote(desc: Desc, from: string, depth: number): Entity {
    if (depth > MAX_DEPTH) return this.cut(NONE);
    switch (desc.k) {
      case "name":
        return this.lookupName(desc.n, from);
      case "val":
        return { e: "value", type: this.typeFromRef(desc.t, from, depth + 1) };
      case "cont":
        return {
          e: "value",
          type: {
            kind: "cont",
            e: desc.e,
            ...(desc.key ? { key: desc.key } : {}),
            ...(desc.ch ? { ch: true } : {}),
            file: from,
          },
        };
      case "func":
        return { e: "value", type: { kind: "func", r: desc.r, file: from } };
      case "tval":
        return {
          e: "value",
          type: desc.c
            ? { kind: "tparam", c: desc.c, file: from }
            : { kind: "tparam", file: from },
        };
      case "opaque":
        return { e: "value", type: OPAQUE };
      case "local":
        // An anonymous struct: its own local struct symbol (in this file).
        return desc.sym !== undefined
          ? {
              e: "value",
              type: this.typeFromRef(
                { n: desc.sym, l: desc.sym },
                from,
                depth + 1,
              ),
            }
          : { e: "value", type: UNKNOWN };
      case "elem":
      case "key": {
        let container = this.typeOf(desc.x, from, depth + 1);
        // A defined type over a container literal (`type R map[string][]T`).
        if (container.kind === "project")
          container = this.underlyingContainer(container.syms, depth + 1);
        if (container.kind === "external") {
          // A standard-library slice, array, map or channel (C-17): its
          // element or key; anything else keeps no standard-library type.
          const { std, ...rest } = container;
          const item = std && stdItem(std, desc.k === "key");
          return { e: "value", type: item ? { ...rest, std: item } : rest };
        }
        if (container.kind === "failed") return { e: "value", type: container };
        if (container.kind === "cont") {
          // A single range variable over a channel is its element.
          const item =
            desc.k === "key" && !container.ch ? container.key : container.e;
          if (item)
            return {
              e: "value",
              type: this.typeOf(item, container.file, depth + 1),
            };
          // The key of a slice, array or string is an int.
          return { e: "value", type: { kind: "external", name: "int" } };
        }
        return { e: "value", type: UNKNOWN };
      }
      case "var": {
        // The declaration fixes the static type; a func value's identity needs every write.
        const declared = this.denote(desc.d, from, depth + 1);
        if (declared.e !== "syms" || declared.syms.every(isTypeSymbol))
          return declared;
        if (!desc.alts) return NONE;
        const syms: GraphSymbol[] = [];
        for (const alt of desc.alts) {
          const value = this.denote(alt, from, depth + 1);
          if (value.e !== "syms") return NONE;
          syms.push(...value.syms);
        }
        return { e: "syms", syms: unique(syms) };
      }
      case "call":
        return { e: "value", type: this.callResult(desc, from, depth) };
      case "inst": {
        // Only a generic function is called through `x[…]`; an element of a
        // map/slice/array of funcs is a value whose identity is not tracked.
        const base = this.denote(desc.x, from, depth + 1);
        return base.e === "syms" &&
          base.syms.every(
            (symbol) => symbol.kind === "function" || symbol.kind === "method",
          )
          ? base
          : NONE;
      }
      case "sel":
        return this.select(desc, from, depth);
      case "unknown": {
        // A call whose callee is not described (`(*p.T)(x)`, `(<-fc)()`):
        // the value of calling what is written, as the backstop reads it.
        if (desc.m?.length !== 1) return { e: "value", type: UNKNOWN };
        const written = desc.m[0]!;
        if (desc.p !== undefined) {
          // A conversion `(*T)(x)` is a `*T`: its members are T's. Under more
          // than one `*`, or when T is itself a pointer type (`type A = *T`,
          // `type P *T`), the value has no members to follow.
          const named = this.denote(written, from, depth + 1);
          if (named.e === "syms" && named.syms.every(isTypeSymbol))
            return {
              e: "value",
              type:
                desc.p === 1 && !this.pointerTypeName(written, named.syms, from)
                  ? this.typeSyms(named.syms, depth + 1)
                  : UNKNOWN,
            };
        }
        return this.denote({ k: "call", f: written, i: 0 }, from, depth + 1);
      }
      default:
        return { e: "value", type: UNKNOWN };
    }
  }

  /**
   * The container a value of these named types is, for its elements and keys:
   * a defined type written as a container literal (`type R []T`), or over
   * another named type that is one (`type S R`). Build variants must agree.
   * Anything else (a struct, an interface, an external underlying type that is
   * not proved a container) is unknown.
   */
  private underlyingContainer(syms: GraphSymbol[], depth: number): TypeValue {
    if (depth > MAX_DEPTH) return this.cut(UNKNOWN);
    return this.sameType(
      syms.map((symbol) => {
        if (symbol.kind !== "type") return UNKNOWN;
        const data = (symbol.data ?? {}) as { v?: Desc; underlying?: TypeRef };
        if (data.v?.k === "cont")
          return this.typeOf(data.v, symbol.file, depth + 1);
        if (!data.underlying) return UNKNOWN;
        const next = this.typeFromRef(data.underlying, symbol.file, depth + 1);
        return next.kind === "project"
          ? this.underlyingContainer(next.syms, depth + 1)
          : next.kind === "failed"
            ? next
            : UNKNOWN;
      }),
    );
  }

  private callResult(
    desc: Extract<Desc, { k: "call" }>,
    from: string,
    depth: number,
  ): TypeValue {
    const callee = this.denote(desc.f, from, depth + 1);
    if (callee.e === "external") {
      // A standard-library function's or method's result, or a conversion
      // to a standard-library type (C-17).
      const std =
        callee.std?.t === "func"
          ? callee.std.results[desc.i]
          : callee.std?.t === "type" && desc.i === 0
            ? callee.std.type
            : undefined;
      return {
        kind: "external",
        name: `${callee.name}()`,
        ...(std && std.k !== "unknown" ? { std } : {}),
      };
    }
    if (callee.e === "unknown" && callee.cause)
      return { kind: "failed", cause: callee.cause };
    // The builtin itself (no declaration shadows the name): its evident result.
    if (callee.e === "none")
      return desc.b ? this.typeOf(desc.b, from, depth + 1) : UNKNOWN;
    if (callee.e === "value")
      return this.funcResult(callee.type, desc.i, depth);
    if (callee.e !== "syms") return UNKNOWN;
    if (callee.syms.every(isTypeSymbol))
      return this.typeSyms(callee.syms, depth + 1);
    const callees = this.calledVariants(callee.syms, from);
    if (!callees) return UNKNOWN;
    const results = callees.map((symbol) => {
      if (symbol.kind === "function" || symbol.kind === "method") {
        const data = (symbol.data ?? {}) as { results?: Desc[] };
        const result = data.results?.[desc.i];
        return result ? this.typeOf(result, symbol.file, depth + 1) : UNKNOWN;
      }
      // A func-typed variable or field.
      return this.funcResult(this.valueType(symbol, depth + 1), desc.i, depth);
    });
    return this.sameType(results);
  }

  /**
   * The declarations a call of a name declared in several build variants can
   * reach from `from`: each one that is the only declaration of the name in
   * some build of `from` (two in one build do not compile), every name a free
   * tag (`-tags=freebsd` on Linux), so false is proof. Undefined unless some
   * declaration is built in every ordinary build of `from` (a real port,
   * real cgo on or off, any custom tags: one without would not have this
   * call) and every constraint is readable.
   * The caller's answer is definite only when the results then agree.
   */
  private calledVariants(
    syms: GraphSymbol[],
    from: string,
  ): GraphSymbol[] | undefined {
    // Several declarations of one name in one package are build variants;
    // anything else (the values a reassigned func local may hold) is not.
    const pkg = this.pkgOf(syms[0]!)?.key;
    if (
      syms.length < 2 ||
      !syms.every(
        (symbol) =>
          symbol.name === syms[0]!.name && this.pkgOf(symbol)?.key === pkg,
      )
    )
      return syms;
    const key = `${syms
      .map((symbol) => symbol.id)
      .sort()
      .join(",")}\u0000${JSON.stringify(this.constraintOf(from) ?? null)}`;
    if (this.variantMemo.has(key)) return this.variantMemo.get(key);
    const answer = this.computeCalledVariants(syms, from);
    this.variantMemo.set(key, answer);
    return answer;
  }
  private variantMemo = new Map<string, GraphSymbol[] | undefined>();
  private computeCalledVariants(
    syms: GraphSymbol[],
    from: string,
  ): GraphSymbol[] | undefined {
    const caller = this.constraintOf(from);
    const declared = syms.map((symbol) => this.constraintOf(symbol.file));
    if (!caller || declared.some((item) => !item)) return undefined;
    const not = (formula: Formula): Formula => ({ k: "not", x: formula });
    // Coverage counts ordinary builds of the caller only: a build that
    // exists only because a reserved name (a GOOS or GOARCH name, `cgo`) is
    // set by hand, and has no declaration, does not compile there, so no
    // build has another answer (pebble's `manual.New` with `-tags=cgo` and
    // cgo disabled). Which declarations are reached counts every build.
    const covered =
      satisfiableOrdinary([caller, ...declared.map((item) => not(item!))]) ===
      false;
    if (!covered) return undefined;
    const reached = syms.filter(
      (_, index) =>
        satisfiableAnyTags([
          caller,
          declared[index]!,
          ...declared
            .filter((_, other) => other !== index)
            .map((item) => not(item!)),
        ]) !== false,
    );
    return reached.length ? reached : undefined;
  }

  /** Result `i` of calling a value of this type: a literal or a named func type. */
  private funcResult(type: TypeValue, i: number, depth: number): TypeValue {
    if (type.kind === "func") {
      const result = type.r[i];
      return result ? this.typeOf(result, type.file, depth + 1) : UNKNOWN;
    }
    if (type.kind === "project")
      return this.sameType(
        type.syms.map((symbol) => {
          const fn = (symbol.data as { fn?: Desc[] } | undefined)?.fn;
          const result = fn?.[i];
          return result ? this.typeOf(result, symbol.file, depth + 1) : UNKNOWN;
        }),
      );
    return type.kind === "external" || type.kind === "failed" ? type : UNKNOWN;
  }

  /** `fields`: a selected field as its symbol, not its value (the backstop). */
  private select(
    desc: Extract<Desc, { k: "sel" }>,
    from: string,
    depth: number,
    fields = false,
  ): Entity {
    const base = this.denote(staticDesc(desc.x), from, depth + 1);
    if (base.e === "pkg") {
      if (!base.pkgs.length)
        return this.withStd(
          { e: "external", name: `${base.path}.${desc.n}` },
          this.stdQualified(desc, from, base.path),
        );
      const reader = this.files.get(from);
      if (!reader) return NONE;
      // Not among the package's valid files, which has failed files: those are
      // the cause (any of them might have declared it).
      const found = this.scopeLookup(base.pkgs, desc.n, reader, true);
      if (found.cause.length) return { e: "unknown", cause: found.cause };
      return { e: "syms", syms: found.syms };
    }
    if (base.e === "external")
      return this.withStd(
        { e: "external", name: `${base.name}.${desc.n}` },
        base.std?.t === "value"
          ? this.stdSelect(base.std.type, desc.n, from)
          : undefined,
      );
    if (base.e === "unknown") return base.cause ? base : NONE;
    // `q.X` with q neither local nor declared in the package: q can only be one of
    // this file's imports; not a project import, so it is external.
    if (base.e === "none")
      return desc.x.k === "name"
        ? this.withStd(
            { e: "external", name: `${desc.x.n}.${desc.n}` },
            this.stdQualified(desc, from),
          )
        : NONE;
    if (base.e === "syms" && base.syms.every(isTypeSymbol)) {
      // Method expression T.M / (*T).M.
      const type = this.typeSyms(base.syms, depth + 1);
      if (type.kind === "external")
        return { e: "external", name: `${type.name}.${desc.n}` };
      if (type.kind === "failed") return { e: "unknown", cause: type.cause };
      if (type.kind !== "project") return NONE;
      const found = this.selectName(type.syms, desc.n, from);
      if (found.kind === "failed") return { e: "unknown", cause: found.cause };
      return found.kind === "found" ? { e: "syms", syms: found.syms } : NONE;
    }
    const type =
      base.e === "value"
        ? base.type
        : this.sameType(
            base.syms.map((symbol) => this.valueType(symbol, depth + 1)),
          );
    if (type.kind === "external")
      return this.withStd(
        { e: "external", name: `${type.name}.${desc.n}` },
        type.std ? this.stdSelect(type.std, desc.n, from) : undefined,
      );
    if (type.kind === "failed") return { e: "unknown", cause: type.cause };
    if (type.kind !== "project") return NONE;
    const found = this.selectName(type.syms, desc.n, from);
    if (found.kind === "failed") return { e: "unknown", cause: found.cause };
    if (found.kind !== "found") return NONE;
    if (!fields && found.syms.every((symbol) => symbol.kind === "field"))
      return {
        e: "value",
        type: this.sameType(
          found.syms.map((symbol) => this.valueType(symbol, depth + 1)),
        ),
      };
    return { e: "syms", syms: found.syms };
  }

  // ---- Go's selector rule ------------------------------------------------

  private embedded(
    type: GraphSymbol,
  ): { value: TypeValue; pointer: boolean; key: string }[] {
    return (this.embedsBySource.get(type.id) ?? []).map((link) => {
      const data = (link.data ?? {}) as { t?: TypeRef; pointer?: boolean };
      const value = data.t ? this.typeFromRef(data.t, link.file, 1) : UNKNOWN;
      // Embedding an alias of a pointer (`type B = A; type A = *T`) embeds *T.
      const pointer =
        !!data.pointer || (!!data.t && this.aliasPointer(data.t, link.file));
      const key =
        value.kind === "project"
          ? value.syms
              .map((symbol) => symbol.id)
              .sort()
              .join(",")
          : `${value.kind}:${link.file}:${link.range.start}`;
      return { value, pointer, key };
    });
  }

  /**
   * Does this written type name, followed through its chain of aliases, denote
   * a pointer type (`type A = *T`, `type B = A`)? Cycle-safe.
   */
  /** Does this written type name (a name or `q.Name`) denote a pointer type? */
  private pointerTypeName(
    written: Desc,
    syms: GraphSymbol[],
    from: string,
  ): boolean {
    if (
      syms.some(
        (symbol) =>
          (symbol.data as { underlyingPointer?: boolean } | undefined)
            ?.underlyingPointer,
      )
    )
      return true;
    const ref: TypeRef | undefined =
      written.k === "name"
        ? { n: written.n }
        : written.k === "sel" && written.x.k === "name"
          ? { q: written.x.n, n: written.n }
          : undefined;
    // Not a name the alias chain can be followed from: not proven otherwise.
    return ref ? this.aliasPointer(ref, from) : true;
  }

  private aliasPointer(ref: TypeRef, from: string): boolean {
    if (ref.l !== undefined || ref.q === "") return false;
    let term: TypeTerm =
      ref.q === undefined
        ? { k: "n", n: ref.n }
        : { k: "n", n: ref.n, q: ref.q };
    let file = from;
    const seen = new Set<string>();
    for (let step = 0; step <= MAX_DEPTH; step++) {
      if (term.k === "ptr") return true;
      if (term.k !== "n") return false;
      const symbol = this.namedDeclaration(term, file);
      if (!symbol || symbol.kind !== "alias" || seen.has(symbol.id))
        return false;
      seen.add(symbol.id);
      const target = (symbol.data as { target?: TypeTerm } | undefined)?.target;
      if (!target) return false;
      term = target;
      file = symbol.file;
    }
    return false;
  }

  private views = new Map<string, View>();
  /**
   * The structure of any project type, used by every consumer (selection and
   * promotion, method sets, `implements`, dispatch, carriers):
   * - an interface (or an alias of an interface literal): its flat method set;
   * - a struct (or an alias of a struct literal, or a function-local/anonymous
   *   struct): its fields and declared methods, and its embedded elements;
   * - a defined type over an interface: that interface's method set;
   * - a defined type over a struct (or another defined type): its own declared
   *   methods, the underlying type's fields and embedded elements (promoted
   *   methods), but not the underlying named type's declared methods;
   * - an alias of a named type: that type's structure.
   * When the structure cannot be determined, `unknown` (`externalOnly` when only an
   * external type is unknown: irrelevant for project packages' unexported names).
   */
  private view(type: GraphSymbol, depth = 0): View {
    const cached = this.views.get(type.id);
    if (cached) return cached;
    const cutoffs = this.cutoffs;
    const data = (type.data ?? {}) as {
      shape?: string;
      underlying?: TypeRef;
      underlyingPointer?: boolean;
    };
    const pkg = this.pkgOf(type);
    // A type declared in several build variants: each declaration has its
    // own fields, and a method belongs to it only when its file can be built
    // with the declaration's file (`buildsWith`).
    const siblings = pkg
      ? (this.decls.get(pkg.key)?.get(type.name) ?? []).filter(isTypeSymbol)
      : [];
    const variants = siblings.length > 1;
    // Two declarations of the type are never in one valid build: a method
    // belongs to this variant only in builds without the others' files.
    const others = siblings
      .filter((symbol) => symbol.id !== type.id)
      .map((symbol) => symbol.file);
    const all = (name: string) =>
      pkg
        ? (this.members.get(`${pkg.key}\u0000${type.name}\u0000${name}`) ?? [])
        : [];
    const own = (name: string) =>
      all(name).filter((symbol) =>
        symbol.kind === "field"
          ? symbol.file === type.file
          : !variants ||
            this.buildsWith(symbol.file, type.file, undefined, others) !==
              false,
      );
    // The methods of this name that may or may not be part of this variant
    // in the referencing file's builds.
    const uncertain = (name: string, from?: string) =>
      variants
        ? own(name).flatMap((method) => {
            if (method.kind === "field") return [];
            const built = this.buildsWith(method.file, type.file, from, others);
            return built === true ? [] : [{ method, built }];
          })
        : [];
    const declared = (name: string) =>
      own(name).filter((symbol) => symbol.kind === "method");
    const unknown = (externalOnly = false): View => ({
      members: declared,
      declared,
      embedded: [],
      unknown: true,
      ...(externalOnly ? { externalOnly: true } : {}),
    });
    let result: View;
    if (depth > MAX_DEPTH) result = this.cut(unknown());
    else if (
      pkg &&
      this.uncertainMethodSets.has(pkg.key) &&
      type.kind !== "interface"
    )
      // A method on an alias receiver that could not be followed: only the
      // type's own declared methods are known.
      result = unknown();
    else if (type.kind === "interface" || data.shape === "interface")
      result = { iface: [type], members: () => [], embedded: [] };
    else if (type.kind === "struct" || data.shape === "struct")
      result = { members: own, embedded: this.embedded(type) };
    else if (type.kind === "alias" || type.kind === "type") {
      if (!data.underlying) result = { members: declared, embedded: [] };
      else if (
        data.underlyingPointer ||
        (type.kind === "type" && this.aliasPointer(data.underlying, type.file))
      )
        result = unknown();
      else {
        const target = this.typeFromRef(data.underlying, type.file, depth + 1);
        // A predeclared basic type (int, string, …) has no fields or promoted
        // methods: only the defined type's own declared methods. `error`, `any` and
        // `comparable` are interfaces, so they stay unknown (external).
        // A predeclared name a declaration may shadow (lossy package, or a
        // same-package `_test.go` file) is not known to be basic.
        if (target.kind === "external" && target.shadowable) result = unknown();
        else if (
          target.kind === "external" &&
          data.underlying.q === "" &&
          !["error", "any", "comparable"].includes(data.underlying.n)
        )
          result = { members: declared, embedded: [] };
        else if (target.kind === "external") result = unknown(true);
        else if (target.kind !== "project") result = unknown();
        else {
          const inner = target.syms.map((symbol) =>
            symbol.id === type.id ? unknown() : this.view(symbol, depth + 1),
          );
          if (inner.some((item) => item.unknown && !item.externalOnly))
            result = unknown();
          else if (inner.every((item) => item.iface))
            result = {
              iface: unique(inner.flatMap((item) => item.iface!)),
              members: () => [],
              embedded: [],
            };
          else if (type.kind === "alias")
            result = {
              members: (name) => inner.flatMap((item) => item.members(name)),
              embedded: inner.flatMap((item) => item.embedded),
              ...(inner.some((item) => item.unknown)
                ? { unknown: true as const, externalOnly: true as const }
                : {}),
            };
          else
            result = {
              members: (name) => [
                ...declared(name),
                ...inner.flatMap((item) =>
                  item
                    .members(name)
                    .filter((symbol) => symbol.kind === "field"),
                ),
              ],
              embedded: inner.flatMap((item) => item.embedded),
              ...(inner.some((item) => item.unknown)
                ? { unknown: true as const, externalOnly: true as const }
                : {}),
            };
        }
      }
    } else result = unknown();
    // Layer 1: in a declaration-lossy package an unseen method may be declared on
    // any named type. Members declared intact on the type itself (depth 0) stay
    // known (a second declaration would not compile); anything else, promoted
    // members included (an unseen depth-0 method could shadow them), is unknown.
    // Interfaces, aliases and function-local types cannot gain methods.
    if (
      this.lossy(pkg) &&
      !result.iface &&
      type.kind !== "alias" &&
      !(type.data as { local?: boolean } | undefined)?.local
    ) {
      const known = result.members;
      result = { members: known, declared: known, embedded: [], unknown: true };
    }
    if (variants && !result.iface) result = { ...result, uncertain };
    if (this.cutoffs === cutoffs) this.views.set(type.id, result);
    return result;
  }

  /**
   * Fields and methods named `name` on project types, by the Go spec: the
   * shallowest embedding depth wins; more than one path at that depth is ambiguous;
   * an external/unknown embedded type at or above that depth makes the answer
   * unknown. Unexported names count only when declared in the accessing package.
   */
  private selectName(
    types: GraphSymbol[],
    name: string,
    from: string | undefined,
    access = from === undefined ? undefined : this.files.get(from)?.pkg?.key,
    ignoreExternal = false,
    std = false,
  ): Selection {
    // An external type can never declare a project package's unexported name, so
    // for unexported names embedded external types are irrelevant.
    const skipExternal = ignoreExternal || !exported(name);
    // With `std` (C-17), an embedded standard-library type is expanded from
    // the table, which depends on the referencing module's `go` directive.
    const stdKey =
      std && !skipExternal ? `s:${this.goDirective(from) ?? "-"}` : "";
    const memoKey = `${stdKey}${skipExternal ? "x" : ""}${types
      .map((type) => type.id)
      .sort()
      .join(
        ",",
      )}\u0000${name}\u0000${access ?? ""}\u0000${from === undefined ? "" : this.files.get(from)?.fact.test ? `t:${directoryOf(from)}` : "n"}\u0000${from === undefined ? "" : JSON.stringify(this.constraintOf(from) ?? null)}`;
    const cached = this.selections.get(memoKey);
    if (cached) return cached;
    // A type declared in several build variants is a different type in each
    // configuration: search each choice of variant separately (choosing only
    // when a variant set is reached), and agree only on what they all find.
    const results: Selection[] = [];
    const pending: Map<string, number>[] = [new Map()];
    let runs = 0;
    let result: Selection | undefined;
    while (pending.length) {
      if (++runs > MAX_VARIANT_RUNS) {
        result = { kind: "unknown" };
        break;
      }
      const choice = pending.pop()!;
      const run = this.selectIn(
        types,
        name,
        from,
        access,
        skipExternal,
        choice,
        !!stdKey,
      );
      if ("group" in run)
        for (let index = run.size - 1; index >= 0; index--)
          pending.push(new Map(choice).set(run.group, index));
      else results.push(run);
    }
    result ??= combineVariants(results);
    this.selections.set(memoKey, result);
    return result;
  }

  /**
   * Go's selector rule for one choice of build variant per variant set
   * (`choice`, keyed by the set). A variant set without a choice stops the
   * search and is returned (`group`, with its size) for the caller to choose.
   */
  private selectIn(
    types: GraphSymbol[],
    name: string,
    from: string | undefined,
    access: string | undefined,
    skipExternal: boolean,
    choice: Map<string, number>,
    std = false,
  ): Selection | { group: string; size: number } {
    let unchosen: { group: string; size: number } | undefined;
    const pick = (set: GraphSymbol[]): GraphSymbol[] => {
      // Only the variants that can be built with the referencing file; one
      // that every build of it includes is the only one (two declarations of
      // a name are never in one valid build).
      const buildable =
        from === undefined
          ? set
          : set.filter((type) => this.buildTogether(from, type.file) !== false);
      const included =
        from === undefined
          ? []
          : buildable.filter((type) => this.includedWith(from, type.file));
      // Declared in the referencing file itself: that declaration.
      const own = buildable.filter((type) => type.file === from);
      if (own.length === 1) return own;
      if (included.length === 1) return included;
      const variants = unique(buildable.length ? buildable : set).sort(
        (a, b) => compareText(a.file, b.file) || compareText(a.id, b.id),
      );
      if (variants.length < 2) return variants;
      const group = variants.map((symbol) => symbol.id).join(",");
      const index = choice.get(group);
      if (index === undefined) {
        unchosen ??= { group, size: variants.length };
        return [];
      }
      return [variants[index]!];
    };
    let level: { types: GraphSymbol[]; pointer: boolean; path: string[] }[] = [
      { types: pick(types), pointer: false, path: [] },
    ];
    if (unchosen) return unchosen;
    let externalAt: number | undefined;
    let result: Selection = { kind: "none" };
    const causes: string[] = [];
    const reader = from === undefined ? undefined : this.files.get(from);
    // Members of embedded standard-library types (C-17, with `std`), at the
    // depth where they occur.
    const library: { at: number; member: StdMember }[] = [];
    for (
      let depth = 0;
      level.length || library.some((item) => item.at >= depth);
      depth++
    ) {
      if (
        depth > MAX_EMBED_DEPTH ||
        level.length > MAX_EMBED_PATHS ||
        (externalAt !== undefined && externalAt <= depth)
      ) {
        result = { kind: "unknown" };
        break;
      }
      const occurrences: { syms: GraphSymbol[]; pointer: boolean }[] = [];
      const next: typeof level = [];
      for (const node of level) {
        const views = node.types.map((type) => this.view(type));
        // A structure that cannot be determined: its members at this depth are unknown.
        views.forEach((item, index) => {
          if (
            item.unknown &&
            !(item.externalOnly && skipExternal) &&
            // A method declared on the type itself is known at this depth.
            !item.declared?.(name).length &&
            // Another package's unexported name can only come from a type whose
            // package can reach that package.
            (exported(name) ||
              access === undefined ||
              this.mayReach(this.pkgOf(node.types[index]!)?.key, access))
          ) {
            externalAt = Math.min(externalAt ?? depth, depth);
            // Unknown because its package has failed files: they are the cause.
            const pkg = this.pkgOf(node.types[index]!);
            if (pkg && reader)
              causes.push(
                ...this.failedCause(
                  pkg.directory,
                  pkg.directory === reader.directory && reader.fact.test,
                ),
              );
          }
        });
        // A method never built with this variant in the referencing file's
        // builds is absent; one that may or may not be is one more choice of
        // configuration (present or absent).
        const absent = new Set<string>();
        for (const view of views)
          for (const { method, built } of view.uncertain?.(name, from) ?? []) {
            if (built === false) {
              absent.add(method.id);
              continue;
            }
            const group = `method:${method.id}`;
            const index = choice.get(group);
            if (index === undefined) unchosen ??= { group, size: 2 };
            else if (index === 1) absent.add(method.id);
          }
        if (unchosen) return unchosen;
        const found: GraphSymbol[] = [];
        // Interfaces: a flat method set; identical methods inherited along several
        // paths merge, so it is one occurrence and is not expanded further.
        const ifaces = unique(views.flatMap((item) => item.iface ?? []));
        if (ifaces.length) {
          const flat = this.interfaceMember(
            ifaces,
            name,
            from,
            access,
            [],
            skipExternal,
          );
          // A project declaration of the name is the method even if an embedded
          // external interface also has it (identical methods merge).
          if (flat.syms.length) found.push(...flat.syms);
          else if (flat.unknown)
            externalAt = Math.min(externalAt ?? depth, depth);
        }
        const structural = views.filter((item) => !item.iface);
        found.push(
          ...structural
            .flatMap((item) => item.members(name))
            .filter(
              (symbol) =>
                !absent.has(symbol.id) &&
                this.visible(symbol, from) &&
                this.accessible(symbol, access),
            ),
        );
        if (found.length)
          occurrences.push({ syms: unique(found), pointer: node.pointer });
        const seen = new Set<string>();
        for (const item of structural.flatMap((view) => view.embedded)) {
          if (seen.has(item.key)) continue; // same embedding in build variants
          seen.add(item.key);
          if (item.value.kind !== "project") {
            if (item.value.kind === "failed") causes.push(...item.value.cause);
            // A standard-library type the table knows: its member of this
            // name, none, or unknown from the depth an uncertain one is at.
            const embedded =
              std &&
              item.value.kind === "external" &&
              !item.value.shadowable &&
              item.value.std
                ? this.stdEmbedded(item.value.std, name, from)
                : undefined;
            if (embedded) {
              if ("member" in embedded)
                library.push({
                  at: depth + 1 + embedded.member.depth,
                  member: embedded.member,
                });
              else if (embedded.unknownAt !== undefined)
                externalAt = Math.min(
                  externalAt ?? Infinity,
                  depth + 1 + embedded.unknownAt,
                );
              continue;
            }
            // An external type cannot declare a project package's unexported name;
            // an unresolvable one could be anything.
            if (
              !(
                item.value.kind === "external" &&
                !item.value.shadowable &&
                skipExternal
              )
            )
              externalAt ??= depth + 1;
            continue;
          }
          const ids = item.value.syms.map((symbol) => symbol.id);
          if (ids.some((id) => node.path.includes(id))) continue; // embedding cycle
          next.push({
            types: pick(item.value.syms),
            pointer: node.pointer || item.pointer,
            path: [...node.path, ...ids],
          });
        }
      }
      if (externalAt !== undefined && externalAt <= depth) {
        result = { kind: "unknown" };
        break;
      }
      const here = library.filter((item) => item.at === depth);
      if (here.length) {
        // Alone at the shallowest depth: that member; with another
        // occurrence (ambiguous in Go), not represented: unknown.
        result =
          here.length === 1 && !occurrences.length
            ? { kind: "library", member: here[0]!.member }
            : { kind: "unknown" };
        break;
      }
      // A variant set at the next depth matters only if nothing is found here.
      if (unchosen && !occurrences.length) return unchosen;
      if (occurrences.length === 1) {
        result = { kind: "found", ...occurrences[0]! };
        break;
      }
      if (occurrences.length > 1) {
        result = {
          kind: "ambiguous",
          syms: unique(occurrences.flatMap((item) => item.syms)),
        };
        break;
      }
      level = next;
    }
    if (result.kind === "none" && externalAt !== undefined)
      result = { kind: "unknown" };
    // Unknown because of code in failed files: the selection fails with them.
    if (result.kind === "unknown" && causes.length)
      result = { kind: "failed", cause: unique(causes).sort() };
    return result;
  }

  private constraints = new Map<string, Formula | undefined>();
  /** A file's build constraint (TRUE: none); undefined when not readable. */
  private constraintOf(path: string): Formula | undefined {
    if (!this.constraints.has(path)) {
      const info = this.files.get(path);
      const formula = info ? fileConstraint(info.fact) : undefined;
      this.constraints.set(
        path,
        formula && info ? this.releaseFloor(formula, info.directory) : formula,
      );
    }
    return this.constraints.get(path);
  }
  /**
   * Since Go 1.21 a toolchain builds a module only when it is at least the
   * module's `go` version, so every build of its files has the release tags
   * up to that version (a release tag set by hand with `-tags` adds to them,
   * it never removes one). Added for the release tags the constraint names.
   */
  private releaseFloor(formula: Formula, directory: string): Formula {
    const version = /^1\.(\d+)/.exec(
      moduleOf(this.layout, directory)?.go ?? "",
    );
    const minor = version ? Number(version[1]) : 0;
    if (minor < 21) return formula;
    const named = new Set<string>();
    const walk = (item: Formula): void => {
      if (item.k === "v") named.add(item.n);
      else if (item.k === "not") walk(item.x);
      else if (item.k === "and" || item.k === "or") {
        walk(item.a);
        walk(item.b);
      }
    };
    walk(formula);
    let out = formula;
    for (const name of [...named].sort()) {
      const release = /^go1\.(\d+)$/.exec(name);
      if (release && Number(release[1]) <= minor)
        out = { k: "and", a: out, b: { k: "v", n: name } };
    }
    return out;
  }
  /**
   * Is a method declared in `path` part of the type declared in `type`'s
   * file (in the builds of `from`, when given)? Yes when that constraint
   * implies the method file's (the same file, an unconstrained one, the same
   * constraint); no when the files are never built together; otherwise not
   * known.
   */
  private buildsWith(
    path: string,
    type: string,
    from?: string,
    others: string[] = [],
  ): boolean | undefined {
    if (path === type) return true;
    const method = this.constraintOf(path);
    if (method?.k === "t") return true;
    let declared = this.constraintOf(type);
    // In the builds of the referencing file only.
    if (declared && from !== undefined) {
      const context = this.constraintOf(from);
      declared = context ? { k: "and", a: declared, b: context } : undefined;
    }
    // Without the files of the type's other declarations.
    for (const other of others) {
      if (!declared || other === type) continue;
      const excluded = this.constraintOf(other);
      declared = excluded
        ? { k: "and", a: declared, b: { k: "not", x: excluded } }
        : undefined;
    }
    if (!method || !declared) return undefined;
    if (impliesAnyTags(declared, method) === true) return true;
    return satisfiableAnyTags([declared, method]) === false ? false : undefined;
  }
  /** Is `path` in every build that includes `from`? */
  private includedWith(from: string, path: string): boolean {
    if (from === path) return true;
    const x = this.constraintOf(from);
    const y = this.constraintOf(path);
    return !!x && !!y && impliesAnyTags(x, y) === true;
  }
  /** Can these two files be in one build (false only when proved not)? */
  private buildTogether(a: string, b: string): boolean | undefined {
    const x = this.constraintOf(a);
    const y = this.constraintOf(b);
    return x && y ? satisfiableAnyTags([x, y]) : undefined;
  }

  /** Interface methods named `name` through interface embedding (cycle-safe by path). */
  private interfaceMember(
    ifaces: GraphSymbol[],
    name: string,
    from: string | undefined,
    access: string | undefined,
    path: string[] = [],
    skipExternal = false,
  ): { syms: GraphSymbol[]; unknown: boolean } {
    const syms: GraphSymbol[] = [];
    let unknown = false;
    for (const iface of ifaces) {
      if (path.includes(iface.id)) continue;
      const pkg = this.pkgOf(iface);
      if (!pkg) continue;
      syms.push(
        ...(
          this.members.get(`${pkg.key}\u0000${iface.name}\u0000${name}`) ?? []
        ).filter(
          (symbol) =>
            this.visible(symbol, from) && this.accessible(symbol, access),
        ),
      );
      for (const item of this.embedded(iface)) {
        if (item.value.kind !== "project") {
          if (
            !(
              item.value.kind === "external" &&
              !item.value.shadowable &&
              skipExternal
            )
          )
            unknown = true;
          continue;
        }
        const views = item.value.syms.map((symbol) => this.view(symbol));
        if (!views.every((view) => view.iface)) {
          unknown = true;
          continue;
        }
        const inner = this.interfaceMember(
          unique(views.flatMap((view) => view.iface!)),
          name,
          from,
          access,
          [...path, iface.id],
          skipExternal,
        );
        syms.push(...inner.syms);
        unknown ||= inner.unknown;
      }
    }
    return { syms: unique(syms), unknown };
  }

  // ---- interfaces --------------------------------------------------------

  /**
   * Go type identity (spec, "Type identity"), in one canonical form used by every
   * comparison of types or signatures. A written `TypeTerm` is bound to
   * declarations: a named type becomes its declaring package and name (an alias
   * becomes its target), an unexported field or method name is qualified by its
   * package, an embedded interface becomes its methods. Whatever cannot be bound
   * exactly is `u`, which `identical` never treats as equal or as different.
   */
  private identity(
    term: TypeTerm | undefined,
    file: string,
    depth = 0,
  ): Identity {
    if (!term || depth > MAX_DEPTH) return UNKNOWN_IDENTITY;
    const next = (item: TypeTerm) => this.identity(item, file, depth + 1);
    const info = this.files.get(file);
    const own = info?.pkg ? this.pkgIdentity(info.pkg) : undefined;
    // Unexported names are distinct per package.
    const qualify = (name: string) =>
      exported(name) ? name : own === undefined ? undefined : `${own}.${name}`;
    switch (term.k) {
      case "n":
        return this.namedIdentity(term, file, depth);
      case "l":
        return own === undefined
          ? UNKNOWN_IDENTITY
          : { k: "n", id: `${own}.local:${term.s}`, a: [] };
      case "ptr":
      case "sl":
        return { k: term.k, e: next(term.e) };
      case "ar":
        return { k: "ar", len: term.len, e: next(term.e) };
      case "map":
        return { k: "map", key: next(term.key), e: next(term.e) };
      case "ch":
        return { k: "ch", d: term.d, e: next(term.e) };
      case "fn":
        return {
          k: "fn",
          p: term.p.map(next),
          r: term.r.map(next),
          v: !!term.v,
        };
      case "st": {
        const fields: Extract<Identity, { k: "st" }>["f"] = [];
        for (const field of term.f) {
          const name = qualify(field.n);
          if (name === undefined) return UNKNOWN_IDENTITY;
          fields.push({ n: name, x: !!field.x, t: next(field.t), g: field.g });
        }
        return { k: "st", f: fields };
      }
      case "if": {
        const methods = new Map<string, Identity>();
        const add = (key: string, sig: Identity): boolean => {
          const existing = methods.get(key);
          if (existing && identical(existing, sig) !== true) return false;
          methods.set(key, sig);
          return true;
        };
        for (const method of term.m) {
          const name = qualify(method.n);
          if (name === undefined || !add(name, next(method.s)))
            return UNKNOWN_IDENTITY;
        }
        for (const embed of term.e) {
          const inner = this.embeddedMethods(embed, file, depth + 1);
          if (!inner) return UNKNOWN_IDENTITY;
          for (const [key, sig] of inner)
            if (!add(key, sig)) return UNKNOWN_IDENTITY;
        }
        return {
          k: "if",
          m: [...methods].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        };
      }
      default:
        return UNKNOWN_IDENTITY;
    }
  }

  /**
   * The methods an embedded interface element contributes: an interface literal,
   * or a named project interface (its method set), keyed like `identity`.
   */
  private embeddedMethods(
    term: TypeTerm,
    file: string,
    depth: number,
  ): [string, Identity][] | undefined {
    if (term.k === "if") {
      const inner = this.identity(term, file, depth);
      return inner.k === "if" ? inner.m : undefined;
    }
    if (term.k !== "n") return undefined;
    const symbol = this.namedDeclaration(term, file);
    if (!symbol) return undefined;
    const view = this.view(symbol);
    if (!view.iface || view.iface.length !== 1) return undefined;
    const methods = this.interfaceMethods(view.iface[0]!);
    if (!methods) return undefined;
    const out: [string, Identity][] = [];
    for (const method of methods.values()) {
      const pkg =
        method.access === undefined ? undefined : this.pkgs.get(method.access);
      if (method.access !== undefined && !pkg) return undefined;
      out.push([
        pkg ? `${this.pkgIdentity(pkg)}.${method.name}` : method.name,
        method.sig,
      ]);
    }
    return out;
  }

  /**
   * The one project declaration a written type name denotes in `file`, by Go's
   * scope rules (package block, then imports and dot-imports); undefined when it
   * is not exactly one intact project type, or a lossy package may hide another.
   */
  private namedDeclaration(
    term: Extract<TypeTerm, { k: "n" }>,
    file: string,
  ): GraphSymbol | undefined {
    const info = this.files.get(file);
    if (!info) return undefined;
    const one = (syms: GraphSymbol[]) => {
      const types = unique(syms.filter(isTypeSymbol));
      return types.length === 1 ? types[0] : undefined;
    };
    if (term.q !== undefined) {
      const entry = info.imports.get(term.q);
      if (!entry || !exported(term.n)) return undefined;
      return one(
        entry.pkgs.flatMap((pkg) => this.packageDecl(pkg, term.n, file)),
      );
    }
    if (info.pkg) {
      const own = this.packageDecl(info.pkg, term.n, file);
      if (own.length) return one(own);
    }
    if (this.lossy(info.pkg) || term.p) return undefined;
    const dotted: GraphSymbol[] = [];
    for (const dot of info.dots) {
      if (!dot.pkgs.length) return undefined;
      for (const pkg of dot.pkgs)
        if (exported(term.n))
          dotted.push(...this.packageDecl(pkg, term.n, file));
    }
    return one(dotted);
  }

  /** A named type's identity: its declaration, never its spelling. */
  private namedIdentity(
    term: Extract<TypeTerm, { k: "n" }>,
    file: string,
    depth: number,
  ): Identity {
    const info = this.files.get(file);
    if (!info) return UNKNOWN_IDENTITY;
    const args = (term.a ?? []).map((item) =>
      this.identity(item, file, depth + 1),
    );
    if (term.q !== undefined) {
      const entry = info.imports.get(term.q);
      if (entry && !entry.pkgs.length && !entry.failed && exported(term.n))
        // Outside the project: its path and name. It may be an alias of
        // anything, so a different external name is never proven different.
        return { k: "n", id: `${entry.path}.${term.n}`, a: args, ext: true };
    }
    const symbol = this.namedDeclaration(term, file);
    if (symbol) {
      const pkg = this.pkgOf(symbol)!;
      if (symbol.kind !== "alias")
        return {
          k: "n",
          id: `${this.pkgIdentity(pkg)}.${symbol.name}`,
          a: args,
        };
      // An alias is its target, compared as the full term it was written as.
      // A cycle (`type A = B; type B = A`, `type int = int`) is unknown.
      const target = (symbol.data as { target?: TypeTerm } | undefined)?.target;
      if (!target || term.a?.length || this.aliasesFollowed.has(symbol.id))
        return UNKNOWN_IDENTITY;
      this.aliasesFollowed.add(symbol.id);
      try {
        return this.identity(target, symbol.file, depth + 1);
      } finally {
        this.aliasesFollowed.delete(symbol.id);
      }
    }
    // A predeclared type: unless declared in the package (then `symbol` above,
    // or not exactly one) or a lossy package may hide such a declaration.
    if (
      term.q === undefined &&
      term.p &&
      !args.length &&
      !this.lossy(info.pkg) &&
      !this.testShadowed(info, term.n) &&
      !(info.pkg && this.packageDecl(info.pkg, term.n, file).length)
    ) {
      if (term.n === "any") return { k: "if", m: [] };
      return { k: "n", id: PREDECLARED_ALIASES[term.n] ?? term.n, a: [] };
    }
    return UNKNOWN_IDENTITY;
  }

  private pkgIdentity(pkg: Pkg): string {
    return pkg.importPath ?? `dir:${pkg.directory}:${pkg.name}`;
  }

  /**
   * Method set of an interface, keyed by method identity (an unexported name is
   * qualified by its declaring package), or undefined when not fully known.
   * Identical methods inherited along several embedding paths merge (Go's rule
   * for interfaces); the same identity with different signatures is an error.
   */
  private interfaceMethods(
    iface: GraphSymbol,
    path = new Set<string>(),
  ): Map<string, InterfaceMethod> | undefined {
    const data = (iface.data ?? {}) as {
      constraint?: boolean;
      generic?: boolean;
    };
    if (data.constraint || data.generic || path.has(iface.id)) return undefined;
    const pkg = this.pkgOf(iface);
    if (!pkg) return undefined;
    path.add(iface.id);
    try {
      const set = new Map<string, InterfaceMethod>();
      // The crude structural method set (no-toolchain fallback): methods
      // inherited along several paths merge by name, without any identity proof
      // (identity only annotates). The first declaration found is kept, unless
      // the two are provably different (`interface{ I; X }` with `M()` and
      // `M() int`, which Go rejects): then the set is not known, whatever the
      // order the declarations were met in.
      const add = (method: InterfaceMethod): boolean => {
        const existing = set.get(method.key);
        if (!existing) set.set(method.key, method);
        else if (identical(existing.sig, method.sig) === false) return false;
        return true;
      };
      for (const symbol of this.ownMethods(iface)) {
        const sig = (symbol.data as { sig?: TypeTerm } | undefined)?.sig;
        if (sig === undefined) return undefined;
        const access = exported(symbol.name) ? undefined : pkg.key;
        if (
          !add({
            key:
              access === undefined
                ? symbol.name
                : `${symbol.name}\u0000${access}`,
            name: symbol.name,
            sig: this.identity(sig, symbol.file),
            access,
          })
        )
          return undefined;
      }
      for (const item of this.embedded(iface)) {
        if (item.value.kind !== "project" || item.value.syms.length !== 1)
          return undefined;
        const view = this.view(item.value.syms[0]!);
        if (!view.iface || view.iface.length !== 1) return undefined;
        const inner = view.iface[0]!;
        const methods = this.interfaceMethods(inner, path);
        if (!methods) return undefined;
        for (const method of methods.values())
          if (!add(method)) return undefined;
      }
      return set;
    } finally {
      path.delete(iface.id);
    }
  }
  private ownMethodsIndex?: Map<string, GraphSymbol[]>;
  private ownMethods(iface: GraphSymbol): GraphSymbol[] {
    if (!this.ownMethodsIndex) {
      this.ownMethodsIndex = new Map();
      for (const symbol of this.symbolsById.values()) {
        const data = (symbol.data ?? {}) as {
          owner?: string;
          interface?: boolean;
        };
        if (symbol.kind === "method" && data.interface && data.owner)
          push2(
            this.ownMethodsIndex,
            `${symbol.file}\u0000${data.owner}`,
            symbol,
          );
      }
    }
    return this.ownMethodsIndex.get(`${iface.file}\u0000${iface.name}`) ?? [];
  }

  /**
   * Whether `type` (value and pointer method sets) has `name` with signature `sig`,
   * per the selector rule: unique, a method, and for the value set either a value
   * receiver or reached through an embedded pointer.
   */
  private hasMethod(
    type: GraphSymbol,
    name: string,
    sig: Identity,
    access: string | undefined,
  ): {
    value: boolean;
    pointer: boolean;
    unknown?: true;
    identity?: boolean | undefined;
  } {
    const found = this.selectName([type], name, undefined, access);
    // An external embedded type, or a failed file, could supply (or shadow) it:
    // not refuted.
    if (found.kind === "unknown" || found.kind === "failed")
      return { value: false, pointer: false, unknown: true };
    // By the selector rule (structure, not type identity): no method of that
    // name, or a field of that name, refutes it.
    if (found.kind !== "found") return { value: false, pointer: false };
    const methods = found.syms;
    // The crude, over-inclusive test (no-toolchain fallback, W2-B.md): the same
    // number of parameters (unless either is variadic) and of results, where
    // both are known. Type identity only annotates; "different" never refutes.
    // Several declarations (build variants): refuted only when EVERY one fails;
    // one that passes keeps the type in.
    let identity: boolean | undefined = true;
    let passes = 0;
    for (const method of methods) {
      if (method.kind !== "method") continue;
      // A method with its own type parameters (Go 1.27) is never in a method
      // set that satisfies an interface: interface methods cannot have type
      // parameters, so Go reports "wrong type for method".
      if (ownTypeParameters(method)) continue;
      const term = (method.data as { sig?: TypeTerm } | undefined)?.sig;
      if (term?.k === "fn" && sig.k === "fn") {
        if (term.r.length !== sig.r.length) continue;
        if (!term.v && !sig.v && term.p.length !== sig.p.length) continue;
      }
      passes++;
      const same = identical(this.identity(term, method.file), sig);
      if (same === false) identity = false;
      else if (same === undefined && identity !== false) identity = undefined;
    }
    if (!passes) return { value: false, pointer: false };
    const needsPointer = methods.some((method) => {
      const data = (method.data ?? {}) as {
        pointer?: boolean;
        interface?: boolean;
      };
      return !data.interface && !!data.pointer;
    });
    return { value: !needsPointer || found.pointer, pointer: true, identity };
  }

  private implementsLinks(added: AddedLink[]): void {
    const interfaces: {
      iface: GraphSymbol;
      methods: Map<string, InterfaceMethod>;
    }[] = [];
    const types: GraphSymbol[] = [];
    for (const symbol of this.symbolsById.values()) {
      if (!TYPE_KINDS.has(symbol.kind)) continue;
      // A failure on one declaration (pathological input) leaves it out: an
      // interface left out has no known implementers, so its sets stay open.
      let view: View;
      try {
        view = this.view(symbol);
      } catch {
        continue;
      }
      if (view.iface) {
        // Defined types/aliases over an interface share its method set; dispatch
        // maps them to that interface.
        if (view.iface.length !== 1 || view.iface[0] !== symbol) continue;
        let methods: Map<string, InterfaceMethod> | undefined;
        try {
          methods = this.interfaceMethods(symbol);
        } catch {
          methods = undefined;
        }
        if (methods?.size) {
          interfaces.push({ iface: symbol, methods });
          this.complete.add(symbol.id);
        }
      } else if (
        symbol.kind !== "alias" ||
        (symbol.data as { shape?: string } | undefined)?.shape
      )
        types.push(symbol);
    }
    for (const type of types)
      for (const { iface, methods } of interfaces) {
        let byValue = true;
        let byPointer = true;
        let refuted = false;
        let unknown = false;
        let identity: boolean | undefined = true;
        for (const { name, sig, access } of methods.values()) {
          let has: ReturnType<GoResolver["hasMethod"]>;
          try {
            has = this.hasMethod(type, name, sig, access);
          } catch {
            // A failure (pathological input) proves nothing: unknown.
            has = { value: false, pointer: false, unknown: true };
          }
          // An external type cannot declare another package's unexported method but
          // can inherit it from a carrier that outside code can reach: a project type
          // embedding any external type then cannot be ruled out.
          const inherited =
            !has.pointer &&
            !has.unknown &&
            access !== undefined &&
            this.embedsExternal(type) &&
            this.hiddenReachable(name, access);
          if (has.unknown || inherited) {
            unknown = true;
            continue;
          }
          byValue &&= has.value;
          byPointer &&= has.pointer;
          if (has.identity === false) identity = false;
          else if (has.identity === undefined && identity !== false)
            identity = undefined;
          if (!has.pointer) {
            refuted = true;
            break;
          }
        }
        if (refuted) continue;
        // Not refuted: a possible implementer, so dispatch must list its method.
        push2(this.possible, iface.id, type);
        // A type whose every interface method is matched by name and count gets
        // an `implements` link, never definite (no-toolchain fallback): it is
        // unresolved with the interface kept in `data.interfaceId`, and the
        // identity comparison only annotates it.
        if (unknown) continue;
        push2(this.implementers, iface.id, type);
        added.push({
          key: `implements:${type.key}:${iface.id}`,
          file: type.file,
          sourceId: type.id,
          kind: "implements",
          targetName: iface.name,
          range: type.range,
          data: {
            pointerReceiver: !byValue,
            structural: true,
            unverified: "structural-match-unverified",
            interfaceId: iface.id,
            identity:
              identity === true
                ? "identical"
                : identity === false
                  ? "different"
                  : "unknown",
          },
        });
      }
  }

  // ---- the opt-in toolchain route (W3-L) ----------------------------------

  private symbolsByFile?: Map<string, GraphSymbol[]>;
  /** The graph symbol declared at a toolchain position (name inside its range). */
  private symbolAt([file, offset, name]: [string, number, string]):
    | GraphSymbol
    | undefined {
    if (!this.symbolsByFile) {
      this.symbolsByFile = new Map();
      for (const symbol of this.symbolsById.values())
        push2(this.symbolsByFile, symbol.file, symbol);
    }
    let best: GraphSymbol | undefined;
    for (const symbol of this.symbolsByFile.get(file) ?? [])
      if (
        symbol.name === name &&
        symbol.range.start <= offset &&
        offset < symbol.range.end &&
        (!best ||
          symbol.range.end - symbol.range.start <
            best.range.end - best.range.start)
      )
        best = symbol;
    return best;
  }

  private outside?: Set<string>;
  /** A file the toolchain's configuration leaves out (its links are source-only). */
  private outsideConfiguration(path: string): boolean {
    if (!this.outside) {
      this.outside = new Set();
      for (const file of this.context.files)
        if (
          (file.result.data as { toolchain?: { status?: string } } | undefined)
            ?.toolchain?.status === "outside-configuration"
        )
          this.outside.add(file.path);
    }
    return this.outside.has(path);
  }

  private describe(id: string): string {
    const symbol = this.symbolsById.get(id);
    return symbol ? `${symbol.file}:${symbol.identity}` : id;
  }

  /**
   * The toolchain's decision for a link with a fact, or undefined (the
   * source-only decision stands). It may upgrade an unresolved, failed or
   * candidate link to a definite target, or a candidate set to a verified
   * implementer set. Where the source-only route has a different definite
   * target, the toolchain's is used for this configuration and the source's
   * is kept as `sourceOnly` (a disagreement, counted in the report).
   */
  private toolchainDecision(
    link: GraphLink,
    source: Decision,
  ): Decision | undefined {
    const fact = (link.data as { tc?: ToolchainFact } | undefined)?.tc;
    if (!fact) return undefined;
    const ids = unique(source.ids);
    const from: Decision["from"] = source.invalid?.length
      ? "invalid"
      : ids.length === 1 && source.definite
        ? "definite"
        : ids.length > 1
          ? "candidates"
          : "unresolved";
    const sourceTarget = from === "definite" ? ids[0] : undefined;
    if (fact.dir !== undefined) {
      // The package go compiles for this import, in the project's own tree
      // (for a vendored module, its vendor/ directory).
      const pkgs = [...this.symbolsById.values()].filter(
        (symbol) =>
          symbol.kind === "package" &&
          (symbol.data as { directory?: string } | undefined)?.directory ===
            (fact.dir === "." ? "" : fact.dir) &&
          !symbol.name.endsWith("_test"),
      );
      if (pkgs.length !== 1) return undefined;
      return {
        ids: [pkgs[0]!.id],
        definite: true,
        toolchain: "definite",
        from,
        ...(sourceTarget && sourceTarget !== pkgs[0]!.id
          ? { sourceOnly: this.describe(sourceTarget) }
          : {}),
      };
    }
    if (fact.at) {
      const target = this.symbolAt(fact.at);
      // Declared in a file the graph could not read: the source decision stands.
      if (!target) return undefined;
      if (fact.c === "iface" || fact.c === "typeparam") {
        // Without the implementer set (the universe had errors), the
        // interface method alone decides nothing.
        if (!fact.d) return undefined;
        const methods = fact.d.map((at) => this.symbolAt(at));
        // A method outside the graph (a failed file, or promoted from an
        // external embedded type), or an interface method (promoted from an
        // embedded interface: a nested dispatch the list does not expand):
        // not a complete set, so the source decision stands.
        if (
          methods.some(
            (method) =>
              !method ||
              (method.data as { interface?: boolean } | undefined)?.interface,
          )
        )
          return undefined;
        // Members the source-only route found in files outside this
        // configuration (other GOOS, build tags, cgo) are kept: the toolchain
        // can neither confirm nor refute them.
        const elsewhere = ids.filter((id) => {
          const symbol = this.symbolsById.get(id);
          return !!symbol && this.outsideConfiguration(symbol.file);
        });
        return {
          ids: unique([
            target.id,
            ...methods.map((method) => method!.id),
            ...elsewhere,
          ]),
          definite: false,
          dispatch: true,
          limit: DISPATCH_LIMIT,
          // Verified for the loaded packages of this configuration; a type
          // outside them (another configuration, a dependent module, a
          // dependency's type) may still implement the interface.
          open: ["external-implementers-possible"],
          toolchain: "verified",
          from,
        };
      }
      // A reference to an interface method (a method value): the identifier
      // names the interface method, but what it calls is a dispatch set; the
      // source-only set is kept.
      if (
        source.dispatch &&
        (target.data as { interface?: boolean } | undefined)?.interface
      )
        return undefined;
      return {
        ids: [target.id],
        definite: true,
        toolchain: "definite",
        from,
        ...(sourceTarget && sourceTarget !== target.id
          ? { sourceOnly: this.describe(sourceTarget) }
          : {}),
      };
    }
    // A standard-library, dependency or builtin object: the store has no
    // external symbols, so the link stays as it is, unless the source-only
    // route named a project target (a disagreement: withdrawn).
    if ((fact.ext || fact.b) && (sourceTarget || from === "invalid"))
      // A failed-file cause (a valid file the grammar could not read) is
      // withdrawn too: go/types checked this link clean.
      return {
        ids: [],
        definite: false,
        toolchain: "external",
        from,
        ...(sourceTarget ? { sourceOnly: this.describe(sourceTarget) } : {}),
      };
    return undefined;
  }

  /**
   * With toolchain facts for a universe without errors, the `implements`
   * links are exactly the toolchain's verified pairs (definite, to the
   * interface); otherwise the source-only links stand.
   */
  private toolchainImplements(added: AddedLink[]): void {
    const pairs: { file: string; pair: ToolchainPair }[] = [];
    let universe = false;
    for (const file of this.context.files) {
      if (file.module !== this.moduleId) continue;
      const data = (
        file.result.data as
          | { toolchain?: { universe?: boolean; implements?: ToolchainPair[] } }
          | undefined
      )?.toolchain;
      if (data?.universe) universe = true;
      for (const pair of data?.implements ?? [])
        pairs.push({ file: file.path, pair });
    }
    if (!universe) return;
    // The toolchain lists pairs of non-generic types and interfaces among the
    // packages it loaded. A source-only link it cannot judge stands: one of a
    // generic type or interface, or one whose type or interface is declared in
    // a file outside this configuration (marked so). Only a pair whose two
    // sides were both loaded, and which go/types does not confirm, is refuted.
    const generic = (id: string | null | undefined) =>
      !!id &&
      !!(this.symbolsById.get(id)?.data as { generic?: boolean } | undefined)
        ?.generic;
    const elsewhere = (id: string | null | undefined) => {
      const symbol = id ? this.symbolsById.get(id) : undefined;
      return !!symbol && this.outsideConfiguration(symbol.file);
    };
    for (let index = added.length - 1; index >= 0; index--) {
      const link = added[index]!;
      if (link.kind !== "implements") continue;
      const iface = (link.data as { interfaceId?: string } | undefined)
        ?.interfaceId;
      if (generic(link.sourceId) || generic(iface)) continue;
      if (elsewhere(link.sourceId) || elsewhere(iface)) {
        added[index] = {
          ...link,
          data: {
            ...((link.data as { [key: string]: Json } | undefined) ?? {}),
            toolchain: {
              origin: "source-only",
              reason: "outside-configuration",
            },
          },
        };
        continue;
      }
      added.splice(index, 1);
    }
    const seen = new Set<string>();
    for (const { file, pair } of pairs) {
      const [typeOffset, ifaceFile, ifaceOffset, how] = pair;
      const type = this.typeAt(file, typeOffset);
      const iface = this.typeAt(ifaceFile, ifaceOffset);
      if (!type || !iface) continue;
      const key = `implements:${type.key}:${iface.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({
        key,
        file: type.file,
        sourceId: type.id,
        kind: "implements",
        targetName: iface.name,
        range: type.range,
        targetId: iface.id,
        data: { pointerReceiver: how === "pointer", origin: "toolchain" },
      });
    }
  }

  /** The type symbol whose declared name starts at this offset. */
  private typeAt(file: string, offset: number): GraphSymbol | undefined {
    if (!this.symbolsByFile) this.symbolAt([file, -1, ""]);
    let best: GraphSymbol | undefined;
    for (const symbol of this.symbolsByFile!.get(file) ?? [])
      if (
        TYPE_KINDS.has(symbol.kind) &&
        symbol.range.start <= offset &&
        offset < symbol.range.end &&
        (!best ||
          symbol.range.end - symbol.range.start <
            best.range.end - best.range.start)
      )
        best = symbol;
    return best;
  }

  // ---- link decisions ----------------------------------------------------

  private definite(syms: GraphSymbol[]): Decision {
    return { ids: syms.map((symbol) => symbol.id), definite: true };
  }

  private resolveLink(link: GraphLink): Decision {
    const data = (link.data ?? {}) as {
      expr?: Desc;
      t?: TypeRef;
      child?: string;
      path?: string;
    };
    switch (link.kind) {
      case "contains": {
        const child = this.byFileKey.get(`${link.file}\u0000${data.child}`);
        return child ? this.definite([child]) : UNRESOLVED;
      }
      case "imports": {
        const info = this.files.get(link.file);
        if (!info || !data.path) return UNRESOLVED;
        const {
          pkgs,
          uncertain,
          failed: cause,
          ambiguous,
        } = this.importTargets(info, data.path);
        if (cause) return failed(cause);
        // Several modules provide the package: Go rejects the import.
        if (ambiguous) return AMBIGUOUS_IMPORT;
        const symbols = pkgs
          .map((pkg) => pkg.symbol)
          .filter((symbol): symbol is GraphSymbol => !!symbol);
        // Which destination Go uses is not proven: never definite.
        return uncertain
          ? {
              ids: symbols.map((symbol) => symbol.id),
              definite: false,
              open: ["import-destination-uncertain"],
            }
          : this.definite(symbols);
      }
      case "receiver": {
        const info = this.files.get(link.file);
        if (!info?.pkg || !data.t) return UNRESOLVED;
        const found = this.scopeLookup([info.pkg], data.t.n, info, false);
        // The receiver type is not among the package's valid files: failed if
        // the package has failed files (one of them may declare it).
        if (found.cause.length) return failed(found.cause);
        return this.definite(found.syms.filter(isTypeSymbol));
      }
      case "embeds":
      case "references":
      case "calls": {
        if (data.t) {
          const types = this.declaredTypes(data.t, link.file);
          if (!types.length) {
            const cause = this.typeCause(data.t, link.file);
            if (cause) return failed(cause);
          }
          return this.definite(types);
        }
        if (data.expr) return this.resolveExpression(data.expr, link);
        return UNRESOLVED;
      }
      default:
        return UNRESOLVED;
    }
  }

  /**
   * The failed files a link certainly depends on, from what its source shows:
   * the lookups that name it, and, along its receiver chain, only the part of
   * each written type the next step uses (a member set beyond depth 0 only when
   * the member was not found there; a container's element or key; one result
   * of a call). A wrong cause is worse than a missing one: anything not
   * certain is left out, and the link stays plainly unresolved. Type
   * arguments are never followed (instantiation is not modelled).
   */
  private involvedCause(link: GraphLink): string[] {
    const causes = new Set<string>();
    const seen = new Set<string>();
    const add = (cause: string[] | undefined) =>
      cause?.forEach((file) => causes.add(file));
    const members = (embedded: boolean, n?: string): Use =>
      n === undefined
        ? { k: "members", embedded }
        : { k: "members", embedded, n };
    // A written type: its own lookup always; what it contains only as `use`
    // needs. Type arguments are never followed (no instantiation modelling).
    const ref = (
      r: TypeRef | undefined,
      file: string,
      depth: number,
      use: Use,
    ): void => {
      if (!r || r.q === "" || r.l !== undefined || depth > MAX_DEPTH) return;
      const key = `ref\u0000${JSON.stringify(use)}\u0000${file}\u0000${r.q ?? ""}\u0000${r.n}`;
      if (seen.has(key)) return;
      seen.add(key);
      const type = this.typeFromRef(r, file, 1);
      if (type.kind === "failed") return add(type.cause);
      if (use.k === "none") return;
      for (const symbol of this.declaredTypes(r, file))
        typeSym(symbol, depth + 1, use);
      if (type.kind === "project")
        for (const symbol of type.syms) typeSym(symbol, depth + 1, use);
    };
    const term = (
      t: TypeTerm | undefined,
      file: string,
      depth: number,
      use: Use,
    ): void => {
      if (!t || depth > MAX_DEPTH || use.k === "none") return;
      switch (t.k) {
        case "n":
          if (!t.p)
            ref(
              t.q === undefined ? { n: t.n } : { q: t.q, n: t.n },
              file,
              depth,
              use,
            );
          return;
        case "ptr":
          return term(t.e, file, depth + 1, use);
        case "sl":
        case "ar":
          if (use.k === "comp" && !use.key)
            term(t.e, file, depth + 1, use.then);
          return;
        case "ch":
          if (use.k === "comp") term(t.e, file, depth + 1, use.then);
          return;
        case "map":
          if (use.k === "comp")
            term(use.key ? t.key : t.e, file, depth + 1, use.then);
          return;
        case "fn":
          if (use.k === "result") term(t.r[use.i], file, depth + 1, use.then);
          return;
        case "st":
          // A struct's own named field is found at depth 0: nothing it embeds
          // matters (the same guard as for an anonymous struct value).
          if (
            use.k === "members" &&
            use.n !== undefined &&
            t.f.some((field) => !field.x && field.n === use.n)
          )
            return;
          if (use.k === "members" && use.embedded)
            for (const field of t.f)
              if (field.x) term(field.t, file, depth + 1, use);
          return;
        case "if":
          if (
            use.k === "members" &&
            use.n !== undefined &&
            t.m.some((method) => method.n === use.n)
          )
            return;
          if (use.k === "members" && use.embedded)
            for (const item of t.e) term(item, file, depth + 1, use);
          return;
        default:
          return;
      }
    };
    const typeSym = (symbol: GraphSymbol, depth: number, use: Use): void => {
      const key = `type\u0000${JSON.stringify(use)}\u0000${symbol.id}`;
      if (seen.has(key) || depth > MAX_DEPTH || use.k === "none") return;
      seen.add(key);
      const data = (symbol.data ?? {}) as {
        underlying?: TypeRef;
        target?: TypeTerm;
        fn?: Desc[];
        v?: Desc;
      };
      // A member found on the type itself: nothing it contains matters.
      if (use.k === "members" && !use.embedded) return;
      ref(data.underlying, symbol.file, depth, use);
      term(data.target, symbol.file, depth, use);
      if (use.k === "result" && data.fn)
        desc(data.fn[use.i], symbol.file, depth + 1, use.then);
      // A defined type over a container literal (`type NS []struct{…}`) has
      // no target term: its element comes from the literal's description.
      if (use.k === "comp" && data.v) desc(data.v, symbol.file, depth + 1, use);
      if (use.k === "members")
        for (const embed of this.embedsBySource.get(symbol.id) ?? [])
          ref(
            (embed.data as { t?: TypeRef } | undefined)?.t,
            embed.file,
            depth,
            use,
          );
    };
    // A declaration used as a value: its declared type, as `use` needs.
    const symbolUse = (symbol: GraphSymbol, depth: number, use: Use): void => {
      if (use.k === "none") return;
      if (TYPE_KINDS.has(symbol.kind)) return typeSym(symbol, depth, use);
      const key = `sym\u0000${JSON.stringify(use)}\u0000${symbol.id}`;
      if (seen.has(key) || depth > MAX_DEPTH) return;
      seen.add(key);
      const data = (symbol.data ?? {}) as {
        d?: Desc;
        t?: TypeRef;
        v?: Desc;
        results?: Desc[];
      };
      if (symbol.kind === "function" || symbol.kind === "method") {
        if (use.k === "result" && data.results)
          desc(data.results[use.i], symbol.file, depth + 1, use.then);
        return;
      }
      if (data.d) desc(data.d, symbol.file, depth + 1, use);
      else if (data.v) desc(data.v, symbol.file, depth + 1, use);
      else ref(data.t, symbol.file, depth + 1, use);
    };
    const entity = (found: Entity, depth: number, use: Use): void => {
      if (found.e === "unknown") add(found.cause);
      if (found.e === "value" && found.type.kind === "failed")
        add(found.type.cause);
      if (found.e === "syms")
        for (const symbol of found.syms) symbolUse(symbol, depth + 1, use);
    };
    /**
     * The failed-file causes `d` certainly depends on when `use` is made of its
     * value: `none`, only the lookups that name it; `members`, its type's
     * method and field set (`embedded`: still open beyond depth 0); `comp`, a
     * container's element or key; `result`, a function's result.
     */
    const desc = (
      d: Desc | undefined,
      file: string,
      depth: number,
      use: Use,
    ): void => {
      if (!d || depth > MAX_DEPTH) return;
      switch (d.k) {
        case "val":
          return ref(d.t, file, depth, use);
        case "name":
          return entity(this.lookupName(d.n, file), depth, use);
        case "sel": {
          // A named field or method of an anonymous struct or interface: only
          // its own type matters.
          const base = anonymous(d.x, file, depth);
          const field = base?.d.f?.find((item) => item.n === d.n);
          if (field) return desc(field.d, base!.file, depth + 1, use);
          // A member found on the operand's type: the types embedded in that
          // type cannot change the answer.
          const found = this.select(d, file, 0, true);
          desc(
            d.x,
            file,
            depth + 1,
            members(!(found.e === "syms" || found.e === "value"), d.n),
          );
          return entity(found, depth, use);
        }
        case "call": {
          const callee = this.denote(d.f, file, 0);
          if (callee.e === "unknown") return add(callee.cause);
          if (callee.e === "none" && d.b)
            return desc(d.b, file, depth + 1, use);
          if (
            callee.e === "syms" &&
            callee.syms.every(
              (symbol) =>
                ((symbol.kind === "function" || symbol.kind === "method") &&
                  (symbol.data as { results?: Desc[] } | undefined)?.results) ||
                TYPE_KINDS.has(symbol.kind),
            )
          ) {
            // Result i of a function; a conversion's value is of that type.
            for (const symbol of callee.syms)
              symbolUse(
                symbol,
                depth + 1,
                TYPE_KINDS.has(symbol.kind)
                  ? use
                  : { k: "result", i: d.i, then: use },
              );
            return;
          }
          // A func value: result i of its type.
          return desc(d.f, file, depth + 1, { k: "result", i: d.i, then: use });
        }
        case "inst":
          return desc(d.x, file, depth + 1, use);
        case "elem":
          return desc(d.x, file, depth + 1, {
            k: "comp",
            key: false,
            then: use,
          });
        case "key":
          return desc(d.x, file, depth + 1, {
            k: "comp",
            key: true,
            then: use,
          });
        case "cont":
          // A slice's key is an int; a channel's single range value is its
          // element. Called, a container was indexed (`h[0]()`).
          if (use.k === "comp") {
            const item = use.key && !d.ch ? d.key : d.e;
            if (item) desc(item, file, depth + 1, use.then);
          } else if (use.k === "result") desc(d.e, file, depth + 1, use);
          return;
        case "func":
          if (use.k === "result") desc(d.r[use.i], file, depth + 1, use.then);
          return;
        case "local":
          // An anonymous struct or interface: one of its own named fields or
          // methods is found at depth 0, whatever route reached it, so nothing
          // it embeds matters. Any other member is looked up in what it embeds.
          if (
            use.k === "members" &&
            use.n !== undefined &&
            d.f?.some((item) => item.n === use.n)
          )
            return;
          if (use.k === "members" && use.embedded)
            for (const item of d.m ?? []) {
              const found =
                use.n === undefined
                  ? undefined
                  : this.select({ k: "sel", x: item, n: use.n }, file, 0, true);
              desc(
                item,
                file,
                depth + 1,
                members(
                  !(found && (found.e === "syms" || found.e === "value")),
                  use.n,
                ),
              );
            }
          return;
        case "unknown":
          // `(*p.T)(x)`, `f()()`: the value of calling what is written.
          if (use.k !== "none")
            for (const item of d.m ?? [])
              desc({ k: "call", f: item, i: 0 }, file, depth + 1, use);
          return;
        case "tval":
          if (use.k === "members") ref(d.c, file, depth, use);
          return;
        case "var":
          return desc(d.d, file, depth + 1, use);
        default:
          return;
      }
    };
    /**
     * The written static type of a value, as a description and the file it is
     * written in, through every route a value is reached: variables, names
     * (package variables, parameters), selected fields, call results, func
     * values, container elements. Undefined when it is not one written type.
     */
    const written = (
      d: Desc,
      file: string,
      depth: number,
    ): { d: Desc; file: string } | undefined => {
      if (depth > MAX_DEPTH) return undefined;
      const one = (symbols: GraphSymbol[]) =>
        symbols.length === 1 ? symbols[0] : undefined;
      switch (d.k) {
        case "local":
        case "cont":
        case "func":
          return { d, file };
        case "val": {
          // A named type written as a literal (`type SA = []struct{…}`,
          // `type FT func() …`): the literal, from its declaration.
          const types = this.declaredTypes(d.t, file);
          const type = types.length === 1 ? types[0]! : undefined;
          const v = (type?.data as { v?: Desc } | undefined)?.v;
          return v && type ? written(v, type.file, depth + 1) : { d, file };
        }
        case "var":
          return written(d.d, file, depth + 1);
        case "name": {
          const found = this.lookupName(d.n, file);
          const symbol = found.e === "syms" ? one(found.syms) : undefined;
          return symbol ? declared(symbol, depth) : undefined;
        }
        case "sel": {
          const base = anonymous(d.x, file, depth + 1);
          const field = base?.d.f?.find((item) => item.n === d.n);
          if (field) return written(field.d, base!.file, depth + 1);
          const found = this.select(d, file, 0, true);
          const symbol = found.e === "syms" ? one(found.syms) : undefined;
          return symbol ? declared(symbol, depth) : undefined;
        }
        case "call": {
          const callee = this.denote(d.f, file, 0);
          // The builtin itself (`new`, `make`, `append`), as `desc` reads it.
          if (callee.e === "none" && d.b) return written(d.b, file, depth + 1);
          const symbol = callee.e === "syms" ? one(callee.syms) : undefined;
          // A declared function or method (also as a method value or method
          // expression): its written result.
          if (
            symbol &&
            (symbol.kind === "function" || symbol.kind === "method")
          ) {
            const results = (symbol.data as { results?: Desc[] } | undefined)
              ?.results;
            const result = results?.[d.i];
            return result ? written(result, symbol.file, depth + 1) : undefined;
          }
          // A conversion: not followed (undefined is the conservative answer).
          if (symbol && TYPE_KINDS.has(symbol.kind)) return undefined;
          // A function-typed variable, parameter or field, or any other func
          // value (a literal called in place, an element of a container of
          // functions, a result): the result of its written function type.
          const fn = symbol
            ? declared(symbol, depth)
            : written(d.f, file, depth + 1);
          return fn ? callResult(fn, d.i, depth + 1) : undefined;
        }
        case "elem":
        case "key": {
          const x = written(d.x, file, depth + 1);
          if (x?.d.k !== "cont") return undefined;
          const item = d.k === "key" && !x.d.ch ? x.d.key : x.d.e;
          return item ? written(item, x.file, depth + 1) : undefined;
        }
        case "unknown":
          // A call whose callee is not described (`(<-fc)()`, `(*p.T)(x)`):
          // the value of calling what is written, as `desc` reads it.
          return d.m?.length === 1
            ? written({ k: "call", f: d.m[0]!, i: 0 }, file, depth + 1)
            : undefined;
        default:
          return undefined;
      }
    };
    /**
     * Result i of calling a value of this written type: a func type; an indexed
     * container of functions (`fns[0]()` is described with the container as
     * the callee); a named or aliased function type (`type F func() …`,
     * `type F = func() …`), through its declaration.
     */
    const callResult = (
      fn: { d: Desc; file: string },
      i: number,
      depth: number,
    ): { d: Desc; file: string } | undefined => {
      if (depth > MAX_DEPTH) return undefined;
      if (fn.d.k === "func") {
        const result = fn.d.r[i];
        return result ? written(result, fn.file, depth + 1) : undefined;
      }
      if (fn.d.k === "cont") {
        const item = written(fn.d.e, fn.file, depth + 1);
        return item ? callResult(item, i, depth + 1) : undefined;
      }
      if (fn.d.k === "val") {
        const types = this.declaredTypes(fn.d.t, fn.file);
        const type = types.length === 1 ? types[0]! : undefined;
        const data = (type?.data ?? {}) as {
          fn?: Desc[];
          underlying?: TypeRef;
        };
        if (type && data.fn) {
          const result = data.fn[i];
          return result ? written(result, type.file, depth + 1) : undefined;
        }
        if (type && data.underlying)
          return callResult(
            { d: { k: "val", t: data.underlying }, file: type.file },
            i,
            depth + 1,
          );
      }
      return undefined;
    };
    /** A variable's, parameter's or field's declared type. */
    const declared = (symbol: GraphSymbol, depth: number) => {
      if (TYPE_KINDS.has(symbol.kind)) return undefined;
      if (symbol.kind === "function" || symbol.kind === "method")
        return undefined;
      const data = (symbol.data ?? {}) as { d?: Desc; v?: Desc };
      const d = data.d ?? data.v;
      return d ? written(d, symbol.file, depth + 1) : undefined;
    };
    /** The anonymous struct or interface a value has, wherever it was written. */
    const anonymous = (d: Desc, file: string, depth: number) => {
      const found = written(d, file, depth);
      return found?.d.k === "local"
        ? { d: found.d as Extract<Desc, { k: "local" }>, file: found.file }
        : undefined;
    };
    const data = (link.data ?? {}) as { expr?: Desc; t?: TypeRef };
    ref(data.t, link.file, 0, { k: "none" });
    desc(data.expr, link.file, 0, { k: "none" });
    return [...causes].sort();
  }

  /**
   * Why a written type name found no declaration, when the answer is a failed
   * file: the files that might declare it (none: plainly unresolved).
   */
  private typeCause(ref: TypeRef, from: string): string[] | undefined {
    if (ref.l !== undefined) return undefined;
    const type = this.typeFromRef(ref, from, 1);
    return type.kind === "failed" ? type.cause : undefined;
  }

  /** Type references link to the declaration named, including aliases themselves. */
  private declaredTypes(ref: TypeRef, from: string): GraphSymbol[] {
    if (ref.l !== undefined) {
      const local = this.localTypes.get(`${from}\u0000${ref.l}`);
      return local ? [local] : [];
    }
    if (ref.q === "") return [];
    if (ref.q !== undefined) {
      const base = this.lookupName(ref.q, from);
      return base.e === "pkg" && exported(ref.n)
        ? base.pkgs
            .flatMap((pkg) => this.packageDecl(pkg, ref.n, from))
            .filter(isTypeSymbol)
        : [];
    }
    const found = this.lookupName(ref.n, from);
    return found.e === "syms" ? found.syms.filter(isTypeSymbol) : [];
  }

  private resolveExpression(desc: Desc, link: GraphLink): Decision {
    if (desc.k === "unknown" && desc.m?.length === 1 && link.kind === "calls") {
      // A callee not described is a conversion when what is written in it
      // names a type: `(*T)(x)`, `(*p.T)(nil)` call T as `T(x)` does.
      const written = this.denote(desc.m[0]!, link.file, 0);
      if (written.e === "syms" && written.syms.every(isTypeSymbol))
        return this.resolveExpression(desc.m[0]!, link);
      return UNRESOLVED;
    }
    if (desc.k === "sel") {
      const base = this.denote(staticDesc(desc.x), link.file, 0);
      if (base.e === "unknown" && base.cause) return failed(base.cause);
      let type: TypeValue | undefined;
      if (base.e === "value") type = base.type;
      else if (base.e === "external")
        type = { kind: "external", name: base.name };
      else if (base.e === "syms" && !base.syms.every(isTypeSymbol))
        type = this.sameType(
          base.syms.map((symbol) => this.valueType(symbol, 1)),
        );
      if (type) return this.member(type, desc.n, link);
    }
    const entity = this.denote(desc, link.file, 0);
    if (entity.e === "unknown" && entity.cause) return failed(entity.cause);
    if (entity.e !== "syms") return UNRESOLVED;
    return link.kind === "calls"
      ? this.expand(entity.syms)
      : this.definite(entity.syms);
  }

  /**
   * Possible targets of calling these values: an interface method value calls one
   * of the interface's implementations, so it expands to its dispatch set; if any
   * value's set is not known, the whole call is unresolved.
   */
  private expand(syms: GraphSymbol[]): Decision {
    const specs = syms.filter(
      (symbol) =>
        (symbol.data as { interface?: boolean } | undefined)?.interface,
    );
    if (!specs.length) return this.definite(syms);
    const ids = syms
      .filter((symbol) => !specs.includes(symbol))
      .map((symbol) => symbol.id);
    // The value's own targets, and each interface method value's dispatch:
    // every property of every part carries over.
    return combine([
      ...(ids.length ? [{ ids, definite: false }] : []),
      ...specs.map((spec) => this.dispatch([spec], spec.name)),
    ]);
  }

  /** `x.name` where x has the given type. */
  private member(type: TypeValue, name: string, link: GraphLink): Decision {
    switch (type.kind) {
      case "project": {
        const found = this.selectName(type.syms, name, link.file);
        if (found.kind === "ambiguous")
          return {
            ids: found.syms.map((symbol) => symbol.id),
            definite: false,
          };
        // Not among the valid declarations of a type whose package (or an
        // embedded type's) has failed files: one of them may declare it.
        if (found.kind === "failed") return failed(found.cause);
        if (found.kind !== "found") return UNRESOLVED;
        const specs = found.syms.filter(
          (symbol) =>
            (symbol.data as { interface?: boolean } | undefined)?.interface,
        );
        const views = type.syms.map((symbol) => this.view(symbol));
        return specs.length
          ? this.dispatch(
              specs,
              name,
              views.every((view) => view.iface)
                ? unique(views.flatMap((view) => view.iface!))
                : undefined,
            )
          : this.definite(found.syms);
      }
      case "tparam": {
        // Only the constraint's methods are callable; it must be among the candidates.
        if (!type.c) return UNRESOLVED;
        const constraint = this.typeFromRef(type.c, type.file, 1);
        if (constraint.kind !== "project") return UNRESOLVED;
        const found = this.selectName(constraint.syms, name, link.file);
        if (found.kind !== "found") return UNRESOLVED;
        const specs = found.syms.filter(
          (symbol) =>
            (symbol.data as { interface?: boolean } | undefined)?.interface,
        );
        return specs.length === found.syms.length
          ? this.dispatch(specs, name, constraint.syms)
          : UNRESOLVED;
      }
      case "failed":
        // The receiver's type needs a failed file: the link fails with it,
        // never a name-only set.
        return failed(type.cause);
      case "unknown":
        return link.kind === "calls"
          ? this.byName(name, link.file)
          : UNRESOLVED;
      default:
        // external, opaque, containers, func values: nothing in the project to offer.
        return UNRESOLVED;
    }
  }

  /**
   * A call through an interface value: the interface method plus `name` on every
   * project type that implements the receiver's static interface or cannot be ruled
   * out. `specs` are alternative declarations of the one method (merged from
   * several embedded interfaces, or build variants). Unresolved when no
   * implementation is known, or when any part of the set cannot be established.
   *
   * Closed only if provably complete with only provable members: the static
   * interface is known, sealed against outside implementers (see `sealed`), every
   * member comes from a proven implementer, and nothing was expanded through an
   * embedded interface value. Otherwise open (`external-implementers-possible`).
   */
  private dispatch(
    specs: GraphSymbol[],
    name: string,
    staticTypes?: GraphSymbol[],
  ): Decision {
    const exact =
      !!staticTypes?.length &&
      staticTypes.every(
        (type) => type.kind === "interface" && this.complete.has(type.id),
      );
    // Members come from the static interface's (possible) implementers. Without it,
    // the declaring interfaces' implementers are a superset, so the set is open.
    const sources = exact ? staticTypes! : this.ownersOf(specs);
    // Layer 1: a type in a declaration-lossy package may be a member. An
    // interface with only exported methods can be implemented from any package
    // (a third package may convert); one sealed by an unexported method only
    // from a lossy package that reaches its own.
    // (A directory whose every file failed counts through its placeholder.)
    const unseen =
      this.lossyPackages.size > 0 &&
      (!sources.length ||
        sources.some(
          (iface) =>
            !this.sealed(iface) || this.lossyReaches(this.pkgOf(iface)?.key),
        ));
    const found = this.implementations(specs, name, sources, new Set());
    if (
      !found ||
      !found.targets.some(
        (symbol) =>
          !(symbol.data as { interface?: boolean } | undefined)?.interface,
      )
    )
      // No valid member: unresolved, but its members may be unseen.
      return unseen
        ? { ids: [], definite: false, dispatch: true, unseen: true }
        : UNRESOLVED;
    // Every dispatch set is open (no-toolchain fallback): membership is a crude
    // structural match, not proven. The label still says whether a type outside
    // the project could be in it: a set the earlier rules would have closed
    // (static interface known, sealed, every member matched, nothing expanded)
    // is open for that reason alone. An unseen type of a lossy package that
    // reaches the interface is said by `unseen` (declarations-may-be-unseen),
    // not by claiming outside implementers.
    const sealedOnly =
      exact && !found.open && staticTypes!.every((type) => this.sealed(type));
    return {
      ids: [...specs, ...found.targets].map((symbol) => symbol.id),
      definite: false,
      limit: DISPATCH_LIMIT,
      dispatch: true,
      ...(unseen ? { unseen: true as const } : {}),
      open: [
        sealedOnly
          ? "structural-match-unverified"
          : "external-implementers-possible",
      ],
    };
  }

  private ownersOf(specs: GraphSymbol[]): GraphSymbol[] {
    const out: GraphSymbol[] = [];
    for (const spec of specs) {
      const owner = (spec.data as { owner?: string } | undefined)?.owner;
      const pkg = this.pkgOf(spec);
      const iface = pkg
        ? (this.decls.get(pkg.key)?.get(owner ?? "") ?? []).find(
            (symbol) =>
              symbol.kind === "interface" && symbol.file === spec.file,
          )
        : undefined;
      if (iface) out.push(iface);
    }
    return out;
  }

  /**
   * No type outside the project can implement this interface: it has an unexported
   * method that code outside the project cannot obtain (`hiddenReachable` false).
   */
  private sealed(iface: GraphSymbol): boolean {
    const methods = this.interfaceMethods(iface);
    if (!methods) return false;
    for (const method of methods.values())
      if (
        method.access !== undefined &&
        !this.hiddenReachable(method.name, method.access)
      )
        return true;
    return false;
  }

  /** Some declaration-lossy package can reach package `to` (or is it). */
  private lossyReaches(to: string | undefined): boolean {
    if (to === undefined) return this.lossyPackages.size > 0;
    for (const from of this.lossyPackages)
      if (this.mayReach(from, to)) return true;
    return false;
  }

  private mayReach(from: string | undefined, to: string): boolean {
    if (from === undefined) return true;
    return from === to || this.reachSet(from).has(to);
  }

  private reachSets = new Map<string, Set<string>>();
  /**
   * Packages whose types a type of package `from` may contain: its project
   * imports, transitively. A package whose imports are not all known (a lossy
   * package: one with a failed or untrusted file) may import any
   * package Go lets it import (not `main`, not a `_test` package, `internal/`
   * only from within its parent), and onward from those.
   */
  private reachSet(from: string): Set<string> {
    const cached = this.reachSets.get(from);
    if (cached) return cached;
    const seen = new Set([from]);
    const queue = [from];
    const visit = (key: string) => {
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    };
    while (queue.length) {
      const key = queue.shift()!;
      const pkg = this.pkgs.get(key) ?? this.failedOnly.get(key);
      if (!pkg) continue;
      // A failed file's imports are unknown.
      if (this.lossyPackages.has(pkg.key))
        for (const target of this.pkgs.values()) {
          if (this.canImport(pkg, target)) visit(target.key);
        }
      for (const path of pkg.files) {
        const info = this.files.get(path)!;
        for (const entry of [...info.imports.values(), ...info.dots])
          for (const target of entry.reach) visit(target.key);
      }
    }
    this.reachSets.set(from, seen);
    return seen;
  }

  /** Go's import rules: could package `from` import package `target`? */
  private canImport(from: Pkg, target: Pkg): boolean {
    if (target.importPath === undefined || target.name === "main") return false;
    const parts = target.importPath.split("/");
    const internal = parts.lastIndexOf("internal");
    if (internal < 0) return true;
    const parent = parts.slice(0, internal).join("/");
    const importer = importPathOf(this.layout, from.directory);
    return (
      parent === "" ||
      (importer !== undefined &&
        (importer === parent || importer.startsWith(`${parent}/`)))
    );
  }

  private hiddenMemo = new Map<string, boolean>();
  /**
   * Can code outside the project obtain package `pkgKey`'s unexported method `name`
   * (and so implement interfaces that need it)? Only through an exported CARRIER
   * declared in an OUTSIDE-REACHABLE package: an exported, package-level, non-test
   * type whose method set includes it. Method sets come from `view` and the
   * selector rule, so carriers through embedding (any depth, pointers, embedded
   * interfaces), defined types, aliases, alias literals and generic declarations are
   * all covered transitively. A type whose structure cannot be determined might
   * carry it: yes.
   */
  private hiddenReachable(name: string, pkgKey: string): boolean {
    const key = `${pkgKey}\u0000${name}`;
    const cached = this.hiddenMemo.get(key);
    if (cached !== undefined) return cached;
    const cutoffs = this.cutoffs;
    let reachable = false;
    for (const type of this.symbolsById.values()) {
      if (!TYPE_KINDS.has(type.kind) || !exported(type.name)) continue;
      if ((type.data as { local?: boolean } | undefined)?.local) continue;
      if (this.files.get(type.file)?.fact.test) continue;
      if (!this.outsideReachable(this.pkgOf(type))) continue;
      if (this.carries(type, name, pkgKey)) {
        reachable = true;
        break;
      }
    }
    if (this.cutoffs === cutoffs) this.hiddenMemo.set(key, reachable);
    return reachable;
  }
  /** The type's method set includes (or may include) package `pkgKey`'s unexported `name`. */
  private carries(type: GraphSymbol, name: string, pkgKey: string): boolean {
    const view = this.view(type);
    // An unknown structure might carry it, if its package can reach `pkgKey`.
    if (
      view.unknown &&
      !view.externalOnly &&
      this.mayReach(this.pkgOf(type)?.key, pkgKey)
    )
      return true;
    if (view.iface) {
      const flat = this.interfaceMember(
        view.iface,
        name,
        undefined,
        pkgKey,
        [],
        true,
      );
      return flat.syms.length > 0 || flat.unknown;
    }
    return this.selectName([type], name, undefined, pkgKey).kind !== "none";
  }

  /**
   * A package that code outside the project can import: not `package main`, not a
   * `_test` package, and no `internal` element in its import path relative to its
   * own module (a nested go.mod starts a new module with a plain path). Assumes
   * modules sharing the path prefix above an `internal/` directory are in the
   * captured project (see the change note).
   */
  private outsideReachable(pkg: Pkg | undefined): boolean {
    if (!pkg) return true;
    if (pkg.name === "main" || pkg.name.endsWith("_test")) return false;
    const module = moduleOf(this.layout, pkg.directory);
    if (!module) return true;
    const relative =
      module.directory === ""
        ? pkg.directory
        : pkg.directory.slice(module.directory.length + 1);
    return !relative.split("/").includes("internal");
  }

  private externalMemo = new Map<string, boolean>();
  /** The type embeds, at any depth, a type outside the project (or an unresolvable one). */
  private embedsExternal(type: GraphSymbol, seen = new Set<string>()): boolean {
    const cached = this.externalMemo.get(type.id);
    if (cached !== undefined) return cached;
    // Already on this route (a cycle): the answer for the route is the rest's.
    if (seen.has(type.id)) return this.cut(false);
    const cutoffs = this.cutoffs;
    seen.add(type.id);
    const view = this.view(type);
    let result = !!view.unknown;
    for (const item of view.iface ? this.embedded(type) : view.embedded) {
      if (item.value.kind !== "project") result = true;
      else if (item.value.syms.some((sym) => this.embedsExternal(sym, seen)))
        result = true;
      if (result) break;
    }
    if (this.cutoffs === cutoffs) this.externalMemo.set(type.id, result);
    return result;
  }

  /**
   * Methods that may run for a call of `specs`, from the possible implementers of
   * `sources`. Implementations of an interface are known only when its whole method
   * set is (see `complete`). `open` is set when any member is not proven: its type
   * is not a proven implementer, its selection is uncertain because of an external
   * embedded type (the project declaration it would select otherwise is kept), or
   * it is reached through an embedded interface value (whose dynamic type may be
   * anything implementing that interface, inside or outside the project).
   */
  private implementations(
    specs: GraphSymbol[],
    name: string,
    sources: GraphSymbol[],
    enumerated: Set<string>,
  ): { targets: GraphSymbol[]; open: boolean } | undefined {
    // Covered only if an enclosing expansion already enumerates these interfaces'
    // implementers (a wrapper of the same interface adds nothing new).
    if (sources.length && sources.every((iface) => enumerated.has(iface.id)))
      return { targets: [], open: false };
    if (enumerated.size > MAX_DEPTH) return undefined;
    const inner = new Set([...enumerated, ...sources.map((iface) => iface.id)]);
    const out: GraphSymbol[] = [...specs];
    let known = false;
    let open = false;
    for (const iface of sources) {
      if (!this.complete.has(iface.id)) continue;
      known = true;
      const access = this.pkgOf(iface)?.key;
      const proven = new Set(
        (this.implementers.get(iface.id) ?? []).map((type) => type.id),
      );
      for (const type of this.possible.get(iface.id) ?? []) {
        let found = this.selectName([type], name, undefined, access);
        let certain = proven.has(type.id);
        if (found.kind === "unknown" || found.kind === "failed") {
          // An external embedded type might supply or shadow it; if not, Go selects
          // the project declaration found without that type. Keep it, unproven.
          certain = false;
          open = true;
          found = this.selectName([type], name, undefined, access, true);
          // Still unknown without external types: a structure that cannot be
          // determined (an unresolvable type, a failed file) may promote any
          // project method of this name. List those that pass the same crude
          // test (parameter and result counts, where known); the set is open.
          if (found.kind === "unknown" || found.kind === "failed")
            out.push(
              ...(this.methodsByName.get(name) ?? []).filter(
                (method) =>
                  !ownTypeParameters(method) &&
                  (exported(name) || this.pkgOf(method)?.key === access) &&
                  specs.some((spec) => countsMatch(spec, method)),
              ),
            );
        }
        if (found.kind !== "found") continue;
        if (!certain) open = true;
        const nested = found.syms.filter(
          (method) =>
            (method.data as { interface?: boolean } | undefined)?.interface,
        );
        out.push(...found.syms.filter((method) => !nested.includes(method)));
        if (nested.length) {
          const deeper = this.implementations(
            nested,
            name,
            this.ownersOf(nested),
            inner,
          );
          if (!deeper) return undefined;
          out.push(...deeper.targets);
          open = true;
        }
      }
    }
    return known ? { targets: unique(out), open } : undefined;
  }

  /**
   * Unknown receiver: every concrete project method of that name that a value
   * could carry, in any package and including test files; an unexported name only
   * from the caller's own package (elsewhere it is a different identifier). Always
   * open: the value may be of a type outside the project, or (with a failed or
   * untrusted file that could declare one) an unseen declaration.
   */
  private byName(name: string, from: string): Decision {
    const info = this.files.get(from);
    if (!info?.pkg) return UNRESOLVED;
    const found = (this.methodsByName.get(name) ?? []).filter(
      (symbol) => exported(name) || this.pkgOf(symbol)?.key === info.pkg!.key,
    );
    // A failed or untrusted file may declare a method of this name that the
    // set cannot list: an exported name in any such package, an unexported one
    // only in the caller's own.
    const unseen = exported(name)
      ? this.lossyPackages.size > 0
      : this.lossy(info.pkg);
    // Never definite: a single possibility stays unresolved (interface gap 3).
    return found.length >= 2
      ? {
          ids: found.map((symbol) => symbol.id),
          definite: false,
          open: unseen
            ? ["receiver-type-unknown", "declarations-may-be-unseen"]
            : ["receiver-type-unknown"],
        }
      : UNRESOLVED;
  }
}

/** A type's identity (see `GoResolver.identity`). */
type Identity =
  | { k: "u" }
  /** `ext`: declared outside the project (it may be an alias of anything). */
  | { k: "n"; id: string; a: Identity[]; ext?: true }
  | { k: "ptr" | "sl"; e: Identity }
  | { k: "ar"; len: string | null; e: Identity }
  | { k: "map"; key: Identity; e: Identity }
  | { k: "ch"; d: "b" | "s" | "r"; e: Identity }
  | { k: "fn"; p: Identity[]; r: Identity[]; v: boolean }
  | {
      k: "st";
      f: { n: string; x: boolean; t: Identity; g: string | null }[];
    }
  /** Methods by (qualified) name, sorted: a type set ignores order. */
  | { k: "if"; m: [string, Identity][] };
const UNKNOWN_IDENTITY: Identity = { k: "u" };
/** Predeclared aliases: `byte` is `uint8`, `rune` is `int32` (`any` is `interface{}`). */
const PREDECLARED_ALIASES: { [name: string]: string } = {
  byte: "uint8",
  rune: "int32",
};

/**
 * Go type identity over two identities: true only when proven identical, false
 * only when proven different, undefined otherwise. A difference anywhere proves
 * difference; otherwise anything unknown leaves the answer unknown.
 */
function identical(a: Identity, b: Identity): boolean | undefined {
  if (a.k === "u" || b.k === "u") return undefined;
  if (a.k !== b.k)
    // An external named type may be an alias of a literal.
    return (a.k === "n" && a.ext) || (b.k === "n" && b.ext) ? undefined : false;
  /** Every pair identical; `start`: what is already known (undefined: unknown). */
  const all = (
    pairs: [Identity, Identity][],
    start: boolean | undefined,
  ): boolean | undefined => {
    let result = start;
    for (const [x, y] of pairs) {
      const same = identical(x, y);
      if (same === false) return false;
      if (same === undefined) result = undefined;
    }
    return result;
  };
  const zip = (x: Identity[], y: Identity[]) =>
    x.map((item, index) => [item, y[index]!] as [Identity, Identity]);
  switch (a.k) {
    case "n": {
      const other = b as typeof a;
      if (a.id !== other.id) return a.ext || other.ext ? undefined : false;
      if (a.a.length !== other.a.length) return false;
      return all(zip(a.a, other.a), true);
    }
    case "ptr":
    case "sl":
      return identical(a.e, (b as typeof a).e);
    case "ar": {
      const other = b as typeof a;
      const length =
        a.len === null || other.len === null ? undefined : a.len === other.len;
      if (length === false) return false;
      return all([[a.e, other.e]], length);
    }
    case "map": {
      const other = b as typeof a;
      return all(
        [
          [a.key, other.key],
          [a.e, other.e],
        ],
        true,
      );
    }
    case "ch": {
      const other = b as typeof a;
      if (a.d !== other.d) return false;
      return identical(a.e, other.e);
    }
    case "fn": {
      const other = b as typeof a;
      if (
        a.p.length !== other.p.length ||
        a.r.length !== other.r.length ||
        a.v !== other.v
      )
        return false;
      return all([...zip(a.p, other.p), ...zip(a.r, other.r)], true);
    }
    case "st": {
      const other = b as typeof a;
      if (a.f.length !== other.f.length) return false;
      let tags: boolean | undefined = true;
      for (const [index, field] of a.f.entries()) {
        const peer = other.f[index]!;
        if (field.n !== peer.n || field.x !== peer.x) return false;
        if (field.g === null || peer.g === null) tags = undefined;
        else if (field.g !== peer.g) return false;
      }
      return all(
        a.f.map((field, index) => [field.t, other.f[index]!.t]),
        tags,
      );
    }
    case "if": {
      const other = b as typeof a;
      if (a.m.length !== other.m.length) return false;
      if (a.m.some(([key], index) => key !== other.m[index]![0])) return false;
      return all(
        a.m.map(([, sig], index) => [sig, other.m[index]![1]]),
        true,
      );
    }
  }
}

/**
 * The crude, over-inclusive signature test: the same number of results, and of
 * parameters unless either is variadic, where both signatures are known.
 */
/** A method declared with its own type parameters (`func (T) M[U any]()`). */
function ownTypeParameters(method: GraphSymbol): boolean {
  return (
    method.kind === "method" &&
    !!(method.data as { generic?: boolean } | undefined)?.generic
  );
}

function countsMatch(a: GraphSymbol, b: GraphSymbol): boolean {
  const x = (a.data as { sig?: TypeTerm } | undefined)?.sig;
  const y = (b.data as { sig?: TypeTerm } | undefined)?.sig;
  if (x?.k !== "fn" || y?.k !== "fn") return true;
  if (x.r.length !== y.r.length) return false;
  return !!x.v || !!y.v || x.p.length === y.p.length;
}

/** A reassigned local's static type comes from its declaration. */
/** The value an external entity denotes, with its standard-library type. */
function externalValue(entity: Extract<Entity, { e: "external" }>): TypeValue {
  return entity.std?.t === "value" && entity.std.type.k !== "unknown"
    ? { kind: "external", name: entity.name, std: entity.std.type }
    : { kind: "external", name: entity.name };
}

/** An element (or with `key`, the key) of a standard-library container. */
function stdItem(type: StdType, key: boolean): StdType | undefined {
  const item =
    type.k === "map"
      ? key
        ? type.key
        : type.e
      : type.k === "chan" || (type.k === "slice" && !key)
        ? type.e
        : undefined;
  return item && item.k !== "unknown" ? item : undefined;
}

/** The named type whose members a value of this type has (through one pointer). */
function stdNamedOf(type: StdType): StdNamed | undefined {
  const pointer = type.k === "ptr";
  const inner = pointer ? type.e : type;
  if (inner.k !== "named") return undefined;
  const named = stdTable().named(inner.pkg, inner.name);
  // A pointer to an interface has no methods.
  return named && !(pointer && named.shape === "i") ? named : undefined;
}

function staticDesc(desc: Desc): Desc {
  return desc.k === "var" ? desc.d : desc;
}
function isTypeSymbol(symbol: GraphSymbol): boolean {
  return TYPE_KINDS.has(symbol.kind);
}
function push(
  map: Map<string, Map<string, GraphSymbol[]>>,
  outer: string,
  inner: string,
  symbol: GraphSymbol,
): void {
  let group = map.get(outer);
  if (!group) map.set(outer, (group = new Map()));
  const list = group.get(inner);
  if (list) list.push(symbol);
  else group.set(inner, [symbol]);
}
function push2<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The context's files, symbols and links in a fixed, source-based order. */
function ordered(context: ResolutionContext): ResolutionContext {
  const place = (item: {
    file: string;
    range: { start: number; end: number };
    kind: string;
  }) => [item.file, item.range.start, item.range.end, item.kind] as const;
  const byPlace = (a: ReturnType<typeof place>, b: ReturnType<typeof place>) =>
    compareText(a[0], b[0]) ||
    a[1] - b[1] ||
    a[2] - b[2] ||
    compareText(a[3], b[3]);
  return {
    ...context,
    files: [...context.files].sort((a, b) => compareText(a.path, b.path)),
    symbols: [...context.symbols].sort(
      (a, b) =>
        byPlace(place(a), place(b)) ||
        compareText(a.identity, b.identity) ||
        compareText(a.id, b.id),
    ),
    links: [...context.links].sort(
      (a, b) =>
        byPlace(place(a), place(b)) ||
        compareText(a.targetName, b.targetName) ||
        compareText(a.id, b.id),
    ),
  };
}

/**
 * One answer from the answers of every configuration. A configuration that
 * finds nothing is one in which the referencing code does not compile, so it
 * does not count. Of the rest: definite only when all find the same
 * declarations; all found but different: the set of their answers (build
 * variants are candidates); any unknown or failed: that; any ambiguous:
 * ambiguous.
 */
function combineVariants(all: Selection[]): Selection {
  const results = all.filter((item) => item.kind !== "none");
  if (!results.length) return { kind: "none" };
  if (results.length === 1) return results[0]!;
  const causes = results.flatMap((item) =>
    item.kind === "failed" ? item.cause : [],
  );
  if (causes.length) return { kind: "failed", cause: unique(causes).sort() };
  if (results.some((item) => item.kind === "unknown"))
    return { kind: "unknown" };
  // A standard-library member (C-17): only when every configuration selects
  // the same one.
  const libraries = results.flatMap((item) =>
    item.kind === "library" ? [item.member] : [],
  );
  if (libraries.length) {
    const key = (member: StdMember) =>
      `${member.ownerPkg}\u0000${member.ownerType}\u0000${member.name}`;
    return libraries.length === results.length &&
      libraries.every((member) => key(member) === key(libraries[0]!))
      ? { kind: "library", member: libraries[0]! }
      : { kind: "unknown" };
  }
  const syms = unique(
    results.flatMap((item) =>
      item.kind === "found" || item.kind === "ambiguous" ? item.syms : [],
    ),
  );
  if (!syms.length) return { kind: "none" };
  if (results.every((item) => item.kind === "found"))
    return {
      kind: "found",
      syms,
      pointer: results.some((item) => item.kind === "found" && item.pointer),
    };
  return { kind: "ambiguous", syms };
}
