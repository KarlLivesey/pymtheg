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
import { TYPE_KINDS, type Desc, type FileFact, type TypeRef } from "./model.js";

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
  imports: Map<string, { path: string; pkgs: Pkg[] }>;
  dots: { path: string; pkgs: Pkg[] }[];
}
/**
 * What is known about a value's type. `external`: declared outside the project (its
 * members are not in the graph). `opaque`: known not to be resolvable (local named
 * type, constraint-less type parameter). `unknown`: not syntactically evident.
 */
type TypeValue =
  | { kind: "project"; syms: GraphSymbol[] }
  | { kind: "external"; name: string }
  | { kind: "cont"; e: Desc; key?: Desc; ch?: boolean; file: string }
  | { kind: "func"; r: Desc[]; file: string }
  | { kind: "tparam"; c?: TypeRef; file: string }
  | { kind: "opaque" }
  | { kind: "unknown" };
type Entity =
  | { e: "pkg"; pkgs: Pkg[]; path: string }
  | { e: "syms"; syms: GraphSymbol[] }
  | { e: "value"; type: TypeValue }
  /** Something declared outside the project (function, type or variable). */
  | { e: "external"; name: string }
  | { e: "none" };
const NONE: Entity = { e: "none" };
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
  | { kind: "unknown" };
interface InterfaceMethod {
  /** Name, plus the declaring package for an unexported name. */
  key: string;
  name: string;
  sig: string;
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
}
/** Why a candidate set is open, i.e. may omit the true target. */
export type OpenReason =
  /** Dispatch on an interface that a type outside the project could satisfy. */
  | "external-implementers-possible"
  /** A name-only set: the receiver's type, and so its package, is unknown. */
  | "receiver-type-unknown";
const UNRESOLVED: Decision = { ids: [], definite: false };

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
  /** The candidate set is open: it may omit the true target, for this reason. */
  open?: OpenReason;
  /** The call really is to a builtin (no package-level declaration shadows it). */
  builtin?: true;
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
  for (const [linkId, reason] of resolver.open) note(linkId).open = reason;
  return output;
}

class GoResolver {
  /** Links whose candidate sets exceeded their cap: unresolved, never truncated. */
  readonly overflow = new Map<string, Overflow>();
  /** Calls whose builtin name is not shadowed by a package-level declaration. */
  readonly builtins = new Set<string>();
  /** Candidate links whose set may omit a target outside the project. */
  readonly open = new Map<string, OpenReason>();
  private layout: GoProjectLayout;
  private files = new Map<string, FileInfo>();
  private pkgs = new Map<string, Pkg>();
  private symbolsById = new Map<string, GraphSymbol>();
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
      if (
        name?.builtinName &&
        this.lookupName(link.targetName, link.file).e !== "syms"
      )
        this.builtins.add(link.id);
      const {
        ids,
        definite,
        limit = CANDIDATE_LIMIT,
        open,
      } = this.resolveLink(link);
      const distinct = unique(ids).sort();
      if (distinct.length === 1 && definite)
        resolutions.push({ linkId: link.id, targetId: distinct[0]! });
      else if (distinct.length > 1 && distinct.length <= limit) {
        resolutions.push({ linkId: link.id, candidateIds: distinct });
        if (open) this.open.set(link.id, open);
      } else if (distinct.length > limit)
        // Too many to list: unresolved with the name kept; a cut list could omit the target.
        this.overflow.set(link.id, { candidates: distinct.length, cap: limit });
    }
    return { resolutions, links: added };
  }

  // ---- indexing ----------------------------------------------------------

  private index(): void {
    for (const file of this.context.files) {
      if (file.module !== this.moduleId || file.result.status === "failed")
        continue;
      const data = file.result.data as unknown as { go?: FileFact } | undefined;
      const fact = data?.go;
      if (!fact) continue;
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
    for (const symbol of this.context.symbols) {
      if (symbol.module !== this.moduleId || !this.files.has(symbol.file))
        continue;
      this.symbolsById.set(symbol.id, symbol);
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
        push2(
          this.members,
          `${pkg.key}\u0000${data.receiver}\u0000${symbol.name}`,
          symbol,
        );
        push2(this.methodsByName, symbol.name, symbol);
      } else if (data.owner !== undefined)
        // Fields and interface methods.
        push2(
          this.members,
          `${pkg.key}\u0000${data.owner}\u0000${symbol.name}`,
          symbol,
        );
    }
    for (const link of this.context.links)
      if (link.kind === "embeds" && link.sourceId)
        push2(this.embedsBySource, link.sourceId, link);
    for (const info of this.files.values())
      for (const item of info.fact.imports) {
        const pkgs = this.importTargets(info, item.path);
        const entry = { path: item.path, pkgs };
        if (item.alias === ".") info.dots.push(entry);
        else if (item.alias === "_") continue;
        else if (item.alias !== undefined) info.imports.set(item.alias, entry);
        else {
          const names = pkgs.length
            ? unique(pkgs.map((pkg) => pkg.name))
            : [conventionalName(item.path)];
          for (const name of names) info.imports.set(name, entry);
        }
      }
  }

  /** Go import rules over the snapshot, in the importing file's own module context. */
  private importTargets(from: FileInfo, path: string): Pkg[] {
    const directory = directoryOfImport(this.layout, from.directory, path);
    if (directory === undefined || ignoredDirectory(directory)) return [];
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
        return [];
    }
    return [...this.pkgs.values()].filter(
      (pkg) =>
        pkg.directory === directory &&
        !pkg.name.endsWith("_test") &&
        pkg.name !== "main",
    );
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

  private lookupName(name: string, from: string): Entity {
    const info = this.files.get(from);
    if (!info) return NONE;
    if (info.pkg) {
      const own = this.packageDecl(info.pkg, name, from);
      if (own.length) return { e: "syms", syms: own };
    }
    const imported = info.imports.get(name);
    if (imported) return { e: "pkg", pkgs: imported.pkgs, path: imported.path };
    const dotted: GraphSymbol[] = [];
    let externalDot = false;
    for (const dot of info.dots) {
      if (!dot.pkgs.length) externalDot = true;
      for (const pkg of dot.pkgs)
        if (exported(name)) dotted.push(...this.packageDecl(pkg, name, from));
    }
    if (dotted.length) return { e: "syms", syms: dotted };
    // A dot-imported external package may declare it.
    return externalDot && exported(name) ? { e: "external", name } : NONE;
  }

  private typeFromRef(ref: TypeRef, from: string, depth: number): TypeValue {
    if (ref.q === "") {
      // A predeclared type name, unless a package declaration shadows it.
      const declared = this.lookupName(ref.n, from);
      return declared.e === "syms" && declared.syms.every(isTypeSymbol)
        ? this.typeSyms(declared.syms, depth + 1)
        : { kind: "external", name: ref.n };
    }
    const key = `${from}\u0000${ref.q ?? ""}\u0000${ref.n}`;
    const cached = this.memo.get(key);
    if (cached) return cached;
    let value: TypeValue = UNKNOWN;
    if (depth < MAX_DEPTH) {
      if (ref.q !== undefined) {
        const base = this.lookupName(ref.q, from);
        // A qualifier that is no project import can only be an external import.
        if (base.e === "none" || base.e === "external")
          value = { kind: "external", name: `${ref.q}.${ref.n}` };
        else if (base.e === "pkg")
          value = base.pkgs.length
            ? this.typeSyms(
                base.pkgs.flatMap((pkg) =>
                  exported(ref.n) ? this.packageDecl(pkg, ref.n, from) : [],
                ),
                depth,
              )
            : { kind: "external", name: `${base.path}.${ref.n}` };
      } else {
        const found = this.lookupName(ref.n, from);
        if (found.e === "syms") value = this.typeSyms(found.syms, depth);
        else if (found.e === "external")
          value = { kind: "external", name: ref.n };
      }
    }
    this.memo.set(key, value);
    return value;
  }

  /** Follows aliases; non-type symbols give an unknown type. */
  private typeSyms(syms: GraphSymbol[], depth: number): TypeValue {
    const out: GraphSymbol[] = [];
    for (const symbol of syms) {
      if (!TYPE_KINDS.has(symbol.kind)) return UNKNOWN;
      if (symbol.kind === "alias") {
        const underlying = (symbol.data as { underlying?: TypeRef } | undefined)
          ?.underlying;
        if (!underlying) return UNKNOWN;
        const target = this.typeFromRef(underlying, symbol.file, depth + 1);
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
        if (container.kind === "external")
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
    return type.kind === "external" ? type : UNKNOWN;
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
      return {
        e: "syms",
        syms: exported(desc.n)
          ? base.pkgs.flatMap((pkg) => this.packageDecl(pkg, desc.n, from))
          : [],
      };
    }
    if (base.e === "external")
      return { e: "external", name: `${base.name}.${desc.n}` };
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
      if (type.kind !== "project") return NONE;
      const found = this.selectName(type.syms, desc.n, from);
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
    if (type.kind !== "project") return NONE;
    const found = this.selectName(type.syms, desc.n, from);
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
      const key =
        value.kind === "project"
          ? value.syms
              .map((symbol) => symbol.id)
              .sort()
              .join(",")
          : `${value.kind}:${link.file}:${link.range.start}`;
      return { value, pointer: !!data.pointer, key };
    });
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
        if (node.types.every((type) => type.kind === "interface")) {
          // An interface's method set is flat: identical methods inherited along
          // several paths merge, so it is one occurrence and is not expanded further.
          const flat = this.interfaceMember(node.types, name, from, access);
          // A project declaration of the name is the method even if an embedded
          // external interface also has it (identical methods merge); only when the
          // project declares none could an external embedded interface supply it.
          if (flat.syms.length)
            occurrences.push({ syms: flat.syms, pointer: node.pointer });
          else if (flat.unknown)
            if (!skipExternal)
              externalAt = Math.min(externalAt ?? depth, depth);
          continue;
        }
        const syms = unique(
          node.types.flatMap((type) => {
            const pkg = this.pkgOf(type);
            return pkg
              ? (
                  this.members.get(
                    `${pkg.key}\u0000${type.name}\u0000${name}`,
                  ) ?? []
                ).filter(
                  (symbol) =>
                    this.visible(symbol, from) &&
                    this.accessible(symbol, access),
                )
              : [];
          }),
        );
        if (syms.length) occurrences.push({ syms, pointer: node.pointer });
        const seen = new Set<string>();
        for (const type of node.types)
          for (const item of this.embedded(type)) {
            if (seen.has(item.key)) continue; // same embedding in build variants
            seen.add(item.key);
            if (item.value.kind !== "project") {
              if (!skipExternal) externalAt ??= depth + 1;
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
        if (
          item.value.kind !== "project" ||
          !item.value.syms.every((type) => type.kind === "interface")
        ) {
          unknown = true;
          continue;
        }
        const inner = this.interfaceMember(
          item.value.syms,
          name,
          from,
          access,
          [...path, iface.id],
        );
        syms.push(...inner.syms);
        unknown ||= inner.unknown;
      }
    }
    return { syms: unique(syms), unknown };
  }

  // ---- interfaces --------------------------------------------------------

  private canonical(sig: string, file: string): string {
    const info = this.files.get(file);
    const own = info?.pkg ? this.pkgIdentity(info.pkg) : `?${file}`;
    return sig
      .replace(/\u0004([^\u0003]+)\u0003/g, (_, name: string) =>
        info?.pkg && this.packageDecl(info.pkg, name, file).some(isTypeSymbol)
          ? `${own}.${name}`
          : name,
      )
      .replace(
        /\u0001([^\u0003]+)\u0003/g,
        (_, name: string) => `${own}.${name}`,
      )
      .replace(
        /\u0002([^.]+)\.([^\u0003]+)\u0003/g,
        (_, q: string, name: string) => {
          const entry = info?.imports.get(q);
          const target = entry
            ? entry.pkgs.length
              ? this.pkgIdentity(entry.pkgs[0]!)
              : entry.path
            : `?${q}`;
          return `${target}.${name}`;
        },
      );
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
      const add = (method: InterfaceMethod): boolean => {
        const existing = set.get(method.key);
        if (existing && existing.sig !== method.sig) return false;
        set.set(method.key, method);
        return true;
      };
      for (const symbol of this.ownMethods(iface)) {
        const sig = (symbol.data as { sig?: string } | undefined)?.sig;
        if (sig === undefined) return undefined;
        const access = exported(symbol.name) ? undefined : pkg.key;
        if (
          !add({
            key:
              access === undefined
                ? symbol.name
                : `${symbol.name}\u0000${access}`,
            name: symbol.name,
            sig: this.canonical(sig, symbol.file),
            access,
          })
        )
          return undefined;
      }
      for (const item of this.embedded(iface)) {
        if (item.value.kind !== "project" || item.value.syms.length !== 1)
          return undefined;
        const inner = item.value.syms[0]!;
        if (inner.kind !== "interface") return undefined;
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
    sig: string,
    access: string | undefined,
  ): { value: boolean; pointer: boolean; unknown?: true } {
    const found = this.selectName([type], name, undefined, access);
    // An external embedded type could supply (or shadow) it: not provable, not refuted.
    if (found.kind === "unknown")
      return { value: false, pointer: false, unknown: true };
    if (found.kind !== "found") return { value: false, pointer: false };
    const methods = found.syms;
    if (
      !methods.every((method) => {
        const data = (method.data ?? {}) as { sig?: string };
        return (
          method.kind === "method" &&
          data.sig !== undefined &&
          this.canonical(data.sig, method.file) === sig
        );
      })
    )
      return { value: false, pointer: false };
    const needsPointer = methods.some((method) => {
      const data = (method.data ?? {}) as {
        pointer?: boolean;
        interface?: boolean;
      };
      return !data.interface && !!data.pointer;
    });
    return { value: !needsPointer || found.pointer, pointer: true };
  }

  private implementsLinks(added: AddedLink[]): void {
    const interfaces: {
      iface: GraphSymbol;
      methods: Map<string, InterfaceMethod>;
    }[] = [];
    const types: GraphSymbol[] = [];
    for (const symbol of this.symbolsById.values()) {
      if (symbol.kind === "interface") {
        const methods = this.interfaceMethods(symbol);
        if (methods?.size) {
          interfaces.push({ iface: symbol, methods });
          this.complete.add(symbol.id);
        }
      } else if (symbol.kind === "struct" || symbol.kind === "type")
        types.push(symbol);
    }
    for (const type of types)
      for (const { iface, methods } of interfaces) {
        let byValue = true;
        let byPointer = true;
        let refuted = false;
        let unknown = false;
        for (const { name, sig, access } of methods.values()) {
          const has = this.hasMethod(type, name, sig, access);
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
          if (!has.pointer) {
            refuted = true;
            break;
          }
        }
        if (refuted) continue;
        // Not refuted: a possible implementer, so dispatch must list its method.
        push2(this.possible, iface.id, type);
        // Only a fully proven method set is a definite `implements` link.
        if (unknown) continue;
        push2(this.implementers, iface.id, type);
        added.push({
          key: `implements:${type.key}:${iface.id}`,
          file: type.file,
          sourceId: type.id,
          kind: "implements",
          targetName: iface.name,
          range: type.range,
          data: { pointerReceiver: !byValue, structural: true },
          targetId: iface.id,
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
        return this.definite(
          this.importTargets(info, data.path)
            .map((pkg) => pkg.symbol)
            .filter((symbol): symbol is GraphSymbol => !!symbol),
        );
      }
      case "receiver": {
        const info = this.files.get(link.file);
        if (!info?.pkg || !data.t) return UNRESOLVED;
        return this.definite(
          this.packageDecl(info.pkg, data.t.n, link.file).filter(isTypeSymbol),
        );
      }
      case "embeds":
      case "references":
      case "calls": {
        if (data.t) return this.definite(this.declaredTypes(data.t, link.file));
        if (data.expr) return this.resolveExpression(data.expr, link);
        return UNRESOLVED;
      }
      default:
        return UNRESOLVED;
    }
  }

  /** Type references link to the declaration named, including aliases themselves. */
  private declaredTypes(ref: TypeRef, from: string): GraphSymbol[] {
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
        if (found.kind !== "found") return UNRESOLVED;
        const specs = found.syms.filter(
          (symbol) =>
            (symbol.data as { interface?: boolean } | undefined)?.interface,
        );
        return specs.length
          ? this.dispatch(
              specs,
              name,
              type.syms.every((symbol) => symbol.kind === "interface")
                ? type.syms
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
    const found = this.implementations(specs, name, sources, new Set());
    if (
      !found ||
      !found.targets.some(
        (symbol) =>
          !(symbol.data as { interface?: boolean } | undefined)?.interface,
      )
    )
      return UNRESOLVED;
    const closed =
      exact && !found.open && staticTypes!.every((type) => this.sealed(type));
    return {
      ids: [...specs, ...found.targets].map((symbol) => symbol.id),
      definite: false,
      limit: DISPATCH_LIMIT,
      ...(closed ? {} : { open: "external-implementers-possible" as const }),
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

  private hiddenMemo = new Map<string, boolean>();
  /**
   * Can code outside the project obtain package `pkgKey`'s unexported method `name`
   * (and so implement interfaces that need it)? Only through an exported CARRIER
   * declared in an OUTSIDE-REACHABLE package. Anything uncertain answers yes.
   */
  private hiddenReachable(name: string, pkgKey: string): boolean {
    const key = `${pkgKey}\u0000${name}`;
    const cached = this.hiddenMemo.get(key);
    if (cached !== undefined) return cached;
    const { carriers, uncertain } = this.carriersOf(name, pkgKey);
    let reachable = uncertain;
    for (const carrier of carriers) {
      if (reachable) break;
      const data = (carrier.data ?? {}) as { local?: boolean };
      if (
        exported(carrier.name) &&
        !data.local &&
        !this.files.get(carrier.file)?.fact.test &&
        this.outsideReachable(this.pkgOf(carrier))
      )
        reachable = true;
    }
    this.hiddenMemo.set(key, reachable);
    return reachable;
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

  /**
   * Every project type whose method set includes package `pkgKey`'s unexported
   * `name`, transitively: declaring interfaces and types, structs embedding a carrier
   * at any depth (by value or pointer, including embedded interfaces), interfaces
   * embedding a carrier, defined types and aliases whose underlying type is a
   * carrier, generic types (by their declaration). `uncertain` when an embedded or
   * underlying project type cannot be resolved.
   */
  private carriersOf(
    name: string,
    pkgKey: string,
  ): { carriers: GraphSymbol[]; uncertain: boolean } {
    const types = [...this.symbolsById.values()].filter((symbol) =>
      TYPE_KINDS.has(symbol.kind),
    );
    const carrying = new Set<string>();
    let uncertain = false;
    const underlying = (type: GraphSymbol): TypeValue | undefined => {
      const ref = (type.data as { underlying?: TypeRef } | undefined)
        ?.underlying;
      return ref ? this.typeFromRef(ref, type.file, 1) : undefined;
    };
    for (let changed = true, rounds = 0; changed && rounds < 50; rounds++) {
      changed = false;
      for (const type of types) {
        if (carrying.has(type.id)) continue;
        let carries = false;
        if (type.kind === "interface") {
          carries = this.ownMethods(type).some(
            (method) =>
              method.name === name && this.pkgOf(method)?.key === pkgKey,
          );
          for (const item of this.embedded(type)) {
            if (item.value.kind === "project")
              carries ||= item.value.syms.some((sym) => carrying.has(sym.id));
            else if (item.value.kind === "unknown") uncertain = true;
          }
        } else if (type.kind === "struct") {
          const found = this.selectName([type], name, undefined, pkgKey);
          carries = found.kind === "found" || found.kind === "ambiguous";
          // Embedded defined types/aliases that carry it are found via the fixpoint.
          for (const item of this.embedded(type)) {
            if (item.value.kind === "project")
              carries ||= item.value.syms.some((sym) => carrying.has(sym.id));
            else if (item.value.kind === "unknown") uncertain = true;
          }
        } else {
          // Defined type or alias: keeps an interface's method set and a struct's
          // promoted methods (conservatively: any carrying underlying type).
          const value = underlying(type);
          if (value?.kind === "project")
            carries = value.syms.some((sym) => carrying.has(sym.id));
          else if (value?.kind === "unknown") uncertain = true;
          // Methods declared on a defined type itself.
          if (!carries) {
            const found = this.selectName([type], name, undefined, pkgKey);
            carries = found.kind === "found";
          }
        }
        if (carries) {
          carrying.add(type.id);
          changed = true;
        }
      }
    }
    return {
      carriers: types.filter((type) => carrying.has(type.id)),
      uncertain,
    };
  }

  private externalMemo = new Map<string, boolean>();
  /** The type embeds, at any depth, a type outside the project (or an unresolvable one). */
  private embedsExternal(type: GraphSymbol, seen = new Set<string>()): boolean {
    const cached = this.externalMemo.get(type.id);
    if (cached !== undefined) return cached;
    if (seen.has(type.id)) return false;
    seen.add(type.id);
    let result = false;
    for (const item of this.embedded(type)) {
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
        if (found.kind === "unknown") {
          // An external embedded type might supply or shadow it; if not, Go selects
          // the project declaration found without that type. Keep it, unproven.
          certain = false;
          open = true;
          found = this.selectName([type], name, undefined, access, true);
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
