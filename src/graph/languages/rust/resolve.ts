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
const identifiers = (s: string): string[] =>
  s.match(/[_\p{ID_Start}][_\p{ID_Continue}]*/gu) ?? [];
// Erasure is ONLY for namespace lookup. Method applicability uses the full type.
const base = (s: string) =>
  compact(s)
    .replace(/::<[\s\S]*>$/, "")
    .replace(/<[\s\S]*>$/, "");
const withoutLifetimes = (s: string) =>
  s
    .replace(/\br#/g, "")
    .trim()
    .replace(
      /'[_\p{ID_Start}][_\p{ID_Continue}]*(?![_\p{ID_Continue}'])\s*,?/gu,
      "",
    )
    .replace(/,\s*>/g, ">")
    .replace(/<\s*>/g, "");
type Namespace =
  | "type"
  | "value"
  | "macro"
  | "pattern"
  | "any"
  | "import"
  | "importType";
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
  reason?: string;
}
const unique = (ss: GraphSymbol[]) => [
  ...new Map(ss.map((s) => [s.id, s])).values(),
];
const accepts = (s: GraphSymbol, ns: Namespace) => {
  if (ns === "any") return true;
  if (ns === "macro") return s.kind === "macro";
  if (ns === "importType" && s.kind === "variant") return true;
  if (ns === "type" || ns === "importType")
    return ["module", "struct", "enum", "trait", "type"].includes(s.kind);
  if (ns === "pattern")
    return ["variant", "struct", "const", "static"].includes(s.kind);
  return (
    ["function", "const", "static"].includes(s.kind) ||
    (s.kind === "variant" && data(s).constructorForm !== "named") ||
    (s.kind === "struct" && data(s).constructorForm !== "named")
  );
};
export function resolveRust(
  ctx: ResolutionContext,
  uncertain?: (link: GraphLink, targets: GraphSymbol[], reason: string) => void,
): LinkResolution[] {
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
        if (alias === "_") continue;
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
  const membersByOwner = new Map<string, GraphSymbol[]>();
  for (const l of ctx.links) {
    if (l.kind !== "contains" || !l.sourceId) continue;
    const member = byLocalKey.get(`${l.file}|${str(data(l).key)}`);
    if (member?.kind !== "method") continue;
    const list = membersByOwner.get(l.sourceId) ?? [];
    list.push(member);
    membersByOwner.set(l.sourceId, list);
  }
  const memo = new Map<string, Found>();
  const empty = (complete = true): Found => ({ symbols: [], complete });
  const merge = (xs: Found[]): Found => ({
    symbols: unique(xs.flatMap((x) => x.symbols)),
    complete: xs.every((x) => x.complete),
    reason: [...new Set(xs.map((x) => x.reason).filter(Boolean))].join("; "),
  });
  const isDescendant = (scope: string, parent: string) =>
    !parent || scope === parent || scope.startsWith(parent + "::");
  function visible(visibility: string, owner: Place, importer: Place): boolean {
    visibility = compact(visibility);
    if (visibility === "pub") return true;
    if (owner.crate.root !== importer.crate.root) return false;
    if (visibility === "pub(crate)") return true;
    let boundary = owner.scope;
    if (visibility === "pub(super)") boundary = owner.parent?.scope ?? "";
    else if (visibility.startsWith("pub(in")) {
      const path = visibility.slice(6, -1).split("::");
      if (path[0] === "crate") {
        path.shift();
        boundary = path.join("::");
      } else {
        let dest = owner;
        while (path[0] === "super") {
          dest = dest.parent ?? dest;
          path.shift();
        }
        if (path[0] === "self") path.shift();
        boundary = [dest.scope, ...path].filter(Boolean).join("::");
      }
    }
    return isDescendant(importer.scope, boundary);
  }
  function children(
    s: GraphSymbol,
    rest: string[],
    ns: Namespace,
    seen: Set<string>,
    allowGlobs: boolean,
    accessFrom?: Place,
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
              find(
                rest.join("::"),
                dest,
                dest.local,
                ns,
                seen,
                allowGlobs,
                accessFrom,
              ),
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
    accessFrom?: Place,
  ): Found | null {
    const headNs: Namespace = rest.length ? "type" : ns;
    const uses = importsByScope.get(`${loc.file}|${local}`);
    if (uses?.globs.some((l) => data(l).unsafe)) return empty(false);
    const declared = (
      table.get(key(loc.crate.root, [q, name].filter(Boolean).join("::"))) ?? []
    ).filter(
      (s) =>
        accepts(s, headNs) &&
        (!accessFrom || visible(str(data(s).visibility), loc, accessFrom)),
    );
    if (declared.length)
      return merge(
        declared.map((s) =>
          children(s, rest, ns, seen, allowGlobs, accessFrom),
        ),
      );
    const explicit = (uses?.explicit.get(name) ?? []).filter(
      (l) => !accessFrom || visible(str(data(l).visibility), loc, accessFrom),
    );
    const importPath = (l: GraphLink) =>
      !l.targetName.includes("::") && loc.crate.deps.has(compact(l.targetName))
        ? "::" + l.targetName
        : l.targetName;
    if (explicit.length) {
      const result = merge(
        explicit.map((l) =>
          find(
            [importPath(l), ...rest].join("::"),
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
          find(importPath(l), loc, str(data(l).scope), "any", seen, allowGlobs),
        ),
      );
      if (!all.complete || !all.symbols.length) return empty(false);
    }
    const globs = allowGlobs
      ? (uses?.globs ?? []).filter(
          (l) =>
            !accessFrom || visible(str(data(l).visibility), loc, accessFrom),
        )
      : [];
    if (globs.length) {
      const result = merge(
        globs.map((l) => {
          const imported = find(
            l.targetName.replace(/::\*$/, ""),
            loc,
            str(data(l).scope),
            "type",
            seen,
            true,
          );
          if (!imported.symbols.length) return empty(false);
          const found = merge(
            imported.symbols.map((s) =>
              children(s, [name, ...rest], ns, seen, true, accessFrom ?? loc),
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
    accessFrom?: Place,
  ): Found {
    if (ns === "import")
      return merge(
        (["importType", "value", "macro"] as Namespace[]).map((n) =>
          find(raw, loc, scope, n, seen, allowGlobs, accessFrom),
        ),
      );
    const name = base(raw);
    if (name === "_") return empty();
    const guard = JSON.stringify([
      loc.crate.root,
      loc.file,
      loc.scope,
      scope,
      name,
      ns,
      allowGlobs,
      accessFrom?.crate.root,
      accessFrom?.scope,
    ]);
    const cached = memo.get(guard);
    if (cached) return cached;
    if (seen.has(guard)) return empty(!accessFrom ? false : true);
    if (seen.size > 128) return empty(false);
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
        ? find(
            parts.join("::"),
            dest,
            dest.local,
            ns,
            seen,
            allowGlobs,
            accessFrom,
          )
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
            accessFrom,
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
    result.complete &&= result.symbols.every((s) => !data(s).unsafe);
    if (result.complete) memo.set(guard, result);
    return result;
  }
  const opaqueStandardRoots = new Map<string, Set<string>>();
  for (const file of ctx.files) {
    const aliases = (data(file.result).opaqueCrateAliases ?? []) as string[];
    if (!aliases.length) continue;
    for (const loc of ownerPlace(file.path, "")) {
      const names =
        opaqueStandardRoots.get(loc.crate.root) ?? new Set<string>();
      for (const name of aliases) names.add(name);
      opaqueStandardRoots.set(loc.crate.root, names);
    }
  }
  // These standard traits have small, fixed method-name contracts. This is
  // applicability evidence only: no external declaration or target is invented.
  const standardTraits = new Map<string, string[]>([
    ["ops::Drop", ["drop"]],
    ["default::Default", ["default"]],
    ["clone::Clone", ["clone", "clone_from"]],
    ["convert::From", ["from"]],
    ["convert::TryFrom", ["try_from"]],
    ["convert::Into", ["into"]],
    ["convert::TryInto", ["try_into"]],
    ["iter::FromIterator", ["from_iter"]],
    ["iter::IntoIterator", ["into_iter"]],
    ["ops::Add", ["add"]],
    ["ops::AddAssign", ["add_assign"]],
    ["fmt::Debug", ["fmt"]],
    ["fmt::Display", ["fmt"]],
  ]);
  const standardPrelude = new Map([
    ["Drop", "ops::Drop"],
    ["Default", "default::Default"],
    ["Clone", "clone::Clone"],
    ["From", "convert::From"],
    ["TryFrom", "convert::TryFrom"],
    ["Into", "convert::Into"],
    ["TryInto", "convert::TryInto"],
    ["FromIterator", "iter::FromIterator"],
    ["IntoIterator", "iter::IntoIterator"],
  ]);
  function standardMethods(
    raw: string,
    loc: Place,
    scope: string,
    allowPrelude: boolean,
  ): string[] | null {
    let path = base(raw);
    for (let depth = 0; depth < 16; depth++) {
      const absolute = path.startsWith("::");
      path = path.replace(/^::/, "");
      if (/^(std|core)::/.test(path)) {
        const crateName = path.split("::")[0]!;
        if (
          loc.crate.deps.has(crateName) ||
          opaqueStandardRoots.get(loc.crate.root)?.has(crateName)
        )
          return null;
        const shadow =
          !absolute && find(path.split("::")[0]!, loc, scope, "type");
        if (shadow && (shadow.symbols.length || !shadow.complete)) return null;
        return standardTraits.get(path.replace(/^(std|core)::/, "")) ?? null;
      }
      const [first, ...rest] = path.split("::");
      let local = scope,
        bindings: GraphLink[] = [];
      while (true) {
        bindings =
          importsByScope.get(`${loc.file}|${local}`)?.explicit.get(first!) ??
          [];
        if (bindings.length || local === loc.local || !local) break;
        local = local.includes("::")
          ? local.slice(0, local.lastIndexOf("::"))
          : "";
      }
      if (bindings.length !== 1)
        return allowPrelude && !bindings.length && !rest.length
          ? (standardTraits.get(standardPrelude.get(first!) ?? "") ?? null)
          : null;
      path = [bindings[0]!.targetName, ...rest].join("::");
    }
    return null;
  }
  type Method = {
    symbol: GraphSymbol;
    inherent: boolean;
    implType: string;
    generics: string[];
    uncertain: boolean;
    implKey: string;
    ownerRoot: string;
    argumentPlace: Place;
    argumentScope: string;
    argumentSyntax: string;
    universal: boolean;
    bounded: boolean;
  };
  const methodIndex = new Map<string, Method[]>();
  type Blankets = {
    names: Set<string>;
    associatedNames: Set<string>;
    opaque: boolean;
    byType: Map<string, Set<string>>;
    associatedByType: Map<string, Set<string>>;
    opaqueTypes: Set<string>;
    refs: Map<string, Set<string>>;
    opaqueNormal: Set<string>;
  };
  const emptyBlankets = (): Blankets => ({
    names: new Set(),
    associatedNames: new Set(),
    opaque: false,
    byType: new Map(),
    associatedByType: new Map(),
    opaqueTypes: new Set(),
    refs: new Map(),
    opaqueNormal: new Set(),
  });
  const blanketsByCrate = new Map<string, Blankets>();
  const reachableCache = new Map<string, Set<string>>();
  function reachable(root: string): Set<string> {
    const cached = reachableCache.get(root);
    if (cached) return cached;
    const result = new Set<string>(),
      pending = [root];
    while (pending.length) {
      const next = pending.pop()!;
      if (result.has(next)) continue;
      result.add(next);
      for (const manifest of roots.get(next)?.crate.deps.values() ?? [])
        for (const dep of packagesByManifest.get(manifest) ?? [])
          pending.push(dep.root);
    }
    reachableCache.set(root, result);
    return result;
  }
  // Alias expansion never treats an unexpanded alias as a disjoint nominal.
  type Expansion = {
    text: string;
    loc: Place;
    scope: string;
    unknown: boolean;
    externalShape?: string;
  };
  function expandType(
    text: string,
    loc: Place,
    scope: string,
    seen = new Set<string>(),
    variables = new Set<string>(),
  ): Expansion {
    text = text.trim();
    if (variables.has(compact(text)))
      return { text, loc, scope, unknown: true };
    const ref = text.match(
      /^&\s*(?:'[_\p{ID_Start}][_\p{ID_Continue}]*\s*)?(mut\s+)?/u,
    );
    if (ref) {
      const inner = expandType(
        text.slice(ref[0].length),
        loc,
        scope,
        seen,
        variables,
      );
      return { ...inner, text: ref[0] + inner.text };
    }
    const target = find(text, loc, scope, "type");
    const aliases = target.symbols.filter((s) => s.kind === "type");
    // Unshadowed prelude Box is a known outer constructor. Expanding an alias
    // to Box<...> does not make its impl applicable to unrelated nominal types.
    if (
      !target.symbols.length &&
      target.complete &&
      (/^Box\s*</.test(text) ||
        (/^(?:::)?std::boxed::Box\s*</.test(text) &&
          !find("std", loc, scope, "type").symbols.length &&
          !opaqueStandardRoots.get(loc.crate.root)?.has("std")))
    )
      return { text, loc, scope, unknown: false, externalShape: "Box" };
    if (!aliases.length)
      return {
        text,
        loc,
        scope,
        unknown:
          seen.size > 0 &&
          (!target.complete ||
            (!target.symbols.length &&
              !variables.has(text) &&
              !/^([ui](8|16|32|64|128|size)|f(32|64)|bool|char|str)$/.test(
                text,
              ))),
      };
    if (aliases.length !== 1 || !target.complete)
      return { text, loc, scope, unknown: true };
    const a = aliases[0]!,
      rhs = str(data(a).aliasType),
      key = a.id;
    if (!rhs || data(a).unsafe || seen.has(key) || seen.size > 32)
      return { text, loc, scope, unknown: true };
    const owners = ownerPlace(a.file, str(data(a).scope));
    if (owners.length !== 1) return { text, loc, scope, unknown: true };
    const params = ((data(a).generics ?? []) as string[]).filter(
      (g) => !g.startsWith("'"),
    );
    const noLife = withoutLifetimes(text),
      raw = noLife.includes("<") ? noLife.slice(noLife.indexOf("<")) : "";
    const args = raw ? splitArguments(raw) : [];
    if (!args || args.length !== params.length)
      return { text, loc, scope, unknown: true };
    const substitutions = new Map(params.map((p, i) => [p, args[i]!]));
    // Substituted nonprimitive names must not silently change namespace at the
    // alias declaration. Keep uncertainty when those scopes differ.
    const shifted =
      (loc.file !== a.file || scope !== str(data(a).scope)) &&
      args.some((x) =>
        identifiers(x).some(
          (t) =>
            !/^([ui](8|16|32|64|128|size)|f(32|64)|bool|char|str)$/.test(t),
        ),
      );
    const expanded = rhs.replace(
      /[_\p{ID_Start}][_\p{ID_Continue}]*/gu,
      (t) => substitutions.get(t) ?? t,
    );
    if (
      data(a).aliasShape === "tuple_type" ||
      data(a).aliasShape === "array_type"
    )
      return {
        text: expanded,
        loc: owners[0]!,
        scope: str(data(a).scope),
        unknown: false,
        externalShape: str(data(a).aliasShape),
      };
    const next = expandType(
      expanded,
      owners[0]!,
      str(data(a).scope),
      new Set([...seen, key]),
      variables,
    );
    return { ...next, unknown: next.unknown || shifted };
  }
  const stdBlanketNames = new Set([
    "from",
    "into",
    "try_from",
    "try_into",
    "borrow",
    "borrow_mut",
    "to_owned",
    "to_string",
    "type_id",
    "as_ref",
    "as_mut",
    "clone",
    "clone_from",
    "into_iter",
    "default",
  ]);
  const macroTypesByCrate = new Map<string, Set<string>>();
  const nominalNames = new Map<string, GraphSymbol[]>();
  for (const symbol of symbols)
    if (["struct", "enum", "type"].includes(symbol.kind)) {
      const list = nominalNames.get(symbol.name) ?? [];
      list.push(symbol);
      nominalNames.set(symbol.name, list);
    }
  for (const f of ctx.files)
    for (const token of (data(f.result).opaqueImplTypes ?? []) as {
      name: string;
      scope: string;
    }[])
      for (const loc of ownerPlace(f.path, token.scope)) {
        const set = macroTypesByCrate.get(loc.crate.root) ?? new Set<string>();
        macroTypesByCrate.set(loc.crate.root, set);
        // Opaque token paths cannot be interpreted as unqualified names. Keep
        // every reachable same-named nominal, including qualified/shadowed ones.
        for (const candidate of nominalNames.get(token.name) ?? [])
          if (
            ownerPlace(candidate.file, str(data(candidate).scope)).some((p) =>
              reachable(loc.crate.root).has(p.crate.root),
            )
          )
            set.add(candidate.id);
        const expanded = expandType(token.name, loc, token.scope);
        for (const t of find(
          expanded.text,
          expanded.loc,
          expanded.scope,
          "type",
        ).symbols)
          set.add(t.id);
      }
  const scopedMembers = (s: GraphSymbol) => membersByOwner.get(s.id) ?? [];
  const shapeTargets = new Map<string, GraphSymbol[]>();
  for (const impl of symbols.filter((s) => s.kind === "impl")) {
    const implType = str(data(impl).implType);
    const generics = (data(impl).generics ?? []) as string[];
    for (const loc of ownerPlace(impl.file, str(data(impl).scope))) {
      const blankets = blanketsByCrate.get(loc.crate.root) ?? emptyBlankets();
      blanketsByCrate.set(loc.crate.root, blankets);
      const trait = data(impl).trait
        ? find(str(data(impl).trait), loc, str(data(impl).scope), "type")
        : empty();
      const traitMethods = trait.symbols
        .filter((t) => t.kind === "trait")
        .flatMap(scopedMembers);
      const standard =
        data(impl).trait && !trait.symbols.length
          ? standardMethods(
              str(data(impl).trait),
              loc,
              str(data(impl).scope),
              trait.complete,
            )
          : null;
      const suppliedNames = new Set([
        ...[...scopedMembers(impl), ...traitMethods].map((m) => m.name),
        ...(standard ?? []),
      ]);
      const instanceNames = new Set([
        ...[...scopedMembers(impl), ...traitMethods]
          .filter((m) => data(m).receiver === true)
          .map((m) => m.name),
        ...(standard ?? []).filter(
          (name) =>
            !["default", "from", "try_from", "from_iter"].includes(name),
        ),
      ]);
      const unknownTrait =
        !!data(impl).trait &&
        !standard &&
        (!trait.complete || !trait.symbols.length);
      const expanded = expandType(
        implType,
        loc,
        str(data(impl).scope),
        new Set(),
        new Set(generics),
      );
      const expandedImplType = expanded.text;
      if (data(impl).unsafe) {
        blankets.opaque = true;
        continue;
      }
      if (expanded.externalShape) {
        const overrides = scopedMembers(impl);
        for (const method of [
          ...overrides,
          ...traitMethods.filter(
            (m) =>
              data(m).defaultBody && !overrides.some((o) => o.name === m.name),
          ),
        ]) {
          const key = `${loc.crate.root}|${expanded.externalShape}|${method.name}`;
          const list = shapeTargets.get(key) ?? [];
          list.push(method);
          shapeTargets.set(key, list);
        }
        continue;
      }
      if (data(impl).unsafe || expanded.unknown) {
        for (const name of instanceNames) blankets.names.add(name);
        for (const name of suppliedNames) blankets.associatedNames.add(name);
        if (data(impl).trait && unknownTrait) blankets.opaque = true;
        if (data(impl).unsafe) blankets.opaque = true;
        continue;
      }
      const blanket =
        !!data(impl).trait &&
        generics
          .filter((g) => !g.startsWith("'"))
          .some((g) => identifiers(expandedImplType).includes(g));
      if (blanket) {
        const nominal = expandedImplType.replace(
          /^&(?:'\w+\s+)?(?:mut\s+)?/,
          "",
        );
        if (generics.includes(base(nominal))) {
          for (const name of instanceNames) blankets.names.add(name);
          for (const name of suppliedNames) blankets.associatedNames.add(name);
          blankets.opaque ||= unknownTrait;
        } else {
          // A nominal wrapper cannot be selected for an unrelated explicit
          // receiver type. Its generic arguments/bounds remain unsolved.
          const nominalTargets = find(
            nominal,
            expanded.loc,
            expanded.scope,
            "type",
          );
          if (!nominalTargets.complete || !nominalTargets.symbols.length) {
            for (const name of instanceNames) blankets.names.add(name);
            for (const name of suppliedNames)
              blankets.associatedNames.add(name);
            blankets.opaque ||= unknownTrait;
          }
          for (const t of nominalTargets.symbols) {
            const names = blankets.byType.get(t.id) ?? new Set<string>();
            for (const name of instanceNames) names.add(name);
            blankets.byType.set(t.id, names);
            const associated =
              blankets.associatedByType.get(t.id) ?? new Set<string>();
            for (const name of suppliedNames) associated.add(name);
            blankets.associatedByType.set(t.id, associated);
            if (unknownTrait) blankets.opaqueTypes.add(t.id);
          }
        }
        continue;
      }
      if (/^&/.test(expandedImplType.trim())) {
        const nominal = expandedImplType.replace(
          /^&(?:'\w+\s+)?(?:mut\s+)?/,
          "",
        );
        for (const t of find(nominal, loc, str(data(impl).scope), "type")
          .symbols) {
          const names = blankets.refs.get(t.id) ?? new Set<string>();
          for (const name of instanceNames) names.add(name);
          if (unknownTrait) names.add("*");
          blankets.refs.set(t.id, names);
        }
        continue;
      }
      const targets = find(
        expandedImplType,
        expanded.loc,
        expanded.scope,
        "type",
      );
      if (standard)
        for (const target of targets.symbols) {
          const names = blankets.byType.get(target.id) ?? new Set<string>();
          for (const name of instanceNames) names.add(name);
          blankets.byType.set(target.id, names);
          // Clone::clone_from has an external default body; retain that unknown
          // alternative for qualified calls too. Other catalogued methods are
          // required overrides and are captured in the impl itself.
          if (standard.includes("clone_from")) {
            const associated =
              blankets.associatedByType.get(target.id) ?? new Set<string>();
            associated.add("clone_from");
            blankets.associatedByType.set(target.id, associated);
          }
        }
      const overrides = scopedMembers(impl);
      let methods = overrides;
      if (data(impl).trait) {
        const traits = find(
          str(data(impl).trait),
          loc,
          str(data(impl).scope),
          "type",
        );
        if (!standard && (!traits.complete || !traits.symbols.length))
          for (const t of targets.symbols) blankets.opaqueNormal.add(t.id);
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
            implType: expandedImplType,
            generics,
            uncertain:
              !targets.complete || !!data(impl).unsafe || !!data(m).unsafe,
            universal:
              data(impl).universal === true &&
              (() => {
                const type = withoutLifetimes(expandedImplType),
                  ps = generics.filter((g) => !g.startsWith("'"));
                const args = type.includes("<")
                  ? splitArguments(type.slice(type.indexOf("<")))
                  : null;
                return (
                  !!args &&
                  args.length === ps.length &&
                  new Set(args.map(compact)).size === ps.length &&
                  args.every((a, i) => compact(a) === ps[i])
                );
              })(),
            bounded: data(impl).bounded === true,
            implKey: `${impl.file}|${impl.key}`,
            ownerRoot: loc.crate.root,
            argumentPlace: expanded.loc,
            argumentScope: expanded.scope,
            argumentSyntax:
              expandedImplType === implType
                ? str(data(impl).argumentSyntax)
                : "",
          });
          methodIndex.set(k, list);
        }
    }
  }
  const activeBlankets = new Map<string, Blankets>();
  function visibleBlankets(root: string): Blankets {
    const cached = activeBlankets.get(root);
    if (cached) return cached;
    const result = emptyBlankets();
    for (const owner of reachable(root)) {
      const source = blanketsByCrate.get(owner);
      if (!source) continue;
      result.opaque ||= source.opaque;
      for (const name of source.names) result.names.add(name);
      for (const name of source.associatedNames)
        result.associatedNames.add(name);
      for (const [id, names] of source.associatedByType) {
        const combined = result.associatedByType.get(id) ?? new Set<string>();
        for (const name of names) combined.add(name);
        result.associatedByType.set(id, combined);
      }
      for (const id of source.opaqueTypes) result.opaqueTypes.add(id);
      for (const id of source.opaqueNormal) result.opaqueNormal.add(id);
      for (const [id, names] of source.refs) {
        const combined = result.refs.get(id) ?? new Set<string>();
        for (const name of names) combined.add(name);
        result.refs.set(id, combined);
      }
      for (const [id, names] of source.byType) {
        const combined = result.byType.get(id) ?? new Set<string>();
        for (const name of names) combined.add(name);
        result.byType.set(id, combined);
      }
    }
    activeBlankets.set(root, result);
    return result;
  }
  type ArgumentKey = { key: string; alias: boolean };
  function standardArgumentKey(
    raw: string,
    loc: Place,
    scope: string,
  ): ArgumentKey | null {
    const absolute = raw.startsWith("::"),
      path = raw.replace(/^::/, "");
    if (!/^(std|core)::/.test(path)) return null;
    const head = path.split("::")[0]!;
    if (
      loc.crate.deps.has(head) ||
      opaqueStandardRoots.get(loc.crate.root)?.has(head)
    )
      return null;
    const shadow = !absolute && find(head, loc, scope, "type");
    if (shadow && (!shadow.complete || shadow.symbols.length)) return null;
    if (path === "std::string::String")
      return { key: "standard:String", alias: false };
    const primitive = path.match(
      /^(?:std|core)::primitive::([ui](?:8|16|32|64|128|size)|f(?:32|64)|bool|char|str)$/,
    )?.[1];
    if (primitive) return { key: `primitive:${primitive}`, alias: false };
    // An identical qualified standard binding is the same type argument even
    // when its declaration is uncaptured. Different paths may be reexports.
    return { key: `standard-path:${path}`, alias: true };
  }
  function importedArgumentKey(
    raw: string,
    loc: Place,
    scope: string,
    callerBindings: Set<string>,
  ): ArgumentKey | null {
    const [head, ...tail] = raw.split("::");
    let local = scope;
    while (true) {
      const imports =
        importsByScope.get(`${loc.file}|${local}`)?.explicit.get(head!) ?? [];
      if (imports.length) {
        if (imports.length !== 1) return null;
        const item = imports[0]!,
          path = [item.targetName, ...tail].join("::");
        if (callerBindings.has(path.replace(/^::/, "").split("::")[0]!))
          return null;
        return (
          standardArgumentKey(path, loc, str(data(item).scope)) ?? {
            key: `import:${loc.crate.root}|${loc.scope}|${loc.local}|${item.id}|${tail.join("::")}`,
            alias: true,
          }
        );
      }
      if (local === loc.local || !local) break;
      local = local.includes("::")
        ? local.slice(0, local.lastIndexOf("::"))
        : "";
    }
    return null;
  }
  function argumentKey(
    raw: string,
    loc: Place,
    scope: string,
    callerBindings: Set<string>,
  ): ArgumentKey | null {
    raw = raw.trim().replace(/\s*::\s*/g, "::");
    if (/^(true|false)$/.test(raw))
      return { key: `literal:${raw}`, alias: false };
    if (/^-?\d[\d_]*$/.test(raw))
      return { key: `integer:${BigInt(raw.replace(/_/g, ""))}`, alias: false };
    if (/^'[^'\\]'$/u.test(raw)) return { key: `char:${raw}`, alias: false };
    if (raw === "()") return { key: "primitive:unit", alias: false };
    if (
      !/^(?:::)?[_\p{ID_Start}][_\p{ID_Continue}]*(?:::[_\p{ID_Start}][_\p{ID_Continue}]*)*$/u.test(
        raw,
      )
    )
      return null;
    if (!raw.startsWith("::") && callerBindings.has(raw.split("::")[0]!))
      return null;
    const type = find(raw, loc, scope, "type");
    if (type.symbols.length > 1) return null;
    if (!type.symbols.length) {
      const binding =
        standardArgumentKey(raw, loc, scope) ??
        importedArgumentKey(raw, loc, scope, callerBindings);
      if (binding) return binding;
    }
    if (!type.complete) return null;
    const symbol = type.symbols[0];
    if (symbol) {
      if (ownerPlace(symbol.file, str(data(symbol).scope)).length !== 1)
        return null;
      if (!["struct", "enum", "type"].includes(symbol.kind)) return null;
      // Distinct aliases can denote the same underlying type. Equal bindings
      // prove equality without expanding an alias; different aliases do not.
      return { key: `symbol:${symbol.id}`, alias: symbol.kind === "type" };
    }
    const value = find(raw, loc, scope, "value");
    if (!value.complete) return null;
    if (value.symbols.length)
      return value.symbols.length === 1 &&
        value.symbols[0]!.kind === "const" &&
        ownerPlace(value.symbols[0]!.file, str(data(value.symbols[0]!).scope))
          .length === 1
        ? { key: `const:${value.symbols[0]!.id}`, alias: true }
        : null;
    if (/^(?:[ui](?:8|16|32|64|128|size)|f(?:32|64)|bool|char|str)$/.test(raw))
      return { key: `primitive:${raw}`, alias: false };
    if (
      raw === "String" &&
      !loc.crate.deps.has("std") &&
      !opaqueStandardRoots.get(loc.crate.root)?.has("std")
    )
      return { key: "standard:String", alias: false };
    return null;
  }
  function splitArguments(args: string): string[] | null {
    const result: string[] = [];
    const stack: string[] = [];
    let start = 1,
      quote = "",
      escaped = false;
    for (let i = 1; i < args.length - 1; i++) {
      const c = args[i]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        continue;
      }
      if ("<([{".includes(c)) stack.push(c);
      else if (">)]}".includes(c)) {
        const expected: Record<string, string> = {
          ">": "<",
          ")": "(",
          "]": "[",
          "}": "{",
        };
        if (stack.pop() !== expected[c]) return null;
      } else if (c === "," && !stack.length) {
        result.push(args.slice(start, i));
        start = i + 1;
      }
    }
    if (quote || stack.length) return null;
    result.push(args.slice(start, -1));
    return result;
  }
  function compatibility(
    receiver: string,
    impl: string,
    generics: string[],
    receiverPlace: Place,
    receiverScope: string,
    declarationPlace: Place,
    declarationScope: string,
    callerGenerics: string,
    receiverSyntax: string,
    declarationSyntax: string,
  ): "yes" | "no" | "unknown" {
    const rawImpl = impl;
    receiver = withoutLifetimes(receiver);
    impl = withoutLifetimes(impl);
    generics = generics.filter((g) => !g.startsWith("'"));
    const receiverArgs = receiver.includes("<")
      ? receiver.slice(receiver.indexOf("<"))
      : "";
    const implArgs = impl.includes("<") ? impl.slice(impl.indexOf("<")) : "";
    if (generics.some((g) => identifiers(rawImpl).includes(g)))
      return "unknown";
    if (!receiverArgs && !implArgs) return "yes";
    if (!receiverArgs || !implArgs) return "unknown";
    const callerBindings = new Set(callerGenerics.split(",").filter(Boolean));
    const tokens =
      receiverArgs.match(/[_\p{ID_Start}][_\p{ID_Continue}]*/gu) ?? [];
    if (
      receiverSyntax &&
      declarationSyntax &&
      receiverSyntax === declarationSyntax &&
      receiverPlace.crate.root === declarationPlace.crate.root &&
      receiverPlace.file === declarationPlace.file &&
      receiverPlace.scope === declarationPlace.scope &&
      receiverScope === declarationScope &&
      !tokens.some((t) => callerBindings.has(t)) &&
      !receiverArgs.includes("!")
    )
      return "yes";
    const left = splitArguments(receiverArgs),
      right = splitArguments(implArgs);
    if (!left || !right || left.length !== right.length) return "unknown";
    let equal = true;
    for (let i = 0; i < left.length; i++) {
      const l = argumentKey(
          left[i]!,
          receiverPlace,
          receiverScope,
          callerBindings,
        ),
        r = argumentKey(
          right[i]!,
          declarationPlace,
          declarationScope,
          new Set(),
        );
      if (!l || !r) {
        equal = false;
        continue;
      }
      if (l.key !== r.key) {
        if (!l.alias && !r.alias) return "no";
        equal = false;
      }
    }
    return equal ? "yes" : "unknown";
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
    sameImpl = "",
    argumentMinimum = argumentCount,
    callerGenerics = "",
    receiverSyntax = "",
  ): Found {
    name = compact(name);

    const expansion = expandType(
      typeName,
      loc,
      scope,
      new Set(),
      new Set(callerGenerics.split(",")),
    );
    if (expansion.externalShape)
      return {
        symbols: unique(
          [...reachable(loc.crate.root)]
            .flatMap(
              (root) =>
                shapeTargets.get(
                  `${root}|${expansion.externalShape}|${name}`,
                ) ?? [],
            )
            .filter((s) => !instance || data(s).receiver === true),
        ),
        complete: false,
        reason:
          "external Box/tuple/array receiver dispatch is not proven; captured project impls retained",
      };
    const foundType = find(
      expansion.text,
      expansion.loc,
      expansion.scope,
      "type",
    );
    const type: Found = { ...foundType, symbols: [...foundType.symbols] };
    type.complete &&= !expansion.unknown;
    typeName = expansion.text;
    if (/^&/.test(typeName)) {
      borrow = /^&\s*(?:'\w+\s*)?mut\b/.test(typeName) ? "mutable" : "shared";
      typeName = typeName.replace(/^&\s*(?:'\w+\s*)?(?:mut\s+)?/, "");
      type.symbols = find(
        typeName,
        expansion.loc,
        expansion.scope,
        "type",
      ).symbols;
    }
    const blankets = visibleBlankets(loc.crate.root);
    if (instance && type.symbols.some((t) => t.kind === "type"))
      return empty(false);
    const ambiguousTypeView = type.symbols.some(
      (t) =>
        ownerPlace(t.file, str(data(t).scope)).filter((p) =>
          reachable(loc.crate.root).has(p.crate.root),
        ).length > 1,
    );
    const applicable = (m: Method) =>
      m.implKey === sameImpl || (m.universal && (!instance || !m.bounded))
        ? "yes"
        : compatibility(
            typeName,
            m.implType,
            m.generics,
            loc,
            scope,
            m.argumentPlace,
            m.argumentScope,
            callerGenerics,
            receiverSyntax,
            m.argumentSyntax,
          );
    const matches = type.symbols
      .flatMap((t) => methodIndex.get(`${t.id}|${name}`) ?? [])
      .filter((m) => {
        if (!reachable(loc.crate.root).has(m.ownerRoot)) return false;
        // Recovered headers cannot prove arity, receiver form or applicability.
        if (data(m.symbol).unsafe) return true;
        if (
          typeof data(m.symbol).arity === "number" &&
          (Number(data(m.symbol).arity) <
            argumentMinimum + (instance ? 1 : 0) ||
            Number(data(m.symbol).arityMinimum ?? data(m.symbol).arity) >
              argumentCount + (instance ? 1 : 0))
        )
          return false;
        if (applicable(m) === "no") return false;
        if (!instance) return true;
        const receiver = compact(str(data(m.symbol).receiverKind));
        if (!receiver || receiver === "none") return false;
        if (borrow === "unknown" || receiver === "unknown") return true;
        if (
          receiver.includes("&mut") &&
          (borrow === "shared" || (borrow === "owned" && !mutable))
        )
          return false;
        if (!receiver.includes("&") && borrow !== "owned") return false;
        return true;
      });

    const unknown = (reason: string): Found => ({
      symbols: unique(matches.map((m) => m.symbol)),
      complete: false,
      reason,
    });
    if (
      (instance && !["owned", "shared", "mutable"].includes(borrow)) ||
      (ambiguousTypeView && !matches.some((m) => m.implKey === sameImpl))
    )
      return unknown("custom receiver adjustment or ambiguous module view");
    if (
      instance &&
      type.symbols.some((t) =>
        [...reachable(loc.crate.root)].some((root) =>
          macroTypesByCrate.get(root)?.has(t.id),
        ),
      )
    )
      return unknown("opaque item macro may implement the receiver type");
    const inherent = matches.filter((m) => m.inherent);
    const proven = inherent.filter(
      (m) =>
        !m.uncertain &&
        applicable(m) === "yes" &&
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
    if (stdBlanketNames.has(name) && (instance || !proven.length))
      return unknown("uncaptured std/core blanket alternative: " + name);
    // A proven inherent receiver exactly matches an existing &Type or owned Type
    // before any dereference/autoref adjustment. Nominal-wrapper traits cannot
    // beat it at that step. Universal and reference guards remain conservative.
    const exactReceiver =
      instance &&
      ["shared", "owned"].includes(borrow) &&
      proven.some((m) => form(m) === borrow);
    // Receiver candidates are searched before inherent/trait preference at that
    // candidate. Different autoref forms do NOT imply inherent dominance.
    if (
      instance &&
      (blankets.opaque ||
        (!exactReceiver &&
          type.symbols.some((t) => blankets.opaqueTypes.has(t.id))) ||
        blankets.names.has(name) ||
        (!exactReceiver &&
          type.symbols.some((t) => blankets.byType.get(t.id)?.has(name))) ||
        type.symbols.some(
          (t) =>
            blankets.refs.get(t.id)?.has(name) ||
            blankets.refs.get(t.id)?.has("*"),
        ))
    )
      return unknown(
        "project blanket/reference impl applicability or defaults unknown",
      );
    if (
      !instance &&
      !proven.length &&
      (blankets.opaque ||
        blankets.associatedNames.has(name) ||
        type.symbols.some(
          (t) =>
            blankets.opaqueTypes.has(t.id) ||
            blankets.associatedByType.get(t.id)?.has(name),
        ))
    )
      return unknown(
        "project blanket/reference impl applicability or defaults unknown",
      );
    const opaque = type.symbols.some((t) => blankets.opaqueNormal.has(t.id));
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
        selected.some((m) => m.uncertain || applicable(m) !== "yes"))
    )
      return {
        symbols: ss,
        complete: false,
        reason: "trait-only dispatch or generic substitution/bounds not proven",
      };
    return {
      symbols: ss,
      reason: expansion.unknown
        ? "alias expansion unknown"
        : opaque
          ? "uncaptured trait defaults or trait-in-scope selection"
          : "generic substitution or impl bounds not proven",
      complete:
        complete &&
        !selected.some((m) => m.uncertain || applicable(m) !== "yes"),
    };
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
          if (selfPath && d.implType)
            name = base(str(d.implType)) + name.slice(4);
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
              compact(l.targetName).startsWith("self.")
                ? `${l.file}|${str(d.implKey)}`
                : "",
              Number(d.argumentMinimum ?? d.argumentCount),
              str(d.genericBindings),
              str(d.receiverArgumentSyntax),
            );
          const ns: Namespace = ["calls", "values"].includes(l.kind)
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
            const pathSyntax = selfPath
              ? name
              : (str(d.pathSyntax) || l.targetName).replace(/\br#/g, "");
            const split = pathSyntax.lastIndexOf("::");
            result = methods(
              selfPath ? str(d.implType) : pathSyntax.slice(0, split).trim(),
              pathSyntax.slice(split + 2).trim(),
              loc,
              scope,
              false,
              "owned",
              true,
              Number(d.argumentCount),
              selfPath ? `${l.file}|${str(d.implKey)}` : "",
              Number(d.argumentMinimum ?? d.argumentCount),
              str(d.genericBindings),
              str(selfPath ? d.implArgumentSyntax : d.pathArgumentSyntax),
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
    if (found.symbols.some((s) => data(s).unsafe)) {
      found.complete = false;
      found.reason = "syntax-error declaration or recovered region";
    }
    if (!found.complete) {
      uncertain?.(
        l,
        unique(found.symbols),
        found.reason || "namespace/import/alias structure is unknown",
      );
      continue;
    }
    const targets = unique(found.symbols);
    // One import can bind several namespaces simultaneously. The interface's
    // one-of relation cannot assert such a multi-binding as one candidate set.
    if (l.kind === "imports" && new Set(targets.map((s) => s.kind)).size > 1) {
      uncertain?.(
        l,
        targets,
        "Simultaneous namespace bindings cannot be represented as one-of",
      );
      continue;
    }
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
