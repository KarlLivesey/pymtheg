import { posix } from "node:path";
import type {
  AddedLink,
  GraphLink,
  GraphSymbol,
  LinkResolution,
  ResolutionContext,
  ResolutionResult,
} from "../../types.js";
import { directoryOfImport, importPathOf, readLayout } from "./gomod.js";
import type { GoProjectLayout } from "./gomod.js";
import { TYPE_KINDS, type Desc, type FileFact, type TypeRef } from "./model.js";

/** Above this many possible targets an unknown-receiver call stays unresolved (recorded in data docs). */
export const CANDIDATE_LIMIT = 20;
const MAX_DEPTH = 12;

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
type TypeValue =
  | { kind: "project"; syms: GraphSymbol[] }
  | { kind: "external"; name: string }
  | { kind: "unknown" };
type Entity =
  | { e: "pkg"; pkgs: Pkg[]; path: string }
  | { e: "syms"; syms: GraphSymbol[] }
  | { e: "value"; type: TypeValue }
  | { e: "none" };
const NONE: Entity = { e: "none" };
const UNKNOWN: TypeValue = { kind: "unknown" };

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

class GoResolver {
  private layout: GoProjectLayout;
  private files = new Map<string, FileInfo>();
  private pkgs = new Map<string, Pkg>();
  private symbolsById = new Map<string, GraphSymbol>();
  private byFileKey = new Map<string, GraphSymbol>();
  private decls = new Map<string, Map<string, GraphSymbol[]>>();
  private methods = new Map<string, GraphSymbol[]>();
  private members = new Map<string, GraphSymbol[]>();
  private methodsByName = new Map<string, GraphSymbol[]>();
  private embedsBySource = new Map<string, GraphLink[]>();
  private implementers = new Map<string, { type: GraphSymbol }[]>();
  private reachable = new Map<string, Set<string>>();
  private memo = new Map<string, TypeValue>();

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
      const ids = this.resolveLink(link);
      if (ids.length === 1)
        resolutions.push({ linkId: link.id, targetId: ids[0]! });
      else if (ids.length > 1)
        resolutions.push({ linkId: link.id, candidateIds: ids });
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
      const data = (symbol.data ?? {}) as {
        receiver?: string;
        owner?: string;
        interface?: boolean;
      };
      if (symbol.kind === "package") pkg.symbol = symbol;
      else if (
        TYPE_KINDS.has(symbol.kind) ||
        symbol.kind === "var" ||
        symbol.kind === "const" ||
        (symbol.kind === "function" && symbol.name !== "init")
      )
        push(this.decls, pkg.key, symbol.name, symbol);
      else if (symbol.kind === "method" && data.receiver !== undefined) {
        push2(this.methods, `${pkg.key}\u0000${data.receiver}`, symbol);
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

  /** Go import rules over the snapshot: module path mapping, internal visibility, non-main packages. */
  private importTargets(from: FileInfo, path: string): Pkg[] {
    const directory = directoryOfImport(this.layout, path);
    if (directory === undefined || ignoredDirectory(directory)) return [];
    const parts = path.split("/");
    const internal = parts.lastIndexOf("internal");
    if (internal >= 0) {
      const parent = parts.slice(0, internal).join("/");
      const importer = from.pkg
        ? importPathOf(this.layout, from.directory)
        : undefined;
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
  private visible(symbol: GraphSymbol, from: string): boolean {
    const declared = this.files.get(symbol.file);
    if (!declared?.fact.test) return true;
    const reader = this.files.get(from);
    return !!reader?.fact.test && reader.directory === declared.directory;
  }

  // ---- names, types, members ---------------------------------------------

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
    for (const dot of info.dots)
      for (const pkg of dot.pkgs)
        if (exported(name)) dotted.push(...this.packageDecl(pkg, name, from));
    return dotted.length ? { e: "syms", syms: dotted } : NONE;
  }

  private typeFromRef(ref: TypeRef, from: string, depth: number): TypeValue {
    if (ref.q === "") return { kind: "external", name: ref.n };
    const key = `${from}\u0000${ref.q ?? ""}\u0000${ref.n}`;
    const cached = this.memo.get(key);
    if (cached) return cached;
    let value: TypeValue = UNKNOWN;
    if (depth < MAX_DEPTH) {
      if (ref.q !== undefined) {
        const base = this.lookupName(ref.q, from);
        if (base.e === "pkg")
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

  /** Type of a variable, constant or field symbol, evaluated in its own file. */
  private valueType(symbol: GraphSymbol, depth: number): TypeValue {
    const data = (symbol.data ?? {}) as { d?: Desc; t?: TypeRef };
    if (symbol.kind === "field" && data.t)
      return this.typeFromRef(data.t, symbol.file, depth + 1);
    if ((symbol.kind === "var" || symbol.kind === "const") && data.d) {
      const entity = this.denote(data.d, symbol.file, depth + 1);
      return entity.e === "value" ? entity.type : UNKNOWN;
    }
    return UNKNOWN;
  }

  private sameType(values: TypeValue[]): TypeValue {
    if (!values.length) return UNKNOWN;
    const [first] = values;
    const keyOf = (value: TypeValue) =>
      value.kind === "project"
        ? value.syms
            .map((symbol) => symbol.id)
            .sort()
            .join(",")
        : value.kind === "external"
          ? `x:${value.name}`
          : "?";
    return values.every((value) => keyOf(value) === keyOf(first!))
      ? first!
      : UNKNOWN;
  }

  /** What an expression denotes: a package, declarations, or a value of some type. */
  private denote(desc: Desc, from: string, depth: number): Entity {
    if (depth > MAX_DEPTH) return NONE;
    switch (desc.k) {
      case "name":
        return this.lookupName(desc.n, from);
      case "val":
        return { e: "value", type: this.typeFromRef(desc.t, from, depth + 1) };
      case "call": {
        const callee = this.denote(desc.f, from, depth + 1);
        if (callee.e !== "syms") return { e: "value", type: UNKNOWN };
        if (callee.syms.every((symbol) => TYPE_KINDS.has(symbol.kind)))
          return { e: "value", type: this.typeSyms(callee.syms, depth + 1) };
        const results = callee.syms.map((symbol) => {
          const data = (symbol.data ?? {}) as { results?: (TypeRef | null)[] };
          const ref = data.results?.[desc.i];
          return ref ? this.typeFromRef(ref, symbol.file, depth + 1) : UNKNOWN;
        });
        return { e: "value", type: this.sameType(results) };
      }
      case "sel": {
        const base = this.denote(desc.x, from, depth + 1);
        if (base.e === "pkg")
          return {
            e: "syms",
            syms: exported(desc.n)
              ? base.pkgs.flatMap((pkg) => this.packageDecl(pkg, desc.n, from))
              : [],
          };
        if (base.e === "syms") {
          if (base.syms.every((symbol) => TYPE_KINDS.has(symbol.kind))) {
            // Method expression T.M / (*T).M.
            const type = this.typeSyms(base.syms, depth + 1);
            return {
              e: "syms",
              syms:
                type.kind === "project"
                  ? (this.member(type.syms, desc.n, from, depth + 1) ?? [])
                  : [],
            };
          }
          const type = this.sameType(
            base.syms.map((symbol) => this.valueType(symbol, depth + 1)),
          );
          return this.memberEntity(type, desc.n, from, depth);
        }
        if (base.e === "value")
          return this.memberEntity(base.type, desc.n, from, depth);
        return NONE;
      }
      default:
        return { e: "value", type: UNKNOWN };
    }
  }

  private memberEntity(
    type: TypeValue,
    name: string,
    from: string,
    depth: number,
  ): Entity {
    if (type.kind !== "project") return NONE;
    const found = this.member(type.syms, name, from, depth + 1);
    if (!found?.length) return NONE;
    if (found.every((symbol) => symbol.kind === "field"))
      return {
        e: "value",
        type: this.sameType(
          found.map((symbol) => this.valueType(symbol, depth + 1)),
        ),
      };
    return { e: "syms", syms: found };
  }

  /**
   * Fields and methods selected by `name` on project types, at the shallowest
   * embedding depth. Undefined when an embedded type outside the project could supply it.
   */
  private member(
    types: GraphSymbol[],
    name: string,
    from: string,
    depth: number,
    seen = new Set<string>(),
  ): GraphSymbol[] | undefined {
    let level = types.filter((type) => !seen.has(type.id));
    let incomplete = false;
    for (
      let step = 0;
      level.length && step < 6 && depth + step < MAX_DEPTH;
      step++
    ) {
      const found: GraphSymbol[] = [];
      const next: GraphSymbol[] = [];
      for (const type of level) {
        seen.add(type.id);
        const pkg = this.pkgOf(type);
        if (!pkg) continue;
        found.push(
          ...(
            this.members.get(`${pkg.key}\u0000${type.name}\u0000${name}`) ?? []
          ).filter((symbol) => this.visible(symbol, from)),
        );
        for (const embedded of this.embeddedTypes(type)) {
          if (embedded.kind === "project")
            next.push(...embedded.syms.filter((item) => !seen.has(item.id)));
          else incomplete = true;
        }
      }
      if (found.length) return unique(found);
      level = unique(next);
    }
    return incomplete ? undefined : [];
  }

  private embeddedTypes(type: GraphSymbol): TypeValue[] {
    const out: TypeValue[] = [];
    for (const link of this.embedsBySource.get(type.id) ?? []) {
      const ref = (link.data as { t?: TypeRef } | undefined)?.t;
      out.push(ref ? this.typeFromRef(ref, link.file, 1) : UNKNOWN);
    }
    return out;
  }

  // ---- interfaces --------------------------------------------------------

  private canonical(sig: string, file: string): string {
    const info = this.files.get(file);
    const own = info?.pkg ? this.pkgIdentity(info.pkg) : `?${file}`;
    return sig
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

  /** Method set of an interface (name -> canonical signature), or undefined when not fully known. */
  private interfaceMethods(
    iface: GraphSymbol,
    seen = new Set<string>(),
  ): Map<string, string> | undefined {
    const data = (iface.data ?? {}) as {
      constraint?: boolean;
      generic?: boolean;
    };
    if (data.constraint || data.generic || seen.has(iface.id)) return undefined;
    seen.add(iface.id);
    const pkg = this.pkgOf(iface);
    if (!pkg) return undefined;
    const set = new Map<string, string>();
    for (const [key, syms] of this.ownMembers(pkg, iface.name))
      for (const symbol of syms)
        if (symbol.kind === "method" && symbol.file === iface.file) {
          const sig = (symbol.data as { sig?: string } | undefined)?.sig;
          if (sig === undefined) return undefined;
          set.set(key, this.canonical(sig, symbol.file));
        }
    for (const embedded of this.embeddedTypes(iface)) {
      if (embedded.kind !== "project" || embedded.syms.length !== 1)
        return undefined;
      const inner = embedded.syms[0]!;
      if (inner.kind !== "interface") return undefined;
      const methods = this.interfaceMethods(inner, seen);
      if (!methods) return undefined;
      for (const [name, sig] of methods) set.set(name, sig);
    }
    return set;
  }
  private ownMembersIndex?: Map<string, Map<string, GraphSymbol[]>>;
  private ownMembers(pkg: Pkg, owner: string): Map<string, GraphSymbol[]> {
    if (!this.ownMembersIndex) {
      this.ownMembersIndex = new Map();
      for (const [key, syms] of this.members) {
        const [pkgDir, pkgName, typeName, name] = key.split("\u0000");
        const group = `${pkgDir}\u0000${pkgName}\u0000${typeName}`;
        let map = this.ownMembersIndex.get(group);
        if (!map) this.ownMembersIndex.set(group, (map = new Map()));
        map.set(name!, syms);
      }
    }
    return this.ownMembersIndex.get(`${pkg.key}\u0000${owner}`) ?? new Map();
  }

  /** Concrete method set of a named type: name -> {sig, method}, value or pointer receiver set. */
  private methodSet(
    type: GraphSymbol,
    pointer: boolean,
    depth = 0,
  ): Map<string, { sig: string; method: GraphSymbol }> {
    const set = new Map<string, { sig: string; method: GraphSymbol }>();
    const pkg = this.pkgOf(type);
    if (!pkg || depth > 4) return set;
    for (const method of this.methods.get(`${pkg.key}\u0000${type.name}`) ??
      []) {
      const data = (method.data ?? {}) as { pointer?: boolean; sig?: string };
      if (
        (pointer || !data.pointer) &&
        data.sig !== undefined &&
        !set.has(method.name)
      )
        set.set(method.name, {
          sig: this.canonical(data.sig, method.file),
          method,
        });
    }
    // Promoted methods from embedded project types (shallower declarations win).
    for (const [, syms] of this.ownMembers(pkg, type.name))
      for (const field of syms) {
        const data = (field.data ?? {}) as {
          embedded?: boolean;
          pointer?: boolean;
          t?: TypeRef;
        };
        if (field.kind !== "field" || !data.embedded || !data.t) continue;
        const inner = this.typeFromRef(data.t, field.file, 1);
        if (inner.kind !== "project" || inner.syms.length !== 1) continue;
        const embedded = inner.syms[0]!;
        if (embedded.kind === "interface") continue;
        for (const [name, value] of this.methodSet(
          embedded,
          pointer || !!data.pointer,
          depth + 1,
        ))
          if (!set.has(name)) set.set(name, value);
      }
    return set;
  }

  private implementsLinks(added: AddedLink[]): void {
    const interfaces: { iface: GraphSymbol; methods: Map<string, string> }[] =
      [];
    const types: GraphSymbol[] = [];
    for (const symbol of this.symbolsById.values()) {
      if (symbol.kind === "interface") {
        const methods = this.interfaceMethods(symbol);
        if (methods?.size) interfaces.push({ iface: symbol, methods });
      } else if (symbol.kind === "struct" || symbol.kind === "type")
        types.push(symbol);
    }
    for (const type of types) {
      const value = this.methodSet(type, false);
      const pointer = this.methodSet(type, true);
      if (!pointer.size) continue;
      for (const { iface, methods } of interfaces) {
        const matches = (set: Map<string, { sig: string }>) =>
          [...methods].every(([name, sig]) => {
            const method = set.get(name);
            if (!method || method.sig !== sig) return false;
            return (
              exported(name) || this.pkgOf(type)?.key === this.pkgOf(iface)?.key
            );
          });
        const byValue = matches(value);
        if (!byValue && !matches(pointer)) continue;
        const list = this.implementers.get(iface.id) ?? [];
        list.push({ type });
        this.implementers.set(iface.id, list);
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
  }

  // ---- link decisions ----------------------------------------------------

  private resolveLink(link: GraphLink): string[] {
    const data = (link.data ?? {}) as {
      expr?: Desc;
      t?: TypeRef;
      child?: string;
      path?: string;
    };
    switch (link.kind) {
      case "contains": {
        const child = this.byFileKey.get(`${link.file}\u0000${data.child}`);
        return child ? [child.id] : [];
      }
      case "imports": {
        const info = this.files.get(link.file);
        if (!info || !data.path) return [];
        return this.importTargets(info, data.path)
          .map((pkg) => pkg.symbol?.id)
          .filter((id): id is string => !!id);
      }
      case "receiver": {
        const info = this.files.get(link.file);
        if (!info?.pkg || !data.t) return [];
        return this.packageDecl(info.pkg, data.t.n, link.file)
          .filter((symbol) => TYPE_KINDS.has(symbol.kind))
          .map((symbol) => symbol.id);
      }
      case "embeds":
      case "references":
      case "calls": {
        if (data.t) {
          const type = this.typeFromRef(data.t, link.file, 0);
          return type.kind === "project"
            ? this.ids(this.declaredTypes(data.t, link.file))
            : [];
        }
        if (data.expr) return this.resolveExpression(data.expr, link);
        return [];
      }
      default:
        return [];
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
            .filter((symbol) => TYPE_KINDS.has(symbol.kind))
        : [];
    }
    const found = this.lookupName(ref.n, from);
    return found.e === "syms"
      ? found.syms.filter((symbol) => TYPE_KINDS.has(symbol.kind))
      : [];
  }

  private ids(syms: GraphSymbol[]): string[] {
    return unique(syms.map((symbol) => symbol.id)).sort();
  }

  private resolveExpression(desc: Desc, link: GraphLink): string[] {
    if (desc.k === "sel") {
      const base = this.denote(desc.x, link.file, 0);
      const type =
        base.e === "value"
          ? base.type
          : base.e === "syms" &&
              !base.syms.every((symbol) => TYPE_KINDS.has(symbol.kind))
            ? this.sameType(
                base.syms.map((symbol) => this.valueType(symbol, 1)),
              )
            : undefined;
      if (type?.kind === "project") {
        const found = this.member(type.syms, desc.n, link.file, 1);
        if (!found?.length) return [];
        const specs = found.filter(
          (symbol) =>
            (symbol.data as { interface?: boolean } | undefined)?.interface,
        );
        if (specs.length) return this.dispatch(specs, desc.n);
        return this.ids(found);
      }
      if (type?.kind === "unknown" && link.kind === "calls")
        return this.byName(desc.n, link.file);
      if (type) return [];
    }
    const entity = this.denote(desc, link.file, 0);
    return entity.e === "syms" ? this.ids(entity.syms) : [];
  }

  /** A call through an interface value: the interface method or any structural implementer. */
  private dispatch(specs: GraphSymbol[], name: string): string[] {
    const targets: GraphSymbol[] = [...specs];
    let implementations = 0;
    for (const spec of specs) {
      const owner = (spec.data as { owner?: string } | undefined)?.owner;
      const pkg = this.pkgOf(spec);
      const iface = pkg
        ? (this.decls.get(pkg.key)?.get(owner ?? "") ?? []).find(
            (symbol) =>
              symbol.kind === "interface" && symbol.file === spec.file,
          )
        : undefined;
      for (const { type } of iface
        ? (this.implementers.get(iface.id) ?? [])
        : []) {
        const method = this.methodSet(type, true).get(name)?.method;
        if (method) {
          targets.push(method);
          implementations++;
        }
      }
    }
    if (!implementations) return [];
    const ids = this.ids(targets);
    return ids.length > CANDIDATE_LIMIT ? [] : ids;
  }

  /** Unknown receiver: every concrete method of that name in packages reachable from the caller. */
  private byName(name: string, from: string): string[] {
    const info = this.files.get(from);
    if (!info?.pkg) return [];
    const reachable = this.reachableFrom(info.pkg.key);
    const found = (this.methodsByName.get(name) ?? []).filter((symbol) => {
      const pkg = this.pkgOf(symbol);
      return (
        !!pkg &&
        reachable.has(pkg.key) &&
        this.visible(symbol, from) &&
        (exported(name) || pkg.key === info.pkg!.key)
      );
    });
    const ids = this.ids(found);
    return ids.length >= 2 && ids.length <= CANDIDATE_LIMIT ? ids : [];
  }

  private reachableFrom(start: string): Set<string> {
    const cached = this.reachable.get(start);
    if (cached) return cached;
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const pkg = this.pkgs.get(queue.shift()!);
      for (const path of pkg?.files ?? []) {
        const info = this.files.get(path)!;
        for (const entry of [...info.imports.values(), ...info.dots])
          for (const target of entry.pkgs)
            if (!seen.has(target.key)) {
              seen.add(target.key);
              queue.push(target.key);
            }
      }
    }
    this.reachable.set(start, seen);
    return seen;
  }
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
