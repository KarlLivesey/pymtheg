import { posix as p } from "node:path";
import type {
  GraphSymbol,
  Json,
  LinkResolution,
  ResolutionContext,
} from "../../types.js";
import { crates, type Crate } from "./cargo.js";

type Data = Record<string, Json>;
const data = (x: { data?: Json }) => (x.data ?? {}) as Data;
const str = (x: unknown) => (typeof x === "string" ? x : "");
const clean = (s: string) =>
  s
    .replace(/\s+/g, "")
    .replace(/::<[^<>]*>/g, "")
    .replace(/<[^<>]*>/g, "");
interface Place {
  crate: Crate;
  local: string;
  scope: string;
  directory: string;
  file: string;
}
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
  // A loose source remains extractable but has no invented crate/module layout.
  const places: Place[] = [];
  const moduleTargets = new Map<string, GraphSymbol[]>();
  const byFile = new Map<string, GraphSymbol[]>();
  for (const s of symbols) {
    const list = byFile.get(s.file) ?? [];
    list.push(s);
    byFile.set(s.file, list);
  }
  const units = new Map(
    symbols.filter((s) => data(s).unit).map((s) => [s.file, s]),
  );
  function walk(place: Place, ancestors: Set<string>) {
    const visitKey = `${place.crate.root}|${place.file}|${place.local}`;
    if (ancestors.has(visitKey)) return;
    places.push(place);
    const next = new Set([...ancestors, visitKey]);
    for (const s of byFile.get(place.file) ?? []) {
      if (
        s.kind !== "module" ||
        data(s).unit ||
        str(data(s).scope) !== place.local
      )
        continue;
      const scope = place.scope ? `${place.scope}::${s.name}` : s.name;
      const local = place.local ? `${place.local}::${s.name}` : s.name;
      if (data(s).inline)
        walk(
          {
            ...place,
            scope,
            local,
            directory: p.join(place.directory, s.name),
          },
          next,
        );
      else {
        const path = str(data(s).path);
        // #[path] inside an inline module is relative to that module's directory.
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
        moduleTargets.set(s.id, [
          ...new Set([
            ...(moduleTargets.get(s.id) ?? []),
            ...targets.map((f) => units.get(f)!).filter(Boolean),
          ]),
        ]);
        for (const file of targets)
          walk(
            {
              crate: place.crate,
              file,
              local: "",
              scope,
              directory:
                p.basename(file) === "mod.rs"
                  ? p.dirname(file)
                  : p.join(p.dirname(file), p.basename(file, ".rs")),
            },
            next,
          );
      }
    }
  }
  for (const crate of packages)
    walk(
      {
        crate,
        file: crate.root,
        scope: "",
        local: "",
        directory: p.dirname(crate.root),
      },
      new Set(),
    );
  const ownerPlace = (file: string, scope: string) =>
    places
      .filter(
        (loc) =>
          loc.file === file &&
          (!loc.local ||
            scope === loc.local ||
            scope.startsWith(loc.local + "::")),
      )
      .filter(
        (loc) =>
          !places.some(
            (other) =>
              other.file === file &&
              other.crate.root === loc.crate.root &&
              other.local.length > loc.local.length &&
              (scope === other.local || scope.startsWith(other.local + "::")),
          ),
      );
  const qualified = (loc: Place, local: string) =>
    [loc.scope, local.slice(loc.local.length).replace(/^::/, "")]
      .filter(Boolean)
      .join("::");
  const key = (root: string, scope: string) => `${root}|${scope}`;
  const table = new Map<string, GraphSymbol[]>();
  function put(k: string, s: GraphSymbol) {
    const list = table.get(k) ?? [];
    if (!list.some((x) => x.id === s.id)) list.push(s);
    table.set(k, list);
  }
  const memberScopes = new Set(
    symbols
      .filter((s) => s.kind === "impl" || s.kind === "trait")
      .map((s) => `${s.file}|${s.identity}`),
  );
  for (const s of symbols.filter(
    (s) => !memberScopes.has(`${s.file}|${str(data(s).scope)}`),
  ))
    for (const loc of ownerPlace(s.file, str(data(s).scope))) {
      // A file module has a declaration and a file unit, but one namespace.
      // Name lookup uses its declaration; `modules` links target the file unit.
      if (data(s).unit && loc.scope) continue;
      const q = data(s).unit
        ? loc.scope
        : [qualified(loc, str(data(s).scope)), s.name]
            .filter(Boolean)
            .join("::");
      put(key(loc.crate.root, q), s);
    }
  const imports = ctx.links.filter((l) => l.kind === "imports");
  const unique = (ss: GraphSymbol[]) => [
    ...new Map(ss.map((s) => [s.id, s])).values(),
  ];
  type Found = { symbols: GraphSymbol[]; uncertain: boolean };
  function lookup(
    name: string,
    loc: Place,
    localScope: string,
    seen: Set<string> = new Set(),
    allowGlobs = true,
  ): Found {
    name = clean(name);
    const guard = `${loc.crate.root}|${loc.file}|${localScope}|${name}|${allowGlobs}`;
    if (seen.has(guard) || seen.size > 64)
      return { symbols: [], uncertain: true };
    seen = new Set([...seen, guard]);
    const parts = name.replace(/^::/, "").split("::");
    const first = parts[0]!;
    const qscope = qualified(loc, localScope);
    const direct = (root: string, q: string): Found => ({
      symbols: table.get(key(root, q)) ?? [],
      uncertain: false,
    });
    if (first === "crate")
      return direct(loc.crate.root, parts.slice(1).join("::"));
    if (first === "self" || first === "super") {
      const base = loc.scope ? loc.scope.split("::") : [];
      while (parts[0] === "super") {
        if (!base.length) return { symbols: [], uncertain: true };
        base.pop();
        parts.shift();
      }
      if (parts[0] === "self") parts.shift();
      return direct(loc.crate.root, [...base, ...parts].join("::"));
    }
    const dependency = loc.crate.deps.get(first);
    // Local lexical names take precedence over the extern prelude.
    const scopes: string[] = [];
    let current = qscope;
    while (true) {
      scopes.push(current);
      if (!current) break;
      current = current.includes("::")
        ? current.slice(0, current.lastIndexOf("::"))
        : "";
    }
    for (const scope of scopes) {
      const found = direct(
        loc.crate.root,
        [scope, name].filter(Boolean).join("::"),
      );
      if (found.symbols.length) return found;
      // An existing first segment blocks fallback to a similarly named crate.
      const head = direct(
        loc.crate.root,
        [scope, first].filter(Boolean).join("::"),
      );
      const uses = imports.filter(
        (l) =>
          l.file === loc.file &&
          (!loc.local ||
            str(data(l).scope) === loc.local ||
            str(data(l).scope).startsWith(loc.local + "::")) &&
          qualified(loc, str(data(l).scope)) === scope,
      );
      const explicit = uses.filter(
        (l) => !data(l).glob && str(data(l).alias) === first,
      );
      if (explicit.length) {
        const results = explicit.map((l) =>
          lookup(
            [l.targetName, ...parts.slice(1)].join("::"),
            loc,
            str(data(l).scope),
            seen,
            allowGlobs,
          ),
        );
        return {
          symbols: unique(results.flatMap((r) => r.symbols)),
          uncertain: results.some((r) => r.uncertain || !r.symbols.length),
        };
      }
      if (head.symbols.length) return { symbols: [], uncertain: false };
      // A glob's own path must resolve independently. Feeding an opaque path
      // back through the same globs grows names forever (external::external::...).
      // Chained opaque glob namespaces remain unknown rather than guessed.
      const glob = allowGlobs ? uses.filter((l) => data(l).glob) : [];
      if (glob.length) {
        const results = glob.map((l) => {
          const module = lookup(
            l.targetName.replace(/::\*$/, ""),
            loc,
            str(data(l).scope),
            seen,
            false,
          );
          const found = lookup(
            l.targetName.replace(/\*$/, name),
            loc,
            str(data(l).scope),
            seen,
            false,
          );
          return {
            ...found,
            uncertain:
              found.uncertain ||
              !module.symbols.length ||
              module.symbols.some(
                (s) => s.kind !== "module" || s.status !== "clean",
              ),
          };
        });
        const found = unique(results.flatMap((r) => r.symbols));
        // Unresolved globs could introduce collisions; never assert a winner.
        if (found.length)
          return {
            symbols: found,
            uncertain: results.some((r) => r.uncertain),
          };
      }
      // Rust 2018 bare paths do not search parent modules implicitly.
      if (scope === loc.scope) break;
    }
    if (dependency) {
      const targets = packages.filter(
        (c) => c.manifest === dependency && c.kind === "lib",
      );
      return {
        symbols: unique(
          targets.flatMap(
            (c) => table.get(key(c.root, parts.slice(1).join("::"))) ?? [],
          ),
        ),
        uncertain: targets.length !== 1,
      };
    }
    return { symbols: [], uncertain: false };
  }
  // Follow an alias/module prefix (e.g. `use crate::api as a; a::f()`).
  // lookup's explicit import substitution handles paths without exporting imports
  // into the symbol table; cross-module reexports below use their owning scope.
  function find(name: string, loc: Place, scope: string): Found {
    const initial = lookup(name, loc, scope);
    if (initial.symbols.length) return initial;
    const parts = clean(name).split("::");
    for (let i = parts.length - 1; i > 0; i--) {
      const prefix = lookup(parts.slice(0, i).join("::"), loc, scope);
      const results: Found[] = [];
      for (const s of prefix.symbols.filter((s) => s.kind === "module")) {
        const destinations = data(s).unit
          ? [s]
          : data(s).inline
            ? [s]
            : (moduleTargets.get(s.id) ?? []);
        for (const dest of destinations) {
          const local = data(dest).unit ? "" : dest.identity;
          for (const place of places.filter(
            (pl) =>
              pl.file === dest.file &&
              pl.local === local &&
              pl.crate.root === loc.crate.root,
          ))
            results.push(lookup(parts.slice(i).join("::"), place, local));
        }
      }
      const ss = unique(results.flatMap((r) => r.symbols));
      if (ss.length)
        return {
          symbols: ss,
          uncertain: prefix.uncertain || results.some((r) => r.uncertain),
        };
    }
    return initial;
  }
  const impls = symbols.filter((s) => s.kind === "impl");
  const methodIndex = new Map<
    string,
    { symbol: GraphSymbol; inherent: boolean; uncertain: boolean }[]
  >();
  for (const impl of impls) {
    const members = (byFile.get(impl.file) ?? []).filter(
      (s) => s.kind === "method" && str(data(s).scope) === impl.identity,
    );
    for (const loc of ownerPlace(impl.file, str(data(impl).scope))) {
      const type = str(data(impl).implType);
      if (
        Array.isArray(data(impl).generics) &&
        (data(impl).generics as Json[]).includes(clean(type))
      )
        continue;
      const target = find(type, loc, str(data(impl).scope));
      for (const t of target.symbols.filter((s) =>
        ["struct", "enum", "type"].includes(s.kind),
      )) {
        for (const member of members) {
          const k = `${t.id}|${member.name}`;
          const list = methodIndex.get(k) ?? [];
          list.push({
            symbol: member,
            inherent: !data(impl).trait,
            uncertain: target.uncertain,
          });
          methodIndex.set(k, list);
        }
      }
    }
  }
  function methods(
    typeName: string,
    method: string,
    loc: Place,
    scope: string,
    instance: boolean,
  ): Found {
    const type = find(typeName, loc, scope);
    const matches = type.symbols
      .flatMap((t) => methodIndex.get(`${t.id}|${method}`) ?? [])
      .filter(
        (m) =>
          (!instance || data(m.symbol).receiver === true) &&
          (instance || m.inherent),
      );
    const inherent = matches.some((m) => m.inherent);
    const selected = inherent ? matches.filter((m) => m.inherent) : matches;
    return {
      symbols: unique(selected.map((m) => m.symbol)),
      uncertain:
        type.uncertain ||
        selected.some((m) => m.uncertain) ||
        (!inherent && selected.length > 0),
    };
  }
  const resolutions: LinkResolution[] = [];
  for (const l of ctx.links) {
    const d = data(l);
    let targets: GraphSymbol[] = [];
    let uncertain = false;
    if (l.kind === "contains")
      targets = (byFile.get(l.file) ?? []).filter((s) => s.key === d.key);
    else if (l.kind === "modules") {
      const symbol = (byFile.get(l.file) ?? []).find((s) => s.key === d.key);
      targets = symbol ? (moduleTargets.get(symbol.id) ?? []) : [];
    } else if (!d.blocked) {
      for (const loc of ownerPlace(l.file, str(d.scope))) {
        let name = l.targetName;
        const selfPath = name === "Self" || name.startsWith("Self::");
        const lookupScope = selfPath ? str(d.implScope) : str(d.scope);
        if (name.startsWith("Self::") && d.implType)
          name = str(d.implType) + name.slice(4);
        if (name === "Self" && d.implType) name = str(d.implType);
        let found = d.method
          ? methods(
              str(d.receiverType),
              str(d.method),
              loc,
              str(d.typeScope),
              true,
            )
          : find(name, loc, lookupScope);
        if (
          l.kind === "calls" &&
          !d.method &&
          !found.symbols.length &&
          name.includes("::")
        ) {
          const split = name.lastIndexOf("::");
          found = methods(
            name.slice(0, split),
            name.slice(split + 2),
            loc,
            lookupScope,
            false,
          );
        }
        const allowed =
          l.kind === "calls"
            ? ["function", "method", "struct", "variant"]
            : l.kind === "macros"
              ? ["macro"]
              : l.kind === "implements"
                ? ["trait"]
                : l.kind === "types"
                  ? ["struct", "enum", "trait", "type"]
                  : null;
        targets.push(
          ...found.symbols.filter((s) => !allowed || allowed.includes(s.kind)),
        );
        uncertain ||= found.uncertain;
      }
    }
    targets = unique(targets);
    if (l.kind === "macros")
      targets = targets.filter(
        (s) =>
          s.file === l.file &&
          s.range.start < l.range.start &&
          (str(d.scope) === str(data(s).scope) ||
            str(d.scope).startsWith(str(data(s).scope) + "::") ||
            !data(s).scope),
      );
    if (targets.length > 1)
      resolutions.push({
        linkId: l.id,
        candidateIds: targets.map((s) => s.id),
      });
    else if (targets.length === 1 && !uncertain)
      resolutions.push({ linkId: l.id, targetId: targets[0]!.id });
  }
  return resolutions;
}
