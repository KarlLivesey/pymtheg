import { posix as p } from "node:path";
import type {
  GraphSymbol,
  GraphLink,
  Json,
  LinkResolution,
  ResolutionContext,
} from "../../types.js";
import { crates, type Crate } from "./cargo.js";
type Data = Record<string, Json>;
const data = (x: { data?: Json }) => (x.data ?? {}) as Data;
const str = (x: unknown) => (typeof x === "string" ? x : "");
const compact = (s: string) => s.replace(/\s+/g, "").replace(/\br#/g, "");
// Erasure is ONLY for namespace lookup. Method applicability uses the full type.
const base = (s: string) =>
  compact(s)
    .replace(/::<[\s\S]*>$/, "")
    .replace(/<[\s\S]*>$/, "");
type Namespace = "type" | "value" | "macro" | "pattern" | "any" | "import";
interface Place {
  crate: Crate;
  local: string;
  scope: string;
  directory: string;
  file: string;
  parent: Place | null;
  symbol: GraphSymbol;
}
interface Found {
  symbols: GraphSymbol[];
  complete: boolean;
}
const unique = (ss: GraphSymbol[]) => [
  ...new Map(ss.map((s) => [s.id, s])).values(),
];
const accepts = (s: GraphSymbol, ns: Namespace) => {
  if (ns === "any") return true;
  if (ns === "macro") return s.kind === "macro";
  if (ns === "type")
    return ["module", "struct", "enum", "trait", "type"].includes(s.kind);
  if (ns === "pattern")
    return ["variant", "struct", "const", "static"].includes(s.kind);
  return (
    ["function", "const", "static", "variant"].includes(s.kind) ||
    (s.kind === "struct" && data(s).constructorForm !== "named")
  );
};
export function resolveRust(ctx: ResolutionContext): LinkResolution[] {
  const symbols = ctx.symbols.filter(
    (s) => s.module === "rust" && s.status !== "failed",
  );
  const files = new Set(
    ctx.files
      .filter((f) => f.module === "rust" && f.result.status !== "failed")
      .map((f) => f.path),
  );
  const packages = crates(ctx.contextFiles, files);
  const byLocalKey = new Map(symbols.map((s) => [`${s.file}|${s.key}`, s]));
  const moduleDeclarations = new Map<string, GraphSymbol[]>();
  for (const s of symbols)
    if (s.kind === "module" && !data(s).unit) {
      const k = `${s.file}|${str(data(s).moduleScope)}`;
      const list = moduleDeclarations.get(k) ?? [];
      list.push(s);
      moduleDeclarations.set(k, list);
    }
  const units = new Map(
    symbols.filter((s) => data(s).unit).map((s) => [s.file, s]),
  );
  const places: Place[] = [];
  const moduleTargets = new Map<string, GraphSymbol[]>();
  const modulePlaces = new Map<string, Place[]>();
  function walk(place: Place, ancestors: Set<string>) {
    const visitKey = `${place.crate.root}|${place.file}|${place.local}`;
    if (ancestors.has(visitKey)) return;
    places.push(place);
    const next = new Set([...ancestors, visitKey]);
    for (const s of moduleDeclarations.get(`${place.file}|${place.local}`) ??
      []) {
      const local = s.identity;
      const relative = local.slice(place.local.length).replace(/^::/, "");
      const scope = [place.scope, relative].filter(Boolean).join("::");
      const destinations: Place[] = [];
      if (data(s).inline)
        destinations.push({
          ...place,
          scope,
          local,
          directory: p.join(place.directory, s.name),
          parent: place,
          symbol: s,
        });
      else {
        const path = str(data(s).path);
        const possible = path
          ? [
              p.normalize(
                p.join(
                  place.local ? place.directory : p.dirname(place.file),
                  path,
                ),
              ),
            ]
          : [
              p.join(place.directory, `${s.name}.rs`),
              p.join(place.directory, s.name, "mod.rs"),
            ];
        const targets = possible.filter((f) => files.has(f));
        moduleTargets.set(
          s.id,
          unique([
            ...(moduleTargets.get(s.id) ?? []),
            ...targets.map((f) => units.get(f)!).filter(Boolean),
          ]),
        );
        for (const file of targets)
          destinations.push({
            crate: place.crate,
            file,
            local: "",
            scope,
            parent: place,
            symbol: s,
            directory:
              path || p.basename(file) === "mod.rs"
                ? p.dirname(file)
                : p.join(p.dirname(file), p.basename(file, ".rs")),
          });
      }
      modulePlaces.set(s.id, [
        ...(modulePlaces.get(s.id) ?? []),
        ...destinations,
      ]);
      for (const dest of destinations) walk(dest, next);
    }
  }
  const roots = new Map<string, Place>();
  for (const crate of packages) {
    const place: Place = {
      crate,
      file: crate.root,
      scope: "",
      local: "",
      directory: p.dirname(crate.root),
      parent: null,
      symbol: units.get(crate.root)!,
    };
    roots.set(crate.root, place);
    walk(place, new Set());
  }
  const placesByScope = new Map<string, Place[]>();
  for (const loc of places) {
    const k = `${loc.file}|${loc.local}`;
    const list = placesByScope.get(k) ?? [];
    list.push(loc);
    placesByScope.set(k, list);
  }
  const ownerCache = new Map<string, Place[]>();
  const ownerPlace = (file: string, scope: string): Place[] => {
    const k = `${file}|${scope}`;
    const cached = ownerCache.get(k);
    if (cached) return cached;
    const result: Place[] = [];
    const found = new Set<string>();
    let local = scope;
    while (true) {
      const level = placesByScope.get(`${file}|${local}`) ?? [];
      for (const loc of level) if (!found.has(loc.crate.root)) result.push(loc);
      for (const loc of level) found.add(loc.crate.root);
      if (!local) break;
      local = local.includes("::")
        ? local.slice(0, local.lastIndexOf("::"))
        : "";
    }
    ownerCache.set(k, result);
    return result;
  };
  const qualified = (loc: Place, local: string) =>
    [loc.scope, local.slice(loc.local.length).replace(/^::/, "")]
      .filter(Boolean)
      .join("::");
  const key = (root: string, scope: string) => `${root}|${scope}`;
  const table = new Map<string, GraphSymbol[]>();
  const members = new Set(
    symbols
      .filter((s) => ["impl", "trait"].includes(s.kind))
      .map((s) => `${s.file}|${s.identity}`),
  );
  for (const s of symbols) {
    if (members.has(`${s.file}|${str(data(s).scope)}`)) continue;
    for (const loc of ownerPlace(s.file, str(data(s).scope))) {
      if (data(s).unit && loc.scope) continue;
      const q = data(s).unit
        ? loc.scope
        : [qualified(loc, str(data(s).scope)), s.name]
            .filter(Boolean)
            .join("::");
      const k = key(loc.crate.root, q);
      const list = table.get(k) ?? [];
      list.push(s);
      table.set(k, unique(list));
    }
  }
  const importsByScope = new Map<
    string,
    { explicit: Map<string, GraphLink[]>; globs: GraphLink[] }
  >();
  for (const l of ctx.links)
    if (l.kind === "imports") {
      const k = `${l.file}|${str(data(l).scope)}`;
      const entry = importsByScope.get(k) ?? {
        explicit: new Map<string, GraphLink[]>(),
        globs: [],
      };
      if (data(l).glob) entry.globs.push(l);
      else {
        const alias = compact(str(data(l).alias));
        const list = entry.explicit.get(alias) ?? [];
        list.push(l);
        entry.explicit.set(alias, list);
      }
      importsByScope.set(k, entry);
    }
  const packagesByManifest = new Map<string, Crate[]>();
  for (const c of packages)
    if (c.kind === "lib") {
      const list = packagesByManifest.get(c.manifest) ?? [];
      list.push(c);
      packagesByManifest.set(c.manifest, list);
    }
  const membersByScope = new Map<string, GraphSymbol[]>();
  for (const s of symbols)
    if (s.kind === "method") {
      const k = `${s.file}|${str(data(s).scope)}`;
      const list = membersByScope.get(k) ?? [];
      list.push(s);
      membersByScope.set(k, list);
    }
  const memo = new Map<string, Found>();
  const empty = (complete = true): Found => ({ symbols: [], complete });
  const merge = (xs: Found[]): Found => ({
    symbols: unique(xs.flatMap((x) => x.symbols)),
    complete: xs.every((x) => x.complete),
  });
  function children(
    s: GraphSymbol,
    rest: string[],
    ns: Namespace,
    seen: Set<string>,
    allowGlobs: boolean,
  ): Found {
    if (!rest.length)
      return { symbols: accepts(s, ns) ? [s] : [], complete: true };
    if (s.kind === "module") {
      const destinations = data(s).unit
        ? [roots.get(s.file)!].filter(Boolean)
        : (modulePlaces.get(s.id) ?? []);
      return destinations.length
        ? merge(
            destinations.map((dest) =>
              find(rest.join("::"), dest, dest.local, ns, seen, allowGlobs),
            ),
          )
        : empty(false);
    }
    if (s.kind === "enum" && rest.length === 1) {
      return merge(
        ownerPlace(s.file, str(data(s).scope)).map((loc) => ({
          symbols: (
            table.get(
              key(
                loc.crate.root,
                [qualified(loc, str(data(s).scope)), s.name, rest[0]]
                  .filter(Boolean)
                  .join("::"),
              ),
            ) ?? []
          ).filter((x) => accepts(x, ns)),
          complete: true,
        })),
      );
    }
    return empty();
  }
  function inScope(
    name: string,
    rest: string[],
    loc: Place,
    local: string,
    q: string,
    ns: Namespace,
    seen: Set<string>,
    allowGlobs: boolean,
  ): Found | null {
    const headNs: Namespace = rest.length ? "type" : ns;
    const declared = (
      table.get(key(loc.crate.root, [q, name].filter(Boolean).join("::"))) ?? []
    ).filter((s) => accepts(s, headNs));
    if (declared.length)
      return merge(
        declared.map((s) => children(s, rest, ns, seen, allowGlobs)),
      );
    const uses = importsByScope.get(`${loc.file}|${local}`);
    const explicit = uses?.explicit.get(name) ?? [];
    if (explicit.length) {
      const result = merge(
        explicit.map((l) =>
          find(
            [l.targetName, ...rest].join("::"),
            loc,
            str(data(l).scope),
            ns,
            seen,
            allowGlobs,
          ),
        ),
      );
      // A type-only import does not mask a value of the same name.
      if (result.symbols.length || !result.complete) return result;
      // Fall through namespaces only when the import is KNOWN to bind a
      // different namespace. An uncaptured external import could bind this one.
      const all = merge(
        explicit.map((l) =>
          find(l.targetName, loc, str(data(l).scope), "any", seen, allowGlobs),
        ),
      );
      if (!all.complete || !all.symbols.length) return empty(false);
    }
    const globs = allowGlobs ? (uses?.globs ?? []) : [];
    if (globs.length) {
      const result = merge(
        globs.map((l) => {
          const imported = find(
            l.targetName.replace(/::\*$/, ""),
            loc,
            str(data(l).scope),
            "type",
            seen,
            false,
          );
          if (!imported.symbols.length) return empty(false);
          const found = merge(
            imported.symbols.map((s) =>
              children(s, [name, ...rest], ns, seen, false),
            ),
          );
          return {
            ...found,
            complete:
              imported.complete &&
              found.complete &&
              imported.symbols.every((s) => s.status === "clean"),
          };
        }),
      );
      if (result.symbols.length || !result.complete) return result;
    }
    return null;
  }
  function find(
    raw: string,
    loc: Place,
    scope: string,
    ns: Namespace = "any",
    seen = new Set<string>(),
    allowGlobs = true,
  ): Found {
    if (ns === "import")
      return merge(
        (["type", "value", "macro"] as Namespace[]).map((n) =>
          find(raw, loc, scope, n, seen, allowGlobs),
        ),
      );
    const name = base(raw);
    const guard = JSON.stringify([
      loc.crate.root,
      loc.file,
      loc.scope,
      scope,
      name,
      ns,
      allowGlobs,
    ]);
    const cached = memo.get(guard);
    if (cached) return cached;
    if (seen.has(guard) || seen.size > 64) return empty(false);
    seen = new Set([...seen, guard]);
    const absolute = name.startsWith("::");
    const parts = name.replace(/^::/, "").split("::");
    const first = parts.shift()!;
    let result: Found;
    if (!absolute && ["crate", "self", "super"].includes(first)) {
      let dest = first === "crate" ? roots.get(loc.crate.root)! : loc;
      if (first === "super") {
        if (!dest.parent) return empty(false);
        dest = dest.parent;
      }
      while (parts[0] === "super") {
        if (!dest.parent) return empty(false);
        dest = dest.parent;
        parts.shift();
      }
      if (parts[0] === "self") parts.shift();
      result = parts.length
        ? find(parts.join("::"), dest, dest.local, ns, seen, allowGlobs)
        : { symbols: [dest.symbol], complete: true };
    } else {
      let found: Found | null = null;
      if (!absolute) {
        let local = scope;
        while (true) {
          found = inScope(
            first,
            parts,
            loc,
            local,
            qualified(loc, local),
            ns,
            seen,
            allowGlobs,
          );
          if (found || local === loc.local) break;
          if (!local.startsWith(loc.local) || !local) break;
          local = local.includes("::")
            ? local.slice(0, local.lastIndexOf("::"))
            : "";
        }
      }
      if (found) result = found;
      else {
        const dependency = loc.crate.deps.get(first);
        const targets = dependency
          ? packages.filter(
              (c) => c.manifest === dependency && c.kind === "lib",
            )
          : [];
        result = targets.length
          ? merge(
              targets.map((c) =>
                parts.length
                  ? find(
                      parts.join("::"),
                      roots.get(c.root)!,
                      "",
                      ns,
                      seen,
                      allowGlobs,
                    )
                  : {
                      symbols: [units.get(c.root)!].filter(Boolean),
                      complete: true,
                    },
              ),
            )
          : empty();
      }
    }
    if (result.complete) memo.set(guard, result);
    return result;
  }
  type Method = {
    symbol: GraphSymbol;
    inherent: boolean;
    implType: string;
    generics: string[];
    uncertain: boolean;
  };
  const methodIndex = new Map<string, Method[]>();
  const opaqueTraits = new Set<string>();
  const referenceImpls = new Set<string>();
  const scopedMembers = (s: GraphSymbol) =>
    membersByScope.get(`${s.file}|${s.identity}`) ?? [];
  for (const impl of symbols.filter((s) => s.kind === "impl")) {
    const implType = str(data(impl).implType);
    const generics = (data(impl).generics ?? []) as string[];
    if (generics.includes(base(implType))) continue;
    for (const loc of ownerPlace(impl.file, str(data(impl).scope))) {
      if (/^&/.test(implType.trim())) {
        const nominal = implType.replace(/^&(?:'\w+\s+)?(?:mut\s+)?/, "");
        for (const t of find(nominal, loc, str(data(impl).scope), "type")
          .symbols)
          referenceImpls.add(t.id);
        continue;
      }
      const targets = find(implType, loc, str(data(impl).scope), "type");
      const overrides = scopedMembers(impl);
      let methods = overrides;
      if (data(impl).trait) {
        const traits = find(
          str(data(impl).trait),
          loc,
          str(data(impl).scope),
          "type",
        );
        if (!traits.complete || !traits.symbols.length)
          for (const t of targets.symbols) opaqueTraits.add(t.id);
        methods = [
          ...overrides,
          ...traits.symbols
            .filter((t) => t.kind === "trait")
            .flatMap((t) =>
              scopedMembers(t).filter(
                (m) =>
                  data(m).defaultBody &&
                  !overrides.some((o) => o.name === m.name),
              ),
            ),
        ];
      }
      for (const target of targets.symbols.filter((s) =>
        ["struct", "enum", "type"].includes(s.kind),
      ))
        for (const m of methods) {
          const k = `${target.id}|${m.name}`;
          const list = methodIndex.get(k) ?? [];
          list.push({
            symbol: m,
            inherent: !data(impl).trait,
            implType,
            generics,
            uncertain: !targets.complete,
          });
          methodIndex.set(k, list);
        }
    }
  }
  function compatibility(
    receiver: string,
    impl: string,
    generics: string[],
  ): "yes" | "no" | "unknown" {
    receiver = compact(receiver);
    impl = compact(impl);
    const receiverArgs = receiver.includes("<")
      ? receiver.slice(receiver.indexOf("<"))
      : "";
    const implArgs = impl.includes("<") ? impl.slice(impl.indexOf("<")) : "";
    if (generics.some((g) => new RegExp(`\\b${g}\\b`).test(implArgs)))
      return "unknown";
    if (receiverArgs === implArgs) return "yes";
    return receiverArgs && implArgs ? "no" : "unknown";
  }
  function methods(
    typeName: string,
    name: string,
    loc: Place,
    scope: string,
    instance: boolean,
    borrow: string,
    mutable: boolean,
    argumentCount: number,
  ): Found {
    name = compact(name);
    if (instance && !["owned", "shared", "mutable"].includes(borrow))
      return empty(false);
    const type = find(typeName, loc, scope, "type");
    const matches = type.symbols
      .flatMap((t) => methodIndex.get(`${t.id}|${name}`) ?? [])
      .filter((m) => {
        if (
          typeof data(m.symbol).arity === "number" &&
          data(m.symbol).arity !== argumentCount + (instance ? 1 : 0)
        )
          return false;
        if (compatibility(typeName, m.implType, m.generics) === "no")
          return false;
        if (!instance) return true;
        const receiver = compact(str(data(m.symbol).receiverKind));
        if (!receiver || receiver === "none") return false;
        if (
          receiver.includes("&mut") &&
          (borrow === "shared" || (borrow === "owned" && !mutable))
        )
          return false;
        if (!receiver.includes("&") && borrow !== "owned") return false;
        return true;
      });
    const inherent = matches.filter((m) => m.inherent);
    const proven = inherent.filter(
      (m) =>
        !m.uncertain &&
        compatibility(typeName, m.implType, m.generics) === "yes" &&
        (!instance || str(data(m.symbol).receiverKind) !== "unknown"),
    );
    const form = (m: Method): string => {
      const text = compact(
        str(data(m.symbol).receiverKind).replace(/'\w+\s*/g, ""),
      );
      return text.startsWith("&mut")
        ? "mutable"
        : text.startsWith("&")
          ? "shared"
          : ["self", "mutself"].includes(text)
            ? "owned"
            : "unknown";
    };
    // Receiver candidates are searched before inherent/trait preference at that
    // candidate. Different autoref forms do NOT imply inherent dominance.
    if (instance && type.symbols.some((t) => referenceImpls.has(t.id)))
      return empty(false);
    const opaque = type.symbols.some((t) => opaqueTraits.has(t.id));
    const dominates =
      proven.length > 0 &&
      (!instance ||
        (matches
          .filter((m) => !m.inherent)
          .every((t) => proven.every((i) => form(t) === form(i))) &&
          (!opaque || proven.every((m) => form(m) === borrow))));
    const selected = dominates ? inherent : matches;
    const complete =
      type.complete &&
      (dominates || !opaque) &&
      (!instance || !matches.some((m) => form(m) === "unknown"));
    const ss = unique(selected.map((m) => m.symbol));
    // One trait implementation or a generic substitution never implies dispatch.
    if (
      ss.length === 1 &&
      (!dominates ||
        selected.some(
          (m) =>
            m.uncertain ||
            compatibility(typeName, m.implType, m.generics) !== "yes",
        ))
    )
      return empty(false);
    return { symbols: ss, complete };
  }
  const resolutions: LinkResolution[] = [];
  for (const l of ctx.links) {
    const d = data(l);
    let found: Found = empty();
    if (l.kind === "contains")
      found = {
        symbols: [byLocalKey.get(`${l.file}|${str(d.key)}`)!].filter(Boolean),
        complete: true,
      };
    else if (l.kind === "modules") {
      const s = byLocalKey.get(`${l.file}|${str(d.key)}`);
      found = {
        symbols: s ? (moduleTargets.get(s.id) ?? []) : [],
        complete: true,
      };
    } else if (!d.blocked && !(l.kind === "imports" && d.glob)) {
      found = merge(
        ownerPlace(l.file, str(d.scope)).map((loc) => {
          let name = compact(l.targetName);
          const selfPath = name === "Self" || name.startsWith("Self::");
          const scope = selfPath ? str(d.implScope) : str(d.scope);
          if (selfPath && d.implType) name = str(d.implType) + name.slice(4);
          if (d.method)
            return methods(
              str(d.receiverType),
              str(d.method),
              loc,
              str(d.typeScope),
              true,
              str(d.receiverBorrow),
              d.receiverMutable === true,
              Number(d.argumentCount),
            );
          const ns: Namespace =
            l.kind === "calls"
              ? "value"
              : l.kind === "macros"
                ? "macro"
                : l.kind === "patterns"
                  ? "pattern"
                  : ["types", "implements"].includes(l.kind)
                    ? "type"
                    : "import";
          let result = find(name, loc, scope, ns);
          if (
            l.kind === "calls" &&
            !result.symbols.length &&
            name.includes("::")
          ) {
            const split = name.lastIndexOf("::");
            result = methods(
              name.slice(0, split),
              name.slice(split + 2),
              loc,
              scope,
              false,
              "owned",
              true,
              Number(d.argumentCount),
            );
          }
          if (l.kind === "calls")
            result = {
              ...result,
              symbols: result.symbols.filter(
                (s) =>
                  s.kind === "function" ||
                  s.kind === "method" ||
                  (s.kind === "struct" &&
                    data(s).constructorForm !== "named") ||
                  (s.kind === "variant" && data(s).constructorForm === "tuple"),
              ),
            };
          return result;
        }),
      );
    }
    if (l.kind === "macros")
      found.symbols = found.symbols.filter(
        (s) =>
          s.file === l.file &&
          s.range.start < l.range.start &&
          (!data(s).scope ||
            str(d.scope) === str(data(s).scope) ||
            str(d.scope).startsWith(str(data(s).scope) + "::")),
      );
    if (!found.complete) continue;
    const targets = unique(found.symbols);
    // One import can bind several namespaces simultaneously. The interface's
    // one-of relation cannot assert such a multi-binding as one candidate set.
    if (l.kind === "imports" && new Set(targets.map((s) => s.kind)).size > 1)
      continue;
    if (targets.length > 1)
      resolutions.push({
        linkId: l.id,
        candidateIds: targets.map((s) => s.id),
      });
    else if (targets.length === 1)
      resolutions.push({ linkId: l.id, targetId: targets[0]!.id });
  }
  return resolutions;
}
