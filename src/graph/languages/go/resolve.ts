import { posix } from "node:path";
import type {
  AddedLink,
  ContextFile,
  GraphFile,
  GraphLink,
  GraphSymbol,
  LinkResolution,
  ResolutionContext,
  ResolutionResult,
} from "../../types.js";
import {
  directoryOfImport,
  importPathOf,
  moduleOf,
  readLayout,
} from "./gomod.js";
import type { GoProjectLayout } from "./gomod.js";
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
  | { kind: "external"; name: string; shadowable?: true }
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
  /** Something declared outside the project (function, type or variable). */
  | { e: "external"; name: string }
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
  | { kind: "failed"; cause: string[] };
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
}
interface InterfaceMethod {
  /** Name, plus the declaring package for an unexported name. */
  key: string;
  name: string;
  sig: Identity;
  /** Declaring package of an unexported method (it is a different identifier elsewhere). */
  access?: string | undefined;
}
interface Decision {
  ids: string[];
  /** Only a definite decision may become a single target. */
  definite: boolean;
  /** Candidate cap for this kind of decision. */
  limit?: number;
  /** Why the set may omit a target outside the project (absent: complete). */
  open?: OpenReason;
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
}
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
/** Directories the go tool ignores when importing (testdata, _x, .x). */
const ignoredDirectory = (directory: string) =>
  directory
    .split("/")
    .some(
      (part) =>
        part === "testdata" || part.startsWith("_") || part.startsWith("."),
    );
/** Package name a non-project import is conventionally referred to by (only used to recognise qualifiers). */
export function conventionalName(path: string): string {
  const parts = path.split("/");
  let last = parts.at(-1) ?? path;
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts.at(-2)!;
  last = last.replace(/\.v\d+$/, "");
  if (last.startsWith("go-")) last = last.slice(3);
  return last.replace(/[.-]/g, "_");
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
  private selections = new Map<string, Selection>();

  constructor(
    private readonly moduleId: string,
    private readonly context: ResolutionContext,
    /**
     * Only to name an open set's reasons: resolve as if no file were lossy
     * (failed files' directories are not treated as holding unseen ones).
     */
    private readonly ignoreLossy = false,
  ) {
    this.layout = readLayout(context.contextFiles);
  }

  run(): ResolutionResult {
    this.index();
    const added: AddedLink[] = [];
    this.implementsLinks(added);
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
        !decision.invalid?.length &&
        !decision.dispatch &&
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
    }
    return { resolutions, links: added };
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
    open: OpenReason | undefined,
  ): OpenReason[] {
    const unseen = "declarations-may-be-unseen" as const;
    if (!this.lossyPackages.size) return open ? [open] : [];
    const lossyMember = ids.some((id) => {
      const symbol = this.symbolsById.get(id);
      return !!symbol && this.lossy(this.pkgOf(symbol));
    });
    if (open === "external-implementers-possible") {
      // Open for outside implementers only if it still is without the lossy
      // files (the dispatch label "structural only" counts as not).
      const shadow = this.shadow().resolveLink(link);
      if (shadow.open !== "external-implementers-possible") return [unseen];
      return lossyMember ? [open, unseen] : [open];
    }
    if (open) return lossyMember && open !== unseen ? [open, unseen] : [open];
    return lossyMember ? [unseen] : [];
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

  private index(): void {
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
  private importTargets(
    from: FileInfo,
    path: string,
  ): { pkgs: Pkg[]; uncertain: boolean; failed?: string[] } {
    const destinations = directoryOfImport(this.layout, from.directory, path);
    const directories = destinations.directories.filter(
      (directory) => !ignoredDirectory(directory),
    );
    const outside =
      destinations.outside ||
      directories.length < destinations.directories.length;
    if (!directories.length) return { pkgs: [], uncertain: false };
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
    const pkgs = [...this.pkgs.values()].filter(
      (pkg) =>
        directories.includes(pkg.directory) &&
        !pkg.name.endsWith("_test") &&
        pkg.name !== "main",
    );
    const captured = new Set(pkgs.map((pkg) => pkg.directory));
    const possible = directories.length + (outside ? 1 : 0);
    const uncertain =
      possible > 1 && (outside || captured.size < directories.length);
    // Every file of the package failed (nothing valid there): the import needs
    // code in those files, so it is failed with them as the cause.
    if (!pkgs.length && !outside) {
      const cause = directories.flatMap((directory) =>
        this.failedCause(
          directory,
          from.fact.test && from.directory === directory,
        ),
      );
      if (cause.length) return { pkgs, uncertain: false, failed: cause };
    }
    return { pkgs, uncertain };
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
    if (depth > MAX_DEPTH) return UNKNOWN;
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
        : { kind: "external", name: ref.n };
    }
    const key = `${from}\u0000${ref.q ?? ""}\u0000${ref.n}`;
    const cached = this.memo.get(key);
    if (cached) return cached;
    let value: TypeValue = UNKNOWN;
    if (depth < MAX_DEPTH) {
      if (ref.q !== undefined) {
        const base = this.lookupName(ref.q, from);
        // A qualifier that is no project import can only be an external import
        // (a valid file's imports are all known).
        if (base.e === "none" || base.e === "external")
          value = { kind: "external", name: `${ref.q}.${ref.n}` };
        else if (base.e === "unknown" && base.cause)
          value = { kind: "failed", cause: base.cause };
        else if (base.e === "pkg") {
          const reader = this.files.get(from);
          const found = reader
            ? this.scopeLookup(base.pkgs, ref.n, reader, true)
            : { syms: [], cause: [] };
          value = !base.pkgs.length
            ? { kind: "external", name: `${base.path}.${ref.n}` }
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
    this.memo.set(key, value);
    return value;
  }

  /** Aliases being followed: a cycle (`type A = B; type B = A`) is unknown. */
  private aliasesFollowed = new Set<string>();
  /** Follows aliases; non-type symbols give an unknown type. */
  private typeSyms(syms: GraphSymbol[], depth: number): TypeValue {
    if (depth > MAX_DEPTH) return UNKNOWN;
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
        if (this.aliasesFollowed.has(symbol.id)) return UNKNOWN;
        this.aliasesFollowed.add(symbol.id);
        let target: TypeValue;
        try {
          target = this.typeFromRef(data.underlying, symbol.file, depth + 1);
        } finally {
          this.aliasesFollowed.delete(symbol.id);
        }
        if (target.kind !== "project") return target;
        out.push(...target.syms);
      } else out.push(symbol);
    }
    return out.length ? { kind: "project", syms: unique(out) } : UNKNOWN;
  }

  /** The type of a value description evaluated in `file`. */
  private typeOf(desc: Desc, file: string, depth: number): TypeValue {
    const entity = this.denote(staticDesc(desc), file, depth + 1);
    if (entity.e === "value") return entity.type;
    if (entity.e === "external") return { kind: "external", name: entity.name };
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
    if (depth > MAX_DEPTH) return UNKNOWN;
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
    return values.every((value) => keyOf(value) === first)
      ? values[0]!
      : UNKNOWN;
  }

  /** What an expression denotes: a package, declarations, an external thing, or a typed value. */
  private denote(desc: Desc, from: string, depth: number): Entity {
    if (depth > MAX_DEPTH) return NONE;
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
      case "elem":
      case "key": {
        const container = this.typeOf(desc.x, from, depth + 1);
        if (container.kind === "external" || container.kind === "failed")
          return { e: "value", type: container };
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
      default:
        return { e: "value", type: UNKNOWN };
    }
  }

  private callResult(
    desc: Extract<Desc, { k: "call" }>,
    from: string,
    depth: number,
  ): TypeValue {
    const callee = this.denote(desc.f, from, depth + 1);
    if (callee.e === "external")
      return { kind: "external", name: `${callee.name}()` };
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
    const results = callee.syms.map((symbol) => {
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

  private select(
    desc: Extract<Desc, { k: "sel" }>,
    from: string,
    depth: number,
  ): Entity {
    const base = this.denote(staticDesc(desc.x), from, depth + 1);
    if (base.e === "pkg") {
      if (!base.pkgs.length)
        return { e: "external", name: `${base.path}.${desc.n}` };
      const reader = this.files.get(from);
      if (!reader) return NONE;
      // Not among the package's valid files, which has failed files: those are
      // the cause (any of them might have declared it).
      const found = this.scopeLookup(base.pkgs, desc.n, reader, true);
      if (found.cause.length) return { e: "unknown", cause: found.cause };
      return { e: "syms", syms: found.syms };
    }
    if (base.e === "external")
      return { e: "external", name: `${base.name}.${desc.n}` };
    if (base.e === "unknown") return base.cause ? base : NONE;
    // `q.X` with q neither local nor declared in the package: q can only be one of
    // this file's imports; not a project import, so it is external.
    if (base.e === "none")
      return desc.x.k === "name"
        ? { e: "external", name: `${desc.x.n}.${desc.n}` }
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
      return { e: "external", name: `${type.name}.${desc.n}` };
    if (type.kind === "failed") return { e: "unknown", cause: type.cause };
    if (type.kind !== "project") return NONE;
    const found = this.selectName(type.syms, desc.n, from);
    if (found.kind === "failed") return { e: "unknown", cause: found.cause };
    if (found.kind !== "found") return NONE;
    if (found.syms.every((symbol) => symbol.kind === "field"))
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
    const data = (type.data ?? {}) as {
      shape?: string;
      underlying?: TypeRef;
      underlyingPointer?: boolean;
    };
    const pkg = this.pkgOf(type);
    const own = (name: string) =>
      pkg
        ? (this.members.get(`${pkg.key}\u0000${type.name}\u0000${name}`) ?? [])
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
    if (depth > MAX_DEPTH) result = unknown();
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
    this.views.set(type.id, result);
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
  ): Selection {
    // An external type can never declare a project package's unexported name, so
    // for unexported names embedded external types are irrelevant.
    const skipExternal = ignoreExternal || !exported(name);
    const memoKey = `${skipExternal ? "x" : ""}${types
      .map((type) => type.id)
      .sort()
      .join(
        ",",
      )}\u0000${name}\u0000${access ?? ""}\u0000${from === undefined ? "" : this.files.get(from)?.fact.test ? `t:${directoryOf(from)}` : "n"}`;
    const cached = this.selections.get(memoKey);
    if (cached) return cached;
    let level: { types: GraphSymbol[]; pointer: boolean; path: string[] }[] = [
      { types: unique(types), pointer: false, path: [] },
    ];
    let externalAt: number | undefined;
    let result: Selection = { kind: "none" };
    const causes: string[] = [];
    const reader = from === undefined ? undefined : this.files.get(from);
    for (let depth = 0; level.length; depth++) {
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
                this.visible(symbol, from) && this.accessible(symbol, access),
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
            types: item.value.syms,
            pointer: node.pointer || item.pointer,
            path: [...node.path, ...ids],
          });
        }
      }
      if (externalAt !== undefined && externalAt <= depth) {
        result = { kind: "unknown" };
        break;
      }
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
    this.selections.set(memoKey, result);
    return result;
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
      // (identity only annotates). The first declaration found is kept.
      const add = (method: InterfaceMethod): boolean => {
        if (!set.has(method.key)) set.set(method.key, method);
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
        } = this.importTargets(info, data.path);
        if (cause) return failed(cause);
        const symbols = pkgs
          .map((pkg) => pkg.symbol)
          .filter((symbol): symbol is GraphSymbol => !!symbol);
        // Which destination Go uses is not proven: never definite.
        return uncertain
          ? {
              ids: symbols.map((symbol) => symbol.id),
              definite: false,
              open: "import-destination-uncertain",
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
   * The failed-file causes of every type term a link's source mentions: the
   * written types of its receiver chain's values, variables, parameters, fields
   * and results, including type arguments, followed transitively through valid
   * declarations (underlying types of defined types, alias targets, embedded
   * fields). "Depends on a failed file" is decided by what the source mentions,
   * not by how far resolution got. Instantiation is not modelled.
   */
  private involvedCause(link: GraphLink): string[] {
    const causes = new Set<string>();
    const seen = new Set<string>();
    const add = (cause: string[] | undefined) =>
      cause?.forEach((file) => causes.add(file));
    // `embedded`: whether the lookup still depends on the types embedded in this
    // type (not when the member was found on it, so depth 0 decided).
    const ref = (
      r: TypeRef | undefined,
      file: string,
      depth: number,
      embedded = true,
    ) => {
      if (!r || r.q === "" || r.l !== undefined || depth > MAX_DEPTH) return;
      const key = `ref\u0000${embedded}\u0000${file}\u0000${r.q ?? ""}\u0000${r.n}`;
      if (seen.has(key)) return;
      seen.add(key);
      const type = this.typeFromRef(r, file, 1);
      if (type.kind === "failed") return add(type.cause);
      for (const symbol of this.declaredTypes(r, file))
        typeSym(symbol, depth + 1, embedded);
      if (type.kind === "project")
        for (const symbol of type.syms) typeSym(symbol, depth + 1, embedded);
    };
    const term = (t: TypeTerm | undefined, file: string, depth: number) => {
      if (!t || depth > MAX_DEPTH) return;
      switch (t.k) {
        case "n":
          if (!t.p)
            ref(
              t.q === undefined ? { n: t.n } : { q: t.q, n: t.n },
              file,
              depth,
            );
          t.a?.forEach((item) => term(item, file, depth + 1));
          return;
        case "ptr":
        case "sl":
        case "ar":
        case "ch":
          return term(t.e, file, depth + 1);
        case "map":
          term(t.key, file, depth + 1);
          return term(t.e, file, depth + 1);
        case "fn":
          return [...t.p, ...t.r].forEach((item) =>
            term(item, file, depth + 1),
          );
        case "st":
          return t.f.forEach((field) => term(field.t, file, depth + 1));
        case "if":
          t.m.forEach((method) => term(method.s, file, depth + 1));
          return t.e.forEach((item) => term(item, file, depth + 1));
        default:
          return;
      }
    };
    const typeSym = (symbol: GraphSymbol, depth: number, embedded = true) => {
      const key = `type\u0000${embedded}\u0000${symbol.id}`;
      if (seen.has(key) || depth > MAX_DEPTH) return;
      seen.add(key);
      const data = (symbol.data ?? {}) as {
        underlying?: TypeRef;
        target?: TypeTerm;
      };
      ref(data.underlying, symbol.file, depth, embedded);
      term(data.target, symbol.file, depth);
      if (embedded)
        for (const embed of this.embedsBySource.get(symbol.id) ?? [])
          ref(
            (embed.data as { t?: TypeRef } | undefined)?.t,
            embed.file,
            depth,
          );
    };
    const symbolDesc = (symbol: GraphSymbol, depth: number) => {
      if (TYPE_KINDS.has(symbol.kind)) return typeSym(symbol, depth);
      if (seen.has(symbol.id) || depth > MAX_DEPTH) return;
      seen.add(symbol.id);
      const data = (symbol.data ?? {}) as {
        d?: Desc;
        t?: TypeRef;
        v?: Desc;
        results?: Desc[];
      };
      desc(data.d, symbol.file, depth + 1);
      ref(data.t, symbol.file, depth + 1);
      desc(data.v, symbol.file, depth + 1);
      data.results?.forEach((item) => desc(item, symbol.file, depth + 1));
    };
    const entity = (found: Entity, depth: number) => {
      if (found.e === "unknown") add(found.cause);
      if (found.e === "value" && found.type.kind === "failed")
        add(found.type.cause);
      if (found.e === "syms")
        for (const symbol of found.syms) symbolDesc(symbol, depth + 1);
    };
    const desc = (
      d: Desc | undefined,
      file: string,
      depth: number,
      embedded = true,
    ): void => {
      if (!d || depth > MAX_DEPTH) return;
      switch (d.k) {
        case "val":
          ref(d.t, file, depth, embedded);
          return d.ta?.forEach((item) => desc(item, file, depth + 1));
        case "name":
          return entity(this.lookupName(d.n, file), depth);
        case "sel": {
          // A named field of an anonymous struct: only its own type matters.
          const base = anonymous(d.x, depth);
          const field = base?.f?.find((item) => item.n === d.n);
          if (field) return desc(field.d, file, depth + 1);
          // A member found on the operand's type: the types embedded in that
          // type cannot change the answer.
          const found = this.select(d, file, 0);
          desc(
            d.x,
            file,
            depth + 1,
            !(found.e === "syms" || found.e === "value"),
          );
          return entity(found, depth);
        }
        case "call": {
          // Only the result this call uses: a function's or method's declared
          // result i; for anything else (a func value), what the callee is.
          const callee = this.denote(d.f, file, 0);
          const functions =
            callee.e === "syms" &&
            callee.syms.every(
              (symbol) =>
                (symbol.kind === "function" || symbol.kind === "method") &&
                (symbol.data as { results?: Desc[] } | undefined)?.results,
            );
          if (!functions) {
            desc(d.f, file, depth + 1);
            return entity(callee, depth);
          }
          for (const symbol of callee.syms) {
            const results = (symbol.data as { results: Desc[] }).results;
            desc(results[d.i], symbol.file, depth + 1);
          }
          // A generic result is one of the type arguments written: on the
          // call (`F[A](x)`), on the callee, or on the receiver's type.
          d.ta?.forEach((item) => desc(item, file, depth + 1));
          if (d.f.k === "inst")
            d.f.ta?.forEach((item) => desc(item, file, depth + 1));
          if (d.f.k === "sel") typeArgs(d.f.x, file, depth + 1);
          return;
        }
        case "inst":
          d.ta?.forEach((item) => desc(item, file, depth + 1));
          return desc(d.x, file, depth + 1);
        case "elem":
        case "key":
          return desc(d.x, file, depth + 1);
        case "local":
        case "unknown":
          return d.m?.forEach((item) => desc(item, file, depth + 1));
        case "cont":
          desc(d.e, file, depth + 1);
          return desc(d.key, file, depth + 1);
        case "func":
          return d.r.forEach((item) => desc(item, file, depth + 1));
        case "tval":
          return ref(d.c, file, depth);
        case "var":
          desc(d.d, file, depth + 1);
          return d.alts?.forEach((item) => desc(item, file, depth + 1));
        default:
          return;
      }
    };
    // The anonymous struct a value has, through variables and container elements.
    const anonymous = (
      d: Desc,
      depth: number,
    ): Extract<Desc, { k: "local" }> | undefined => {
      if (depth > MAX_DEPTH) return undefined;
      if (d.k === "local") return d;
      if (d.k === "var") return anonymous(d.d, depth + 1);
      if (d.k === "elem" || d.k === "key") {
        let x = d.x;
        while (x.k === "var") x = x.d;
        if (x.k !== "cont") return undefined;
        const item = d.k === "key" && !x.ch ? x.key : x.e;
        return item ? anonymous(item, depth + 1) : undefined;
      }
      return undefined;
    };
    // The type arguments written on a receiver's declared type (`var b Box[A]`).
    const typeArgs = (d: Desc, file: string, depth: number): void => {
      if (depth > MAX_DEPTH) return;
      if (d.k === "val") d.ta?.forEach((item) => desc(item, file, depth + 1));
      if (d.k === "var") typeArgs(d.d, file, depth + 1);
    };
    const data = (link.data ?? {}) as { expr?: Desc; t?: TypeRef };
    ref(data.t, link.file, 0);
    desc(data.expr, link.file, 0);
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
    let open: OpenReason | undefined;
    for (const spec of specs) {
      const dispatched = this.dispatch([spec], spec.name);
      if (!dispatched.ids.length) return UNRESOLVED;
      ids.push(...dispatched.ids);
      open ??= dispatched.open;
    }
    return {
      ids,
      definite: false,
      limit: DISPATCH_LIMIT,
      dispatch: true,
      ...(open ? { open } : {}),
    };
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
    // (A directory whose every file failed has no package here, but counts.)
    const unseen =
      (this.lossyPackages.size > 0 || this.failedFiles.size > 0) &&
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
      open: sealedOnly
        ? "structural-match-unverified"
        : "external-implementers-possible",
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
      const pkg = this.pkgs.get(queue.shift()!);
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
    this.hiddenMemo.set(key, reachable);
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
    if (seen.has(type.id)) return false;
    seen.add(type.id);
    const view = this.view(type);
    let result = !!view.unknown;
    for (const item of view.iface ? this.embedded(type) : view.embedded) {
      if (item.value.kind !== "project") result = true;
      else if (item.value.syms.some((sym) => this.embedsExternal(sym, seen)))
        result = true;
      if (result) break;
    }
    this.externalMemo.set(type.id, result);
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
   * open: the value may be of a type outside the project.
   */
  private byName(name: string, from: string): Decision {
    const info = this.files.get(from);
    if (!info?.pkg) return UNRESOLVED;
    const found = (this.methodsByName.get(name) ?? []).filter(
      (symbol) => exported(name) || this.pkgOf(symbol)?.key === info.pkg!.key,
    );
    // Never definite: a single possibility stays unresolved (interface gap 3).
    return found.length >= 2
      ? {
          ids: found.map((symbol) => symbol.id),
          definite: false,
          open: "receiver-type-unknown",
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
function countsMatch(a: GraphSymbol, b: GraphSymbol): boolean {
  const x = (a.data as { sig?: TypeTerm } | undefined)?.sig;
  const y = (b.data as { sig?: TypeTerm } | undefined)?.sig;
  if (x?.k !== "fn" || y?.k !== "fn") return true;
  if (x.r.length !== y.r.length) return false;
  return !!x.v || !!y.v || x.p.length === y.p.length;
}

/** A reassigned local's static type comes from its declaration. */
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
