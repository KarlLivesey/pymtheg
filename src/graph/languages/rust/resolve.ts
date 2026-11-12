import { implies as cfgImplies, possible as cfgPossible } from "./cfg.js";
import {
  knownAttributeName,
  attributeRules,
  attributeBindingShadows,
  type MacroUseImport,
} from "./parse.js";
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
type Namespace = "type" | "value" | "macro" | "any" | "import" | "importType";
type AttributeOrigin = { name: string; scope: string; file: string };
type AttributeGate = AttributeOrigin & { condition: string; explicit: boolean };
interface Place {
  crate: Crate;
  local: string;
  scope: string;
  directory: string;
  file: string;
  parent: Place | null;
  symbol?: GraphSymbol;
  uncertain?: boolean;
  conditions?: string[];
  opaqueAttributes?: string[];
  shadowableAttributes?: AttributeOrigin[];
  attributeGates?: AttributeGate[];
}
interface Found {
  symbols: GraphSymbol[];
  complete: boolean;
  reason?: string;
  failedFiles?: string[];
  bound?: boolean;
  opaqueAttributes?: string[];
}
const unique = (ss: GraphSymbol[]) => [
  ...new Map(ss.map((s) => [s.id, s])).values(),
];
const accepts = (s: GraphSymbol, ns: Namespace) => {
  if (ns === "any") return true;
  if (data(s).semanticKind === "macro") return ns === "macro" || ns === "value";
  if (data(s).namespaceUnverified && (ns === "macro" || ns === "value"))
    return true;
  if (ns === "macro") return s.kind === "macro";
  if (ns === "importType" && s.kind === "variant") return true;
  if (ns === "type" || ns === "importType")
    return ["module", "struct", "enum", "trait", "type"].includes(s.kind);
  return (
    ["function", "const", "static"].includes(s.kind) ||
    (s.kind === "variant" && data(s).constructorForm !== "named") ||
    (s.kind === "struct" && data(s).constructorForm !== "named")
  );
};
// A proc-macro declaration has one captured function identity, an exported
// macro name, and a function-value facet available only inside its own crate.
const acceptsAt = (
  s: GraphSymbol,
  ns: Namespace,
  name: string,
  root: string,
  from: string,
) => {
  if (!accepts(s, ns)) return false;
  if (data(s).semanticKind !== "macro") return true;
  const macro = name === str(data(s).exportedMacroName),
    value = root === from && name === s.name;
  return ns === "macro"
    ? macro
    : ns === "value"
      ? value
      : ns === "any"
        ? macro || value
        : false;
};
export function resolveRust(
  ctx: ResolutionContext,
  uncertain?: (
    link: GraphLink,
    targets: GraphSymbol[],
    reason: string,
    files?: string[],
    attributes?: string[],
  ) => void,
  markPresence?: (
    symbol: GraphSymbol,
    attributes: string[],
    conditions: string[],
  ) => void,
  markConditions?: (link: GraphLink, conditions: string[]) => void,
): LinkResolution[] {
  // Cache only unproved import namespaces, never targets or positive proofs.
  // Facts are immutable for this run; caller conditions and placement are in
  // the key. A failed proof keeps alternatives, it never asserts a binding.
  const unprovedImports = new Set<string>();
  let cycleCuts = 0;
  const namespaceParents = new WeakMap<Place, number>();
  let nextNamespaceParent = 0;
  const implicationCache = new Map<string, boolean>();
  const possibilityCache = new Map<string, boolean>();
  const implies = (caller: readonly string[], condition: string): boolean => {
    const key = JSON.stringify([caller, condition]);
    let result = implicationCache.get(key);
    if (result === undefined) {
      result = cfgImplies(caller, condition);
      implicationCache.set(key, result);
    }
    return result;
  };
  const attributeBindings = new Map<
    string,
    {
      names: string[];
      unknown: boolean;
      macroUse?: boolean;
      macroUseImports?: MacroUseImport[];
    }
  >();
  for (const file of ctx.files)
    for (const b of (data(file.result).attributeBindings ?? []) as {
      scope: string;
      names: string[];
      unknown: boolean;
      macroUse?: boolean;
      macroUseImports?: MacroUseImport[];
    }[]) {
      const key = file.path + "|" + b.scope,
        old = attributeBindings.get(key);
      attributeBindings.set(key, {
        names: [...new Set([...(old?.names ?? []), ...b.names])],
        unknown: !!old?.unknown || b.unknown,
        macroUse: !!old?.macroUse || !!b.macroUse,
        macroUseImports: [
          ...(old?.macroUseImports ?? []),
          ...(b.macroUseImports ?? []),
        ],
      });
    }
  type AttributeContext = {
    shadowable: { name: string; scope: string }[];
    implicit: {
      name: string;
      scope: string;
      condition: string;
      explicit: boolean;
    }[];
  };
  const contextsByFile = new Map(
    ctx.files.map((f) => [
      f.path,
      (data(f.result).attributeContexts ?? []) as AttributeContext[],
    ]),
  );
  const contextOf = (item: GraphSymbol | GraphLink) =>
    contextsByFile.get(item.file)?.[Number(data(item).attributeContext)];
  const gates = (item: GraphSymbol | GraphLink): AttributeGate[] =>
    (contextOf(item)?.implicit ?? []).map((g) => ({ ...g, file: item.file }));
  const origins = (item: GraphSymbol | GraphLink): AttributeOrigin[] =>
    (contextOf(item)?.shadowable ?? []).map((x) => ({ ...x, file: item.file }));
  // A finite graph of captured module exports. A glob transfers only names
  // visible in its source module; opaque/unreadable output contributes none
  // under E4. This is positive binding evidence, never an export-completeness
  // claim or a semantic target resolution.
  let capturedMacroExports: Map<string, Set<string>> | undefined;
  function readableMacroUseBinds(
    head: string,
    file: string,
    scope: string,
    imports: readonly MacroUseImport[],
  ): boolean {
    if (!imports.length) return false;
    head = head.split("::")[0]!;
    const manifests = new Set(
      ownerPlace(file, scope).flatMap((own) =>
        imports.flatMap((request) => {
          if (request.names && !request.names.includes(head)) return [];
          const manifest = own.crate.deps.get(request.crate);
          return manifest &&
            packages.some((c) => c.kind === "lib" && c.manifest === manifest)
            ? [manifest]
            : [];
        }),
      ),
    );
    if (!manifests.size) return false;
    if (!capturedMacroExports) {
      const libs = new Map(
        packages.filter((c) => c.kind === "lib").map((c) => [c.root, c]),
      );
      const exports = new Map<string, Set<string>>();
      const aliases = new Map<
        string,
        { raw: string; scope: string; crate: Crate }[]
      >();
      const globs: { raw: string; scope: string; crate: Crate }[] = [];
      const key = (manifest: string, q: string) => manifest + "|" + q;
      const get = (manifest: string, q: string) => {
        const k = key(manifest, q);
        let names = exports.get(k);
        if (!names) {
          names = new Set();
          exports.set(k, names);
        }
        return names;
      };
      const qualifiedScope = (loc: Place, local: string) =>
        [loc.scope, local.slice(loc.local.length).replace(/^::/, "")]
          .filter(Boolean)
          .join("::");
      for (const loc of places)
        if (libs.has(loc.crate.root)) get(loc.crate.manifest, loc.scope);
      const watched = (name: string) => {
        const rule = attributeRules.get(name);
        return !!rule && rule.category !== "builtin";
      };
      for (const symbol of symbols)
        if (data(symbol).visibility === "pub") {
          const d = data(symbol),
            conditionalMacro =
              d.namespaceUnverified === true && Array.isArray(d.procMacroKinds);
          const names = [
            ...(symbol.kind === "macro" || d.semanticKind === "macro"
              ? [str(d.exportedMacroName) || symbol.name]
              : []),
            ...(conditionalMacro
              ? (d.procMacroKinds as string[]).some((k) =>
                  ["proc_macro", "proc_macro_attribute"].includes(k),
                )
                ? [symbol.name]
                : []
              : []),
            ...(conditionalMacro
              ? ((d.exportedMacroNames ?? []) as string[])
              : []),
          ]
            .map(compact)
            .filter(watched);
          if (!names.length) continue;
          for (const loc of ownerPlace(symbol.file, str(d.scope)))
            if (
              libs.has(loc.crate.root) &&
              possible([
                ...(loc.conditions ?? []),
                ...((d.conditions ?? []) as string[]),
              ])
            )
              for (const name of names)
                get(
                  loc.crate.manifest,
                  symbol.kind === "macro"
                    ? ""
                    : qualifiedScope(loc, str(d.scope)),
                ).add(name);
        }
      const functionRegions = new Map<
        string,
        { start: number; end: number }[]
      >();
      for (const symbol of symbols)
        if (["function", "method"].includes(symbol.kind)) {
          const ranges = functionRegions.get(symbol.file) ?? [];
          ranges.push(symbol.range);
          functionRegions.set(symbol.file, ranges);
        }
      for (const link of ctx.links)
        if (
          link.kind === "imports" &&
          !(functionRegions.get(link.file) ?? []).some(
            (r) => r.start <= link.range.start && r.end >= link.range.end,
          )
        )
          for (const loc of ownerPlace(link.file, str(data(link).scope)))
            if (
              libs.has(loc.crate.root) &&
              possible([
                ...(loc.conditions ?? []),
                ...((data(link).conditions ?? []) as string[]),
              ])
            ) {
              const q = qualifiedScope(loc, str(data(link).scope)),
                raw = compact(link.targetName),
                alias = compact(
                  str(data(link).alias) || raw.split("::").at(-1)!,
                );
              if (!exports.has(key(loc.crate.manifest, q))) continue;
              if (!data(link).glob) {
                const k = key(
                    loc.crate.manifest,
                    [q, alias].filter(Boolean).join("::"),
                  ),
                  entries = aliases.get(k) ?? [];
                entries.push({ raw, scope: q, crate: loc.crate });
                aliases.set(k, entries);
                if (data(link).visibility === "pub" && watched(alias))
                  get(loc.crate.manifest, q).add(alias);
              } else if (data(link).visibility === "pub")
                globs.push({ raw, scope: q, crate: loc.crate });
            }
      const modules = (
        raw: string,
        c: Crate,
        scope: string,
        seen = new Set<string>(),
      ): string[] => {
        const visit = key(c.manifest, scope) + "|" + raw;
        if (seen.has(visit)) return [];
        const next = new Set([...seen, visit]);
        const absolute = raw.startsWith("::"),
          parts = raw
            .replace(/^::/, "")
            .split("::")
            .filter((x) => x !== "*");
        let current = scope,
          explicit = false;
        if (parts[0] === "crate") {
          parts.shift();
          current = "";
          explicit = true;
        } else if (parts[0] === "self") {
          parts.shift();
          explicit = true;
        }
        while (parts[0] === "super") {
          parts.shift();
          current = current.includes("::")
            ? current.slice(0, current.lastIndexOf("::"))
            : "";
          explicit = true;
        }
        const found: string[] = [];
        if (!explicit && parts.length) {
          const dep = c.deps.get(parts[0]!);
          if (dep) {
            const k = key(dep, parts.slice(1).join("::"));
            if (exports.has(k)) found.push(k);
          }
        }
        for (const q of explicit
          ? [current]
          : absolute || c.edition === "2015"
            ? [""]
            : [...new Set([current, ""])]) {
          const path = [q, ...parts].filter(Boolean).join("::"),
            k = key(c.manifest, path);
          if (exports.has(k)) found.push(k);
          if (parts.length)
            for (const a of aliases.get(
              key(c.manifest, [q, parts[0]].filter(Boolean).join("::")),
            ) ?? []) {
              const edge =
                "alias:" +
                key(c.manifest, [q, parts[0]].filter(Boolean).join("::")) +
                "|" +
                a.raw;
              if (next.has(edge)) continue;
              found.push(
                ...modules(
                  [a.raw, ...parts.slice(1)].join("::"),
                  a.crate,
                  a.scope,
                  new Set([...next, edge]),
                ),
              );
            }
        }
        return [...new Set(found)];
      };
      const edges = globs.flatMap((g) =>
        modules(g.raw, g.crate, g.scope).map((source) => ({
          source,
          dest: key(g.crate.manifest, g.scope),
        })),
      );
      // Finite names and module nodes: deterministic fixed point, no time bound.
      let changed = true;
      while (changed) {
        changed = false;
        for (const e of edges)
          for (const name of exports.get(e.source) ?? []) {
            const dest = exports.get(e.dest)!;
            if (!dest.has(name)) {
              dest.add(name);
              changed = true;
            }
          }
      }
      capturedMacroExports = new Map(
        packages
          .filter((c) => c.kind === "lib")
          .map((c) => [
            c.manifest,
            exports.get(key(c.manifest, "")) ?? new Set<string>(),
          ]),
      );
    }
    for (const manifest of manifests)
      if (capturedMacroExports.get(manifest)?.has(head)) return true;
    return false;
  }
  const attributeShadowCache = new Map<string, boolean>();
  function shadowFromParents(origin: AttributeOrigin): boolean {
    const key = JSON.stringify(origin),
      cached = attributeShadowCache.get(key);
    if (cached !== undefined) return cached;
    const head = origin.name.split("::")[0]!,
      rule = attributeRules.get(head);
    let result = false;
    if (rule && rule.category !== "builtin")
      for (const own of ownerPlace(origin.file, origin.scope)) {
        if (rule.category === "tool" && own.crate.deps.has(head)) result = true;
        let parent: Place | null = own;
        while (parent) {
          {
            let scope = parent === own ? origin.scope : parent.local;
            while (true) {
              const b = attributeBindings.get(parent.file + "|" + scope);
              if (
                b &&
                attributeBindingShadows(
                  head,
                  (parent.file !== origin.file && b.names.includes(head)) ||
                    readableMacroUseBinds(
                      head,
                      parent.file,
                      scope,
                      b.macroUseImports ?? [],
                    ),
                  parent.file !== origin.file &&
                    (b.unknown ||
                      (rule.category === "prelude" && !!b.macroUse)),
                )
              )
                result = true;
              if (!scope) break;
              scope = scope.includes("::")
                ? scope.slice(0, scope.lastIndexOf("::"))
                : "";
            }
          }
          parent = parent.parent;
        }
      }
    attributeShadowCache.set(key, result);
    return result;
  }
  let attributeContextReady = false;
  const itemPresenceCache = new Map<string, string[]>();
  function itemPresence(item: GraphSymbol | GraphLink): string[] {
    const cached = itemPresenceCache.get(item.id);
    if (cached) return cached;
    const attributes = [
      ...new Set([
        ...((data(item).opaqueItemAttributes ?? []) as string[]),
        ...[
          ...origins(item),
          ...ownerPlace(item.file, str(data(item).scope)).flatMap(
            (p) => p.shadowableAttributes ?? [],
          ),
        ]
          .filter(shadowFromParents)
          .map((x) => x.name),
        ...ownerPlace(item.file, str(data(item).scope)).flatMap(
          (p) => p.opaqueAttributes ?? [],
        ),
      ]),
    ].sort();
    itemPresenceCache.set(item.id, attributes);
    return attributes;
  }
  const possible = (conditions: readonly string[]): boolean => {
    const key = JSON.stringify(conditions);
    let result = possibilityCache.get(key);
    if (result === undefined) {
      result = cfgPossible(conditions);
      possibilityCache.set(key, result);
    }
    return result;
  };
  const failedFiles = new Set(
    ctx.files
      .filter((f) => f.module === "rust" && f.result.status === "failed")
      .map((f) => f.path),
  );
  const symbols = ctx.symbols.filter(
    (s) => s.module === "rust" && !failedFiles.has(s.file),
  );
  const files = new Set(
    ctx.files.filter((f) => f.module === "rust").map((f) => f.path),
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
  const moduleIncomplete = new Set<string>();
  const moduleConditions = new Map<string, string[]>();
  const conditionsFor = (s: GraphSymbol | GraphLink): string[] => {
    let conditions =
      moduleConditions.get(s.id) ?? ((data(s).conditions ?? []) as string[]);
    if (attributeContextReady)
      for (const gate of contextOf(s)?.implicit ?? [])
        if (
          !gate.explicit &&
          shadowFromParents({
            name: gate.name,
            scope: gate.scope,
            file: s.file,
          })
        )
          conditions = conditions.filter((c) => c !== gate.condition);
        else if (!conditions.includes(gate.condition))
          conditions = [...conditions, gate.condition];
    if (data(s).macroPathCondition)
      conditions = [...conditions, str(data(s).macroPathCondition)];
    return contextOf(s)?.implicit.length
      ? [...new Set(conditions)].sort()
      : conditions;
  };
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
          conditions: [
            ...(place.conditions ?? []),
            ...((data(s).conditions ?? []) as string[]),
          ],
          opaqueAttributes: [
            ...(place.opaqueAttributes ?? []),
            ...((data(s).opaqueItemAttributes ?? []) as string[]),
          ],
          shadowableAttributes: [
            ...(place.shadowableAttributes ?? []),
            ...origins(s),
          ],
          attributeGates: [...(place.attributeGates ?? []), ...gates(s)],
          uncertain: place.uncertain || moduleIncomplete.has(s.id),
        });
      else {
        const path = str(data(s).path);
        const pathTargets = new Set(
          ((data(s).paths ?? []) as string[]).map((path) =>
            p.normalize(
              p.join(
                place.local ? place.directory : p.dirname(place.file),
                path,
              ),
            ),
          ),
        );
        const ordinary = [
          p.join(place.directory, `${s.name}.rs`),
          p.join(place.directory, s.name, "mod.rs"),
        ];
        const possible = [
          ...new Set([
            ...(data(s).pathExplicit || path ? [] : ordinary),
            ...pathTargets,
          ]),
        ];
        if (data(s).pathOpaque) moduleIncomplete.add(s.id);
        if (
          pathTargets.size &&
          ([...pathTargets].some((f) => !files.has(f)) ||
            (!path && !ordinary.some((f) => files.has(f))))
        )
          moduleIncomplete.add(s.id);
        const targets = possible.filter((f) => files.has(f));
        const fileConditions = targets.map(
          (f) => (data(units.get(f) ?? {}).conditions ?? []) as string[],
        );
        if (fileConditions.length) {
          const same = fileConditions.every(
            (cs) => JSON.stringify(cs) === JSON.stringify(fileConditions[0]),
          );
          moduleConditions.set(s.id, [
            ...((data(s).conditions ?? []) as string[]),
            ...(same ? fileConditions[0]! : ["?module-file-cfg"]),
          ]);
        }

        if (!targets.length) moduleIncomplete.add(s.id);
        moduleTargets.set(
          s.id,
          unique([
            ...(moduleTargets.get(s.id) ?? []),
            ...targets.map((f) => units.get(f)!).filter(Boolean),
          ]),
        );
        for (const file of targets) {
          const directories = new Set<string>();
          if (pathTargets.has(file)) directories.add(p.dirname(file));
          if (!data(s).pathExplicit && !path && ordinary.includes(file))
            directories.add(
              p.basename(file) === "mod.rs"
                ? p.dirname(file)
                : p.join(p.dirname(file), p.basename(file, ".rs")),
            );
          for (const directory of directories)
            destinations.push({
              crate: place.crate,
              file,
              local: "",
              scope,
              parent: place,
              symbol: s,
              conditions: [
                ...(place.conditions ?? []),
                ...((data(s).conditions ?? []) as string[]),
                ...((data(units.get(file) ?? {}).conditions ?? []) as string[]),
              ],
              opaqueAttributes: [
                ...(place.opaqueAttributes ?? []),
                ...((data(s).opaqueItemAttributes ?? []) as string[]),
                ...((data(units.get(file) ?? {}).opaqueItemAttributes ??
                  []) as string[]),
              ],
              shadowableAttributes: [
                ...(place.shadowableAttributes ?? []),
                ...origins(s),
                ...(units.get(file) ? origins(units.get(file)!) : []),
              ],
              attributeGates: [
                ...(place.attributeGates ?? []),
                ...gates(s),
                ...(units.get(file) ? gates(units.get(file)!) : []),
              ],
              uncertain: place.uncertain || moduleIncomplete.has(s.id),
              directory,
            });
        }
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
      conditions: (data(units.get(crate.root) ?? {}).conditions ??
        []) as string[],
      opaqueAttributes: (data(units.get(crate.root) ?? {})
        .opaqueItemAttributes ?? []) as string[],
      shadowableAttributes: units.get(crate.root)
        ? origins(units.get(crate.root)!)
        : [],
      attributeGates: units.get(crate.root)
        ? gates(units.get(crate.root)!)
        : [],
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
  attributeContextReady = true;
  // Do not carry an assumed standard test gate through a file module when its
  // attribute head may instead be a macro binding in the enclosing context.
  for (const place of places) {
    const gs = place.attributeGates ?? [];
    if (!gs.length) continue;
    const removable = new Set(
      gs.filter((g) => !g.explicit).map((g) => g.condition),
    );
    place.conditions = [
      ...new Set([
        ...(place.conditions ?? []).filter((c) => !removable.has(c)),
        ...gs
          .filter((g) => g.explicit || !shadowFromParents(g))
          .map((g) => g.condition),
      ]),
    ];
  }
  if (markPresence)
    for (const symbol of symbols) {
      const attributes = itemPresence(symbol);
      markPresence(symbol, attributes, conditionsFor(symbol));
    }
  if (markConditions)
    for (const link of ctx.links)
      if (contextOf(link)?.implicit.length)
        markConditions(link, conditionsFor(link));
  const failedByScope = new Map<string, string[]>(),
    failedByCrate = new Map<string, string[]>();
  for (const loc of places)
    if (failedFiles.has(loc.file)) {
      const key = `${loc.crate.root}|${loc.scope}`;
      failedByScope.set(
        key,
        [...new Set([...(failedByScope.get(key) ?? []), loc.file])].sort(),
      );
      failedByCrate.set(
        loc.crate.root,
        [
          ...new Set([...(failedByCrate.get(loc.crate.root) ?? []), loc.file]),
        ].sort(),
      );
    }
  const opaqueScopes = new Set<string>();
  const internalFailures = new Set(
    ctx.files
      .filter((f) =>
        f.result.diagnostics.some((d) =>
          d.message.startsWith("Rust parser internal error"),
        ),
      )
      .map((f) => f.path),
  );
  const broken = (files: string[]): Found => {
    const causes = [...new Set(files)]
      .filter((f) => !internalFailures.has(f))
      .sort();
    return {
      symbols: [],
      complete: false,
      reason: causes.length ? "invalid-code" : "parser-internal-error",
      ...(causes.length ? { failedFiles: causes } : {}),
    };
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
  const associatedNames = new Map<string, GraphSymbol[]>();
  for (const s of symbols)
    if (
      members.has(`${s.file}|${str(data(s).scope)}`) &&
      ["const", "type"].includes(s.kind)
    ) {
      associatedNames.set(s.name, [...(associatedNames.get(s.name) ?? []), s]);
    }
  const associatedUnknown = (name: string, ns: Namespace): Found => ({
    symbols: (associatedNames.get(name) ?? []).filter((s) => accepts(s, ns)),
    complete: false,
    reason: "associated-member-lookup-unverified",
  });
  for (const s of symbols) {
    if (members.has(`${s.file}|${str(data(s).scope)}`)) continue;
    for (const loc of ownerPlace(s.file, str(data(s).scope))) {
      if (data(s).macroRules) {
        const exports = (data(s).macroExportConditions ?? []) as string[][];
        if (exports.length) {
          const k = key(loc.crate.root, s.name);
          const residual = exports.map((cs) =>
            cs.filter((c) => !implies(conditionsFor(s), c)),
          );
          const exportCondition = residual.some((cs) => !cs.length)
            ? []
            : [
                residual.length === 1 && residual[0]!.length === 1
                  ? residual[0]![0]!
                  : `any(${residual.map((cs) => `all(${cs.join(",")})`).join(",")})`,
              ];
          const pathConditions = [
            ...(loc.conditions ?? []).filter(
              (c) => !implies(conditionsFor(s), c),
            ),
            ...exportCondition,
          ];
          const exported = {
            ...s,
            data: {
              ...data(s),
              visibility: "pub",
              macroPathCondition:
                pathConditions.length === 1
                  ? pathConditions[0]!
                  : pathConditions.length
                    ? `all(${pathConditions.join(",")})`
                    : "",
            },
          };
          table.set(k, unique([...(table.get(k) ?? []), exported]));
        }
        continue;
      }
      if (data(s).unit && loc.scope) continue;
      const q = data(s).unit
        ? loc.scope
        : [
            qualified(loc, str(data(s).scope)),
            str(data(s).exportedMacroName) || s.name,
          ]
            .filter(Boolean)
            .join("::");
      const k = key(loc.crate.root, q);
      const list = table.get(k) ?? [];
      list.push(s);
      table.set(k, unique(list));
      const aliases = [
        ...((data(s).exportedMacroNames ?? []) as string[]),
        ...(data(s).semanticKind === "macro" ? [s.name] : []),
      ];
      for (const alias of aliases) {
        const aliasKey = key(
          loc.crate.root,
          [qualified(loc, str(data(s).scope)), alias]
            .filter(Boolean)
            .join("::"),
        );
        table.set(aliasKey, unique([...(table.get(aliasKey) ?? []), s]));
      }
    }
  }
  const activeMacroImports: GraphLink[] = [];
  type TextMacro = {
    symbol: GraphSymbol;
    file: string;
    scope: string;
    start: number;
    order: number[];
  };
  const textMacros: TextMacro[] = symbols
    .filter((s) => data(s).macroRules)
    .map((symbol) => ({
      symbol,
      file: symbol.file,
      scope: str(data(symbol).scope),
      start: symbol.range.end,
      order: [symbol.range.end],
    }));
  // macro_use transfers a module's ending textual scope, recursively across
  // captured module files. Source order within that ending scope is retained.
  const modules = symbols.filter((s) => s.kind === "module" && !data(s).unit);
  const directText = [...textMacros];
  function bodyContains(
    m: GraphSymbol,
    e: { file: string; scope: string },
  ): boolean {
    return data(m).inline
      ? e.file === m.file && e.scope === m.identity
      : (moduleTargets.get(m.id) ?? []).some(
          (t) => t.file === e.file && e.scope === "",
        );
  }
  function importedText(m: GraphSymbol, seen = new Set<string>()): TextMacro[] {
    const guards = (data(m).macroUseConditions ?? []) as string[][];
    if (!guards.length || seen.has(m.id)) return [];
    seen = new Set([...seen, m.id]);
    const entries = [
      ...directText.filter((e) => bodyContains(m, e)),
      ...modules
        .filter((child) =>
          bodyContains(m, { file: child.file, scope: str(data(child).scope) }),
        )
        .flatMap((child) => importedText(child, seen)),
    ];
    return entries.map((entry) => ({
      symbol: {
        ...entry.symbol,
        data: {
          ...data(entry.symbol),
          macroPathCondition: `all(${[...conditionsFor(m), str(data(entry.symbol).macroPathCondition) || "all()", `any(${guards.map((cs) => `all(${cs.join(",")})`).join(",")})`].join(",")})`,
        },
      },
      file: m.file,
      scope: str(data(m).scope),
      start: m.range.end,
      order: [m.range.end, ...entry.order],
    }));
  }
  for (const m of modules) textMacros.push(...importedText(m));
  const textMacrosByName = new Map<string, TextMacro[]>();
  for (const entry of textMacros)
    textMacrosByName.set(entry.symbol.name, [
      ...(textMacrosByName.get(entry.symbol.name) ?? []),
      entry,
    ]);
  function textualMacro(
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
  ): Found | null {
    const entries = (textMacrosByName.get(name) ?? [])
      .filter(
        (e) =>
          e.file === site.file &&
          e.start <= site.range.start &&
          (!e.scope || e.scope === scope || scope.startsWith(e.scope + "::")) &&
          possible([...(loc.conditions ?? []), ...conditionsFor(e.symbol)]),
      )
      .sort(
        (a, b) =>
          b.scope.length - a.scope.length ||
          b.start - a.start ||
          a.order.reduce((diff, v, i) => diff || (b.order[i] ?? 0) - v, 0),
      );
    const targets: GraphSymbol[] = [];
    for (const entry of entries) {
      targets.push(entry.symbol);
      if (present(targets, loc)) break;
    }
    return targets.length
      ? conditional({ symbols: unique(targets), complete: true }, targets, loc)
      : null;
  }
  function macroLookup(
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
  ): Found {
    const textual = !name.includes("::")
      ? textualMacro(name, site, loc, scope)
      : null;
    if (textual?.complete) return textual;
    const path = find(name, loc, scope, "macro");
    // Cross-crate/proc-macro expansion paths remain outside this chunk.
    path.symbols = path.symbols.filter(
      (s) =>
        ownerPlace(s.file, str(data(s).scope)).some(
          (p) => p.crate.root === loc.crate.root,
        ) &&
        (s.kind === "macro" || s.file === site.file),
    );
    return textual ? merge([textual, path]) : path;
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
  const importExpansions = new Map<string, number[]>();
  const empty = (complete = true): Found => ({ symbols: [], complete });
  const merge = (xs: Found[]): Found => {
    const causes = xs.flatMap((x) => x.failedFiles ?? []);
    const alternatives = xs.some(
      (x) => !x.failedFiles?.length && (x.symbols.length || !x.complete),
    );
    return causes.length
      ? {
          ...(alternatives
            ? { complete: false, reason: "failed-file-unseen-declarations" }
            : broken(causes)),
          symbols: unique(xs.flatMap((x) => x.symbols)),
          opaqueAttributes: [
            ...new Set(xs.flatMap((x) => x.opaqueAttributes ?? [])),
          ].sort(),
        }
      : {
          symbols: unique(xs.flatMap((x) => x.symbols)),
          complete: xs.every((x) => x.complete),
          reason: [...new Set(xs.map((x) => x.reason).filter(Boolean))].join(
            "; ",
          ),
          opaqueAttributes: [
            ...new Set(xs.flatMap((x) => x.opaqueAttributes ?? [])),
          ].sort(),
        };
  };
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
    variantsOnly = false,
  ): Found {
    if (s.kind !== "module" && !rest.length)
      return { symbols: accepts(s, ns) ? [s] : [], complete: true };
    if (s.kind === "module") {
      const destinations = data(s).unit
        ? [roots.get(s.file)!].filter(Boolean)
        : (modulePlaces.get(s.id) ?? []);
      const failed = destinations
        .filter((p) => failedFiles.has(p.file))
        .map((p) => p.file);
      if (failed.length) return broken(failed);
      if (!rest.length)
        return {
          symbols: accepts(s, ns) ? [s] : [],
          complete: !moduleIncomplete.has(s.id),
        };
      const found = destinations.length
        ? merge(
            destinations.map((dest) =>
              find(
                rest.join("::"),
                {
                  ...dest,
                  conditions: [
                    ...(dest.conditions ?? []),
                    ...(accessFrom?.crate.root === dest.crate.root
                      ? (accessFrom.conditions ?? [])
                      : []),
                  ],
                },
                dest.local,
                ns,
                seen,
                allowGlobs,
                accessFrom,
              ),
            ),
          )
        : empty(false);
      return moduleIncomplete.has(s.id)
        ? {
            ...found,
            complete: false,
            reason: "conditional module path lacks captured alternatives",
          }
        : found;
    }
    if (s.kind === "type" && rest.length) {
      const rhs = str(data(s).aliasType);
      if (
        !rhs ||
        (data(s).generics as string[] | undefined)?.length ||
        !/^(?:::)?[\p{ID_Start}_][\p{ID_Continue}_]*(?:::[\p{ID_Start}_][\p{ID_Continue}_]*)*$/u.test(
          rhs,
        )
      )
        return empty(false);
      return merge(
        ownerPlace(s.file, str(data(s).scope)).map((p) =>
          find(
            [rhs, ...rest].join("::"),
            p,
            str(data(s).scope),
            ns,
            seen,
            allowGlobs,
            accessFrom,
          ),
        ),
      );
    }
    if (variantsOnly && s.kind === "enum" && rest.length !== 1) return empty();
    if (s.kind === "enum" && rest.length === 1) {
      return merge(
        ownerPlace(s.file, str(data(s).scope)).map((loc) => {
          const listed =
            table.get(
              key(
                loc.crate.root,
                [qualified(loc, str(data(s).scope)), s.name, rest[0]]
                  .filter(Boolean)
                  .join("::"),
              ),
            ) ?? [];
          const branch = {
            ...loc,
            conditions: [
              ...(loc.conditions ?? []),
              ...(accessFrom?.crate.root === loc.crate.root
                ? (accessFrom.conditions ?? [])
                : []),
              ...conditionsFor(s),
            ],
          };
          const alternatives = listed.filter((x) =>
            possible([...(branch.conditions ?? []), ...conditionsFor(x)]),
          );
          const ss = alternatives.filter((x) => accepts(x, ns));
          const found = conditional(
            { symbols: ss, complete: true },
            alternatives,
            branch,
          );
          return !variantsOnly && (!listed.length || !found.complete)
            ? merge([found, associatedUnknown(rest[0]!, ns)])
            : found;
        }),
      );
    }
    return rest.length === 1 ? associatedUnknown(rest[0]!, ns) : empty(false);
  }
  function present(items: (GraphSymbol | GraphLink)[], loc: Place): boolean {
    const cs = items
      .filter((s) => !itemPresence(s).length)
      .map((s) =>
        conditionsFor(s).filter((c) => !implies(loc.conditions ?? [], c)),
      );
    return (
      cs.some((c) => !c.length) ||
      cs.some(
        (c) =>
          c.length === 1 &&
          !c[0]!.includes("?") &&
          cs.some(
            (d) =>
              d.length === 1 &&
              (d[0] === `not(${c[0]})` || c[0] === `not(${d[0]})`),
          ),
      )
    );
  }
  function conditional(
    found: Found,
    items: (GraphSymbol | GraphLink)[],
    loc: Place,
  ): Found {
    if (items.some((s) => itemPresence(s).length)) {
      const { failedFiles: possibleFailure, ...rest } = found;
      return {
        ...rest,
        complete: false,
        opaqueAttributes: [
          ...new Set([
            ...(found.opaqueAttributes ?? []),
            ...items.flatMap(itemPresence),
          ]),
        ].sort(),
        reason:
          "item-under-opaque-attribute" +
          (possibleFailure?.length ? "; failed-file-unseen-declarations" : ""),
      };
    }
    return !items.length || present(items, loc)
      ? found
      : { ...found, complete: false, reason: "conditional-name-may-be-absent" };
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
    fallbackOnly = false,
  ): Found | null {
    const headNs: Namespace = rest.length ? "type" : ns;
    const uses = importsByScope.get(`${loc.file}|${local}`);

    const declared = fallbackOnly
      ? []
      : (
          table.get(
            key(loc.crate.root, [q, name].filter(Boolean).join("::")),
          ) ?? []
        ).filter(
          (s) =>
            acceptsAt(
              s,
              headNs,
              name,
              loc.crate.root,
              (accessFrom ?? loc).crate.root,
            ) &&
            possible([...(loc.conditions ?? []), ...conditionsFor(s)]) &&
            (!accessFrom || visible(str(data(s).visibility), loc, accessFrom)),
        );
    // First-segment presence is independent of member-lookup completeness.
    // A present local/explicit binding shadows globs even when its member is
    // unresolved (for example, A::default or an unexpanded imported item).
    const importHeads = new Map<string, { found: Found; cycleFree: boolean }>();
    const withFallback = (
      found: Found,
      bindings: (GraphSymbol | GraphLink)[],
    ): Found => {
      // Declaration bindings are already namespace-filtered. An explicit use
      // needs independent proof about its first segment, not its members or
      // an unknown external namespace. Unknown is not a binding in every ns.
      bindings = bindings.filter((binding) => {
        if (!("targetName" in binding)) return accepts(binding, headNs);
        let parent = 0;
        if (loc.parent) {
          parent = namespaceParents.get(loc.parent) ?? ++nextNamespaceParent;
          namespaceParents.set(loc.parent, parent);
        }
        const proofKey = JSON.stringify([
          parent,
          loc.symbol?.id,
          binding.id,
          loc.crate.root,
          loc.crate.manifest,
          loc.crate.name,
          loc.crate.kind,
          loc.file,
          loc.local,
          loc.scope,
          headNs,
          allowGlobs,
          [
            ...new Set([...(loc.conditions ?? []), ...conditionsFor(binding)]),
          ].sort(),
        ]);
        if (unprovedImports.has(proofKey)) return false;
        const reused = importHeads.get(binding.id);
        const before = cycleCuts;
        const head = reused?.found ?? resolveUse(binding, [], headNs);
        const proven =
          head.complete && head.symbols.some((s) => accepts(s, headNs));
        if (!proven && (reused ? reused.cycleFree : cycleCuts === before))
          unprovedImports.add(proofKey);
        return proven;
      });
      found = conditional(found, bindings, loc);
      const bound = present(bindings, loc);
      if (bound || found.complete || found.failedFiles?.length)
        return { ...found, bound };
      const fallback =
        inScope(
          name,
          rest,
          loc,
          local,
          q,
          ns,
          seen,
          allowGlobs,
          accessFrom,
          true,
        ) ?? empty();
      // This route is only possible while the primary namespace is unproved.
      // Its failed module cannot establish which binding the name actually uses.
      const { failedFiles: possibleFiles, ...possibleFallback } = fallback;
      return {
        ...merge([
          found,
          possibleFiles?.length
            ? {
                ...possibleFallback,
                complete: false,
                reason: "failed-file-unseen-declarations",
              }
            : possibleFallback,
        ]),
        bound: false,
      };
    };
    const explicit = (
      fallbackOnly ? [] : (uses?.explicit.get(name) ?? [])
    ).filter(
      (l) =>
        possible([
          ...(loc.conditions ?? []),
          ...((data(l).conditions ?? []) as string[]),
        ]) &&
        (!accessFrom || visible(str(data(l).visibility), loc, accessFrom)),
    );
    function resolveUse(
      l: GraphLink,
      suffix: string[],
      namespace: Namespace,
    ): Found {
      // A cyclic import can prepend its own path indefinitely, defeating an
      // exact-path guard (quote::quote -> quote::quote::quote -> ...). Only
      // stop expansion: repeated reexports with a shrinking suffix are valid.
      const expansionKey = JSON.stringify([
        l.id,
        namespace,
        loc.crate.root,
        loc.file,
        allowGlobs,
      ]);
      const suffixes = importExpansions.get(expansionKey) ?? [];
      if (suffixes.some((length) => suffix.length > length)) {
        cycleCuts++;
        return { ...empty(false), reason: "import-cycle-unverified" };
      }
      suffixes.push(suffix.length);
      importExpansions.set(expansionKey, suffixes);
      try {
        activeMacroImports.push(l);
        return findUsePath(
          [l.targetName, ...suffix].join("::"),
          {
            ...loc,
            conditions: [...(loc.conditions ?? []), ...conditionsFor(l)],
          },
          str(data(l).scope),
          namespace,
          seen,
          allowGlobs,
          !!data(l).externCrate,
          !l.targetName.includes("::") && data(l).alias === l.targetName,
        );
      } finally {
        activeMacroImports.pop();
        suffixes.pop();
        if (!suffixes.length) importExpansions.delete(expansionKey);
      }
    }

    const imported = (l: GraphLink): Found => {
      const before = cycleCuts;
      const found = resolveUse(l, rest, ns);
      // With no remaining member path this IS the head-namespace lookup.
      // Reuse its exact result, including uncertainty, rather than recursively
      // repeating incomplete reexport chains while proving the same binding.
      if (!rest.length)
        importHeads.set(l.id, { found, cycleFree: cycleCuts === before });
      return found;
    };
    if (declared.length) {
      const direct = merge(
        declared.map((s) =>
          children(s, rest, ns, seen, allowGlobs, accessFrom),
        ),
      );
      if (present(declared, loc) || !explicit.length)
        return withFallback(conditional(direct, declared, loc), declared);
      // Conditional declarations and explicit imports are one binding family.
      // Do not discard import alternatives merely because a local item exists.
      const alternatives = merge(explicit.map(imported));
      return withFallback(
        conditional(
          merge([direct, alternatives]),
          [...declared, ...explicit],
          loc,
        ),
        [...declared, ...explicit],
      );
    }
    if (explicit.length) {
      const result = merge(explicit.map(imported));
      // A type-only import does not mask a value of the same name.
      if (result.symbols.length || !result.complete)
        return withFallback(conditional(result, explicit, loc), explicit);
      // Fall through namespaces only when the import is KNOWN to bind a
      // different namespace. An uncaptured external import could bind this one.
      const all = merge(explicit.map((l) => resolveUse(l, [], "any")));
      if (!all.complete || !all.symbols.length)
        return withFallback(
          {
            ...empty(false),
            reason: "namespace-binding-unverified",
          },
          explicit,
        );
    }
    // Intact local declarations and explicit imports win. A hidden declaration
    // can shadow a glob or an enclosing name, including through a reexport.
    const scopeFailures =
      local === loc.local
        ? (failedByScope.get(`${loc.crate.root}|${q}`) ?? [])
        : [];
    const shadowed =
      scopeFailures.length > 0 ||
      (ns !== "macro" && opaqueScopes.has(`${loc.crate.root}|${q}`));
    const globs = allowGlobs
      ? (uses?.globs ?? []).filter(
          (l) =>
            !accessFrom || visible(str(data(l).visibility), loc, accessFrom),
        )
      : [];
    if (globs.length) {
      // A failed glob has unknown exports. It is never evidence that this
      // particular name traverses the failed file (the prelude may supply it).
      const throughGlob = (found: Found): Found => {
        if (!found.failedFiles?.length) return found;
        const { failedFiles: ignored, ...rest } = found;
        return {
          ...rest,
          complete: false,
          reason: "failed-file-unseen-declarations",
        };
      };
      const suppliers: GraphLink[] = [];
      let result = merge(
        globs.map((l) => {
          const imported = throughGlob(
            resolveUse(
              { ...l, targetName: l.targetName.replace(/::\*$/, "") },
              [],
              "type",
            ),
          );
          if (!imported.symbols.length)
            return imported.reason ? imported : empty(false);
          const found = merge(
            imported.symbols.map((s) =>
              children(
                s,
                [name, ...rest],
                ns,
                seen,
                true,
                accessFrom ?? loc,
                true,
              ),
            ),
          );
          if (found.symbols.length) suppliers.push(l);
          return {
            ...found,
            complete: imported.complete && found.complete,
          };
        }),
      );
      result = conditional(result, suppliers, loc);
      if (result.symbols.length || !result.complete)
        return shadowed && !result.failedFiles?.length
          ? {
              ...result,
              complete: false,
              reason: scopeFailures.length
                ? "failed-file-unseen-declarations"
                : "opaque-item-may-shadow-name",
            }
          : result;
    }
    if (scopeFailures.length)
      return {
        symbols: [],
        complete: false,
        reason: "failed-file-unseen-declarations",
      };
    return shadowed
      ? { symbols: [], complete: false, reason: "opaque-item-may-shadow-name" }
      : null;
  }

  function findUsePath(
    raw: string,
    loc: Place,
    scope: string,
    namespace: Namespace,
    seen = new Set<string>(),
    allowGlobs = true,
    externCrate = false,
    selfBinding = false,
  ): Found {
    const at = activeMacroImports.at(-1);
    if (namespace === "import" && at)
      return merge(
        (["importType", "value", "macro"] as Namespace[]).map((ns) =>
          findUsePath(
            raw,
            loc,
            scope,
            ns,
            seen,
            allowGlobs,
            externCrate,
            selfBinding,
          ),
        ),
      );
    const lookup = (path: string) =>
      find(path, loc, scope, namespace, seen, allowGlobs);
    if (
      namespace === "macro" &&
      !raw.includes("::") &&
      loc.crate.edition !== "2015"
    ) {
      // Modern unqualified macro imports may capture a textual macro already
      // in scope. Qualified imports and edition 2015 use path lookup only.
      const at = activeMacroImports.at(-1);
      if (at) {
        const textual = textualMacro(raw, at, loc, scope);
        if (textual?.complete && loc.crate.edition) return textual;
        if (textual)
          return {
            ...merge([textual, lookup(raw)]),
            ...(loc.crate.edition
              ? {}
              : { complete: false, reason: "edition-unverified" }),
          };
      }
    }
    if (externCrate) return lookup("$extern::" + raw);
    const rooted = () =>
      lookup(
        /^(?:crate|self|super)(?:::|$)/.test(raw)
          ? raw
          : "crate::" + raw.replace(/^::/, ""),
      );
    if (loc.crate.edition === "2015") return rooted();
    if (loc.crate.edition)
      return lookup(
        selfBinding && loc.crate.deps.has(raw.split("::")[0]!)
          ? "::" + raw
          : raw,
      );
    const a = rooted(),
      b = lookup(raw);
    if (
      a.complete &&
      b.complete &&
      a.symbols
        .map((s) => s.id)
        .sort()
        .join() ===
        b.symbols
          .map((s) => s.id)
          .sort()
          .join()
    )
      return a;
    const { failedFiles: ignored, ...both } = merge([a, b]);
    return {
      ...both,
      symbols: unique([...a.symbols, ...b.symbols]),
      complete: false,
      reason: "edition-unverified",
    };
  }
  function dependencyLookup(
    name: string,
    parts: string[],
    loc: Place,
    ns: Namespace,
    seen: Set<string>,
    allowGlobs: boolean,
    accessFrom: Place,
    explicit: boolean,
  ): Found {
    if (loc.crate.edition === "2015" && !explicit) return empty();
    const edges = (loc.crate.dependencies ?? []).filter((e) => e.name === name);
    return merge(
      edges.map((edge) => {
        const targets = packagesByManifest.get(edge.manifest) ?? [];
        let found = merge(
          targets.map((c) => {
            const branch: Found = parts.length
              ? find(
                  parts.join("::"),
                  roots.get(c.root)!,
                  "",
                  ns,
                  seen,
                  allowGlobs,
                  accessFrom,
                )
              : failedFiles.has(c.root)
                ? broken([c.root])
                : {
                    symbols: [units.get(c.root)!].filter(
                      (s) => s && accepts(s, ns),
                    ),
                    complete: true,
                  };
            const unit = units.get(c.root);
            return unit
              ? conditional(branch, [unit], {
                  ...loc,
                  conditions:
                    c.root === loc.crate.root ? (loc.conditions ?? []) : [],
                })
              : branch;
          }),
        );
        const collision =
          ["std", "core", "alloc", "proc_macro", "test", "drop"].includes(
            name,
          ) || /^[A-Z]/.test(name);
        const proven = edges.some(
          (candidate) =>
            candidate.manifest === edge.manifest &&
            candidate.conditions.every((c) => implies(loc.conditions ?? [], c)),
        );
        const unconditional = edges.some(
          (candidate) =>
            candidate.manifest === edge.manifest &&
            !candidate.conditions.length,
        );
        if (
          !proven ||
          (collision &&
            !(
              explicit &&
              unconditional &&
              !["std", "core", "alloc", "proc_macro", "test"].includes(name)
            )) ||
          (!explicit && !loc.crate.edition)
        ) {
          const { failedFiles: ignored, ...rest } = found;
          found = {
            ...rest,
            complete: false,
            reason:
              !loc.crate.edition && !explicit
                ? "edition-unverified"
                : collision
                  ? "dependency-namespace-collision-unverified"
                  : "dependency-presence-unverified",
          };
        }
        return found;
      }),
    );
  }

  function find(
    raw: string,
    loc: Place,
    scope: string,
    ns: Namespace = "any",
    seen = new Set<string>(),
    allowGlobs = true,
    accessFrom: Place = loc,
  ): Found {
    if (loc.conditions?.length)
      loc = { ...loc, conditions: [...new Set(loc.conditions)].sort() };
    if (failedFiles.has(loc.file)) return broken([loc.file]);
    if (ns === "import")
      return merge(
        (["importType", "value", "macro"] as Namespace[]).map((n) =>
          find(raw, loc, scope, n, seen, allowGlobs, accessFrom),
        ),
      );
    const name = base(raw);
    if (name.startsWith("::") && loc.crate.edition === "2015")
      return find(
        "crate::" + name.slice(2),
        loc,
        scope,
        ns,
        seen,
        allowGlobs,
        accessFrom,
      );
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
      loc.conditions,
    ]);
    const cached = memo.get(guard);
    if (cached) return cached;
    if (seen.has(guard)) {
      cycleCuts++;
      return empty(!accessFrom ? false : true);
    }
    if (seen.size > 128) {
      cycleCuts++;
      return empty(false);
    }
    seen = new Set([...seen, guard]);
    const absolute = name.startsWith("::");
    const parts = name.replace(/^::/, "").split("::");
    let first = parts.shift()!;
    const forcedExtern = first === "$extern";
    if (forcedExtern) first = parts.shift() ?? "";
    let result: Found;
    let fallbackShadow = false;
    const conditionalTargets: GraphSymbol[] = [];
    const fallbackReasons: string[] = [];
    const fallbackAttributes: string[] = [];
    if (forcedExtern)
      result = dependencyLookup(
        first,
        parts,
        loc,
        ns,
        seen,
        allowGlobs,
        accessFrom,
        true,
      );
    else if (!absolute && ["crate", "self", "super"].includes(first)) {
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
            {
              ...dest,
              conditions: [
                ...(dest.conditions ?? []),
                ...(loc.conditions ?? []),
              ],
            },
            dest.local,
            ns,
            seen,
            allowGlobs,
            accessFrom,
          )
        : failedFiles.has(dest.file)
          ? broken([dest.file])
          : {
              symbols:
                dest.symbol && accepts(dest.symbol, ns) ? [dest.symbol] : [],
              complete: !!dest.symbol,
            };
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
          if (
            found &&
            !found.complete &&
            !found.bound &&
            !found.failedFiles?.length &&
            local !== loc.local
          ) {
            conditionalTargets.push(...found.symbols);
            fallbackAttributes.push(...(found.opaqueAttributes ?? []));
            fallbackReasons.push(
              found.reason || "namespace-binding-unverified",
            );
            fallbackShadow = true;
            found = null;
          }
          if (found || local === loc.local) break;
          if (!local.startsWith(loc.local) || !local) break;
          local = local.includes("::")
            ? local.slice(0, local.lastIndexOf("::"))
            : "";
        }
      }
      if (found?.bound || found?.complete || found?.failedFiles?.length)
        result = found;
      else {
        const dependencyResult = dependencyLookup(
          first,
          parts,
          loc,
          ns,
          seen,
          allowGlobs,
          accessFrom,
          false,
        );
        // An unproven lexical binding does not erase a captured dependency
        // alternative. Keep its bodies as hints, never upgrade the proof. A
        // failed dependency route is only possible here, not a proved cause.
        const { failedFiles: possibleFailures, ...possibleDependency } =
          dependencyResult;
        result = found
          ? merge([
              found,
              {
                ...possibleDependency,
                ...(possibleFailures?.length
                  ? {
                      complete: false,
                      reason: "failed-file-unseen-declarations",
                    }
                  : {}),
              },
            ])
          : dependencyResult;
      }
    }
    if (absolute && !loc.crate.edition) {
      const rooted = find(
        "crate::" + name.slice(2),
        loc,
        scope,
        ns,
        seen,
        allowGlobs,
        accessFrom,
      );
      const { failedFiles: ignored, ...both } = merge([result, rooted]);
      result = {
        ...both,
        symbols: unique([...result.symbols, ...rooted.symbols]),
        complete: false,
        reason: "edition-unverified",
      };
    }
    if (fallbackShadow) {
      // A possible inner binding defeats an outer failure as a CAUSE too.
      // Retain every captured alternative, but the failed route is unproved.
      const { failedFiles: possibleOuterFailure, ...outer } = result;
      result = {
        ...outer,
        symbols: unique([...conditionalTargets, ...result.symbols]),
        opaqueAttributes: [
          ...new Set([
            ...fallbackAttributes,
            ...(result.opaqueAttributes ?? []),
          ]),
        ].sort(),
        complete: false,
        reason: [
          ...new Set(
            [
              ...fallbackReasons,
              possibleOuterFailure?.length
                ? "failed-file-unseen-declarations"
                : result.reason,
            ].filter(Boolean),
          ),
        ].join("; "),
      };
    }
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
  type Method = {
    symbol: GraphSymbol;
    conditions: string[];
    inherent: boolean;
    implType: string;
    generics: string[];
    uncertain: boolean;
    implKey: string;
    ownerRoot: string;
    declarationPlace: Place;
    argumentPlace: Place;
    argumentScope: string;
    argumentSyntax: string;
    universal: boolean;
    bounded: boolean;
  };
  const methodIndex = new Map<string, Method[]>();
  const reachableCache = new Map<string, Set<string>>();
  function reachable(root: string, definite = false): Set<string> {
    const cacheKey = root + "|" + definite;
    const cached = reachableCache.get(cacheKey);
    if (cached) return cached;
    const result = new Set<string>(),
      pending = [root];
    while (pending.length) {
      const next = pending.pop()!;
      if (result.has(next)) continue;
      result.add(next);
      for (const edge of roots.get(next)?.crate.dependencies ?? [])
        if (!definite || edge.conditions.every((c) => implies([], c)))
          for (const dep of packagesByManifest.get(edge.manifest) ?? [])
            pending.push(dep.root);
    }
    reachableCache.set(cacheKey, result);
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
    if (aliases.length !== 1 || target.symbols.length !== 1 || !target.complete)
      return { text, loc, scope, unknown: true };
    const a = aliases[0]!,
      rhs = str(data(a).aliasType),
      key = a.id;
    if (!rhs || seen.has(key) || seen.size > 32)
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

  const standardDerives = new Set([
    "Clone",
    "Copy",
    "Debug",
    "Default",
    "Eq",
    "PartialEq",
    "Ord",
    "PartialOrd",
    "Hash",
  ]);
  const macroUseCrates = new Set<string>();
  for (const f of ctx.files)
    if (
      ((data(f.result).opaqueAttributes ?? []) as { name: string }[]).some(
        (e) => e.name === "macro_use",
      )
    )
      for (const loc of ownerPlace(f.path, ""))
        macroUseCrates.add(loc.crate.root);
  function opaqueAttribute(
    raw: string,
    loc: Place,
    scope: string,
    conditions: string[] = [],
  ): boolean {
    if (!possible(conditions)) return false;
    const a = raw.replace(/^#!?\[|\]$/g, "").trim(),
      name = a.match(/^[\w:]+/)?.[0] ?? "";
    let shadow = false;
    const rule = attributeRules.get(name.split("::")[0]!);
    if (rule && rule.category !== "builtin") {
      let local = scope;
      while (true) {
        const b = attributeBindings.get(loc.file + "|" + local);
        if (
          b &&
          attributeBindingShadows(
            name,
            b.names.includes(name.split("::")[0]!) ||
              readableMacroUseBinds(
                name,
                loc.file,
                local,
                b.macroUseImports ?? [],
              ),
            b.unknown || (rule.category === "prelude" && !!b.macroUse),
          )
        )
          shadow = true;
        if (!local || local === loc.local) break;
        local = local.includes("::")
          ? local.slice(0, local.lastIndexOf("::"))
          : "";
      }
      shadow ||= shadowFromParents({ file: loc.file, scope, name });
    }
    if (!knownAttributeName(name, shadow)) return true;
    if (name !== "derive") return false;
    const names = a
      .slice(a.indexOf("(") + 1, a.lastIndexOf(")"))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      macroUseCrates.has(loc.crate.root) ||
      names.some((n) => !standardDerives.has(n))
    )
      return true;
    let local = scope;
    while (true) {
      const uses = importsByScope.get(`${loc.file}|${local}`);
      if (uses?.globs.length || names.some((n) => uses?.explicit.has(n)))
        return true;
      if (local === loc.local || !local) break;
      local = local.includes("::")
        ? local.slice(0, local.lastIndexOf("::"))
        : "";
    }
    return false;
  }
  for (const f of ctx.files)
    for (const loc of ownerPlace(f.path, "")) {
      for (const scope of (data(f.result).opaqueItemScopes ?? []) as string[])
        opaqueScopes.add(`${loc.crate.root}|${qualified(loc, scope)}`);
      for (const e of (data(f.result).opaqueAttributes ?? []) as {
        scope: string;
        raw: string;
        module: string;
        conditions?: string[];
      }[])
        if (opaqueAttribute(e.raw, loc, e.scope, e.conditions ?? [])) {
          const q = qualified(loc, e.scope);
          opaqueScopes.add(`${loc.crate.root}|${q}`);
          if (e.module)
            opaqueScopes.add(
              `${loc.crate.root}|${[q, e.module].filter(Boolean).join("::")}`,
            );
        }
    }
  // Only captured dependency edges prove reach. Unknown edges never accuse a
  // failed file in an unrelated crate; they cannot justify invalid-code.
  const dependencyGraphKnown = packages.every(
    (c) => c.dependencyGraphKnown !== false,
  );
  const failureCache = new Map<string, string[]>();
  function relevantFailures(root: string): string[] {
    let fs = failureCache.get(root);
    if (!fs) {
      fs = [
        ...new Set(
          [...reachable(root, true)].flatMap((r) => failedByCrate.get(r) ?? []),
        ),
      ].sort();
      failureCache.set(root, fs);
    }
    return fs;
  }
  const scopedMembers = (s: GraphSymbol) => membersByOwner.get(s.id) ?? [];
  const unknownImpls = new Map<string, GraphSymbol[]>(),
    unknownInherent = new Set<string>();
  const memberOwners = new Map<string, GraphSymbol>();
  const allMembers = new Map<string, GraphSymbol[]>();
  const defaultMembers = new Map<string, GraphSymbol[]>();
  const unknownTraitRoots = new Set<string>();
  for (const owner of symbols.filter((s) => ["impl", "trait"].includes(s.kind)))
    for (const m of scopedMembers(owner)) {
      memberOwners.set(m.id, owner);
      if (owner.kind === "trait" && !data(m).defaultBody) continue;
      if (owner.kind === "trait")
        defaultMembers.set(
          m.name,
          unique([...(defaultMembers.get(m.name) ?? []), m]),
        );
      allMembers.set(m.name, unique([...(allMembers.get(m.name) ?? []), m]));
    }
  function would(
    root: string,
    name: string,
    instance = false,
    defaultsOnly = false,
  ): GraphSymbol[] {
    // Unverified means name-based project hints, not a simulated dispatch set.
    // Include all valid bodies: autoderef and unknown impl ownership cannot
    // justify dropping a would-be project target.
    return (
      (defaultsOnly ? defaultMembers : allMembers).get(name) ?? []
    ).filter((m) => !instance || data(m).receiverKind !== "none");
  }

  function unknownTraits(root: string): boolean {
    return (
      unknownTraitRoots.has("*") ||
      (!dependencyGraphKnown && unknownTraitRoots.size > 0) ||
      [...reachable(root)].some((r) => unknownTraitRoots.has(r))
    );
  }
  function retainUnknown(
    root: string,
    ms: GraphSymbol[],
    inherent: boolean,
  ): void {
    unknownImpls.set(root, unique([...(unknownImpls.get(root) ?? []), ...ms]));
    if (inherent) for (const m of ms) unknownInherent.add(m.id);
  }
  for (const impl of symbols.filter((s) => s.kind === "impl"))
    if (!ownerPlace(impl.file, str(data(impl).scope)).length) {
      retainUnknown("*", scopedMembers(impl), !data(impl).trait);
      if (data(impl).trait) unknownTraitRoots.add("*");
    }
  for (const impl of symbols.filter((s) => s.kind === "impl"))
    for (const loc of ownerPlace(impl.file, str(data(impl).scope))) {
      const implType = str(data(impl).implType),
        generics = (data(impl).generics ?? []) as string[];
      const trait = data(impl).trait
        ? find(str(data(impl).trait), loc, str(data(impl).scope), "type")
        : { symbols: [], complete: true };
      if (data(impl).trait && (!trait.complete || !trait.symbols.length))
        unknownTraitRoots.add(loc.crate.root);
      const overrides = scopedMembers(impl),
        defaults = trait.symbols
          .filter((t) => t.kind === "trait")
          .flatMap(scopedMembers)
          .filter(
            (m) =>
              data(m).defaultBody &&
              !overrides.some(
                (o) =>
                  o.name === m.name &&
                  !((data(o).conditions ?? []) as string[]).length,
              ),
          );
      const methods = unique([...overrides, ...defaults]);
      const ex = expandType(
        implType,
        loc,
        str(data(impl).scope),
        new Set(),
        new Set(generics),
      );
      const targetName = ex.text.replace(/^&\s*(?:'\w+\s*)?(?:mut\s+)?/, "");
      const targets = find(targetName, ex.loc, ex.scope, "type");
      const uncertain =
        ex.unknown ||
        !targets.complete ||
        !targets.symbols.length ||
        (!!data(impl).trait && (!trait.complete || !trait.symbols.length));
      if (uncertain || ex.externalShape)
        retainUnknown(loc.crate.root, methods, !data(impl).trait);
      for (const t of targets.symbols.filter((t) =>
        ["struct", "enum", "type"].includes(t.kind),
      ))
        for (const m of methods) {
          const k = `${t.id}|${m.name}`;
          const list = methodIndex.get(k) ?? [];
          const ps = generics.filter((g) => !g.startsWith("'")),
            raw = withoutLifetimes(ex.text),
            args = raw.includes("<")
              ? splitArguments(raw.slice(raw.indexOf("<")))
              : null;
          const conditions = [
            ...new Set([
              ...(loc.conditions ?? []),
              ...((data(impl).conditions ?? []) as string[]),
              ...((data(m).conditions ?? []) as string[]),
            ]),
          ];
          list.push({
            symbol: m,
            conditions,
            inherent: !data(impl).trait,
            implType: ex.text,
            generics,
            uncertain: uncertain || !!loc.uncertain,
            universal:
              !!args &&
              args.length === ps.length &&
              new Set(args.map(compact)).size === ps.length &&
              args.every((a, i) => compact(a) === ps[i]),
            bounded: data(impl).bounded === true,
            implKey: `${impl.file}|${impl.key}`,
            ownerRoot: loc.crate.root,
            declarationPlace: loc,
            argumentPlace: ex.loc,
            argumentScope: ex.scope,
            argumentSyntax:
              ex.text === implType ? str(data(impl).argumentSyntax) : "",
          });
          methodIndex.set(k, list);
        }
    }
  const unknownCache = new Map<string, Map<string, GraphSymbol[]>>();
  function unknownMethods(root: string, name: string): GraphSymbol[] {
    const key = dependencyGraphKnown ? root : "*";
    let index = unknownCache.get(key);
    if (!index) {
      index = new Map();
      for (const r of dependencyGraphKnown
        ? new Set(["*", ...reachable(root)])
        : unknownImpls.keys())
        for (const m of unknownImpls.get(r) ?? [])
          index.set(m.name, unique([...(index.get(m.name) ?? []), m]));
      unknownCache.set(key, index);
    }
    return index.get(name) ?? [];
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
    if (instance && !typeName.trim())
      return {
        symbols: would(loc.crate.root, name, true),
        complete: false,
        reason:
          "receiver-type-unverified" +
          (relevantFailures(loc.crate.root).length
            ? "; failed-file-unseen-declarations"
            : ""),
      };
    const ex = expandType(
      typeName,
      loc,
      scope,
      new Set(),
      new Set(callerGenerics.split(",")),
    );
    let type = find(ex.text, ex.loc, ex.scope, "type");
    if (/^&/.test(ex.text)) {
      borrow = /^&\s*(?:'\w+\s*)?mut\b/.test(ex.text) ? "mutable" : "shared";
      typeName = ex.text.replace(/^&\s*(?:'\w+\s*)?(?:mut\s+)?/, "");
      type = find(typeName, ex.loc, ex.scope, "type");
    } else typeName = ex.text;
    if (
      type.complete &&
      type.symbols.length &&
      type.symbols.every((t) => t.kind === "module")
    )
      return empty();
    const failures = relevantFailures(loc.crate.root);
    const note = (reason: string) =>
      reason + (failures.length ? "; failed-file-unseen-declarations" : "");
    if (type.failedFiles?.length)
      return instance
        ? {
            symbols: would(loc.crate.root, name, instance),
            complete: false,
            reason: note(
              ["receiver-type-unverified", type.reason]
                .filter(Boolean)
                .join("; "),
            ),
          }
        : type;
    if (
      ex.externalShape ||
      ex.unknown ||
      !type.complete ||
      !type.symbols.length ||
      type.symbols.some((t) => t.kind === "trait" || t.kind === "type")
    )
      return {
        symbols: would(loc.crate.root, name, instance),
        complete: false,
        opaqueAttributes: type.opaqueAttributes ?? [],
        reason: note(
          !instance &&
            type.reason?.split(/;\s*/).includes("parser-internal-error")
            ? type.reason
            : [
                instance ? "receiver-type-unverified" : "path-type-unverified",
                type.reason,
              ]
                .filter(Boolean)
                .join("; "),
        ),
      };
    const applicable = (m: Method): "yes" | "no" | "unknown" => {
      if (instance) {
        const receiverConditions = (data(m.symbol).receiverConditions ??
          []) as string[];
        const caller =
          m.ownerRoot === loc.crate.root ? (loc.conditions ?? []) : [];
        if (!possible([...caller, ...receiverConditions])) return "no";
        if (receiverConditions.some((c) => !implies(caller, c)))
          return "unknown";
      }
      return data(m.symbol).methodBounded
        ? "unknown"
        : m.implKey === sameImpl ||
            (m.universal && !m.bounded) ||
            (m.universal &&
              !instance &&
              !withoutLifetimes(typeName).includes("<"))
          ? "yes"
          : m.bounded
            ? "unknown"
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
    };
    const matches = type.symbols
      .flatMap((t) => methodIndex.get(`${t.id}|${name}`) ?? [])
      .filter((m) => {
        if (
          !reachable(loc.crate.root).has(m.ownerRoot) ||
          applicable(m) === "no" ||
          !possible([
            ...(m.ownerRoot === loc.crate.root ? (loc.conditions ?? []) : []),
            ...m.conditions,
          ]) ||
          (m.inherent &&
            !visible(str(data(m.symbol).visibility), m.declarationPlace, loc))
        )
          return false;
        if (
          typeof data(m.symbol).arity === "number" &&
          (Number(data(m.symbol).arity) <
            argumentMinimum + (instance ? 1 : 0) ||
            Number(data(m.symbol).arityMinimum ?? data(m.symbol).arity) >
              argumentCount + (instance ? 1 : 0))
        )
          return false;
        if (!instance) return true;
        const receiver = compact(str(data(m.symbol).receiverKind));
        if (!receiver || receiver === "none") return false;
        if (borrow === "unknown" || receiver === "unknown") return true;
        if (
          receiver.includes("&mut") &&
          (borrow === "shared" || (borrow === "owned" && !mutable))
        )
          return false;
        return receiver.includes("&") || borrow === "owned";
      });
    const unknown = unknownMethods(loc.crate.root, name).filter(
        (m) => !instance || data(m).receiverKind !== "none",
      ),
      targets = unique([...matches.map((m) => m.symbol), ...unknown]);
    const accessibleHint = (m: GraphSymbol) => {
      const owner = memberOwners.get(m.id);
      return (
        owner?.kind !== "impl" ||
        !!data(owner).trait ||
        ownerPlace(m.file, str(data(m).scope)).some((p) =>
          visible(str(data(m).visibility), p, loc),
        )
      );
    };
    const unverified = (reason: string): Found => ({
      symbols: instance
        ? unique([...targets, ...would(loc.crate.root, name, true)]).filter(
            (m) => data(m).receiverKind !== "none" && accessibleHint(m),
          )
        : unique([
            ...targets,
            ...(unknownTraits(loc.crate.root) || failures.length
              ? would(loc.crate.root, name, false, true)
              : []),
          ]).filter(accessibleHint),
      complete: false,
      opaqueAttributes: [
        ...new Set(matches.flatMap((m) => itemPresence(m.symbol))),
      ].sort(),
      reason: note(
        matches.some((m) => itemPresence(m.symbol).length)
          ? "item-under-opaque-attribute"
          : reason,
      ),
    });
    const inherent = matches.filter(
      (m) =>
        m.inherent &&
        visible(str(data(m.symbol).visibility), m.declarationPlace, loc),
    );
    const proven = inherent.filter(
      (m) =>
        !m.uncertain &&
        !itemPresence(m.symbol).length &&
        applicable(m) === "yes",
    );
    const form = (m: Method) => {
      const s = compact(
        str(data(m.symbol).receiverKind).replace(/'\w+\s*/g, ""),
      );
      return s.startsWith("&mut")
        ? "mutable"
        : s.startsWith("&")
          ? "shared"
          : ["self", "mutself"].includes(s)
            ? "owned"
            : "unknown";
    };
    const unknownInherentExists = unknown.some((m) =>
      unknownInherent.has(m.id),
    );
    const conditions = (m: Method) =>
      m.conditions.filter(
        (c) =>
          m.ownerRoot !== loc.crate.root || !implies(loc.conditions ?? [], c),
      );
    const firstStep =
      instance &&
      ["owned", "shared", "mutable"].includes(borrow) &&
      proven.length === inherent.length &&
      proven.length > 0 &&
      type.symbols.every(
        (t) =>
          ownerPlace(t.file, str(data(t).scope)).length === 1 ||
          proven.every(
            (m) => m.implKey === sameImpl || m.symbol.file === t.file,
          ),
      ) &&
      type.symbols.every((t) =>
        (methodIndex.get(`${t.id}|${name}`) ?? []).some((m) =>
          proven.includes(m),
        ),
      ) &&
      !unknownInherentExists &&
      proven.every((m) => form(m) === borrow && !conditions(m).length);
    if (instance) {
      if (firstStep && unique(proven.map((m) => m.symbol)).length === 1)
        return { symbols: unique(proven.map((m) => m.symbol)), complete: true };
      if (borrow === "unknown" || inherent.some((m) => form(m) === "unknown"))
        return unverified("receiver-type-unverified");
      return unverified(
        inherent.length
          ? proven.length !== inherent.length ||
            unknownInherentExists ||
            inherent.some((m) => conditions(m).length || form(m) === borrow)
            ? "inherent-applicability-unverified"
            : "later-probe-step"
          : matches.length
            ? "trait-dispatch"
            : "receiver-type-unverified",
      );
    }
    const covered =
      inherent.some((m) => !conditions(m).length) ||
      inherent.some(
        (m) =>
          conditions(m).length === 1 &&
          !conditions(m)[0]!.includes("?") &&
          inherent.some(
            (n) =>
              conditions(n).length === 1 &&
              (conditions(n)[0] === `not(${conditions(m)[0]})` ||
                conditions(m)[0] === `not(${conditions(n)[0]})`),
          ),
      );
    const pathInherent =
      inherent.length > 0 &&
      type.symbols.every((t) =>
        (methodIndex.get(`${t.id}|${name}`) ?? []).some((m) =>
          inherent.includes(m),
        ),
      ) &&
      covered &&
      !unknownInherentExists &&
      inherent.every((m) => !m.uncertain) &&
      inherent.every((m) => !itemPresence(m.symbol).length) &&
      ((inherent.length === 1 && !withoutLifetimes(typeName).includes("<")) ||
        inherent.every((m) => applicable(m) === "yes"));
    if (pathInherent)
      return { symbols: unique(inherent.map((m) => m.symbol)), complete: true };
    return unverified(
      inherent.length ? "inherent-applicability-unverified" : "trait-dispatch",
    );
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
      const failed = (s ? (modulePlaces.get(s.id) ?? []) : [])
        .filter((p) => failedFiles.has(p.file))
        .map((p) => p.file);
      found = failed.length
        ? broken(failed)
        : {
            symbols: s ? (moduleTargets.get(s.id) ?? []) : [],
            complete: !s || !moduleIncomplete.has(s.id),
          };
    } else if (d.namespaceUnknown) {
      found = { ...empty(false), reason: "namespace-position-unverified" };
    } else if (
      (!d.blocked || !!d.method || !!d.conditionalBinding) &&
      !(l.kind === "imports" && d.glob)
    ) {
      found = merge(
        ownerPlace(l.file, str(d.scope)).map((place) => {
          const loc = {
            ...place,
            conditions: [
              ...(place.conditions ?? []),
              ...((d.conditions ?? []) as string[]),
            ],
          };
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
                ? d.structPattern
                  ? "importType"
                  : "value"
                : l.kind === "types" && d.structLiteral
                  ? "importType"
                  : ["types", "implements"].includes(l.kind)
                    ? "type"
                    : "import";
          let result =
            l.kind === "imports"
              ? (() => {
                  activeMacroImports.push(l);
                  try {
                    return findUsePath(
                      name,
                      loc,
                      scope,
                      ns,
                      new Set(),
                      true,
                      !!d.externCrate,
                      !name.includes("::") && d.alias === name,
                    );
                  } finally {
                    activeMacroImports.pop();
                  }
                })()
              : l.kind === "macros"
                ? macroLookup(name, l, loc, scope)
                : find(name, loc, scope, ns);
          const callableFound = result.symbols.some((s) =>
            ["function", "method", "struct", "variant"].includes(s.kind),
          );
          if (
            l.kind === "calls" &&
            (!callableFound || !result.complete) &&
            !result.failedFiles?.length &&
            name.includes("::")
          ) {
            const pathSyntax = selfPath
              ? name
              : (str(d.pathSyntax) || l.targetName).replace(/\br#/g, "");
            const split = pathSyntax.lastIndexOf("::");
            const associated = methods(
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
            result = callableFound ? merge([result, associated]) : associated;
          }
          if (l.kind === "patterns")
            result = {
              ...result,
              symbols: result.symbols.filter((s) =>
                ["variant", "struct", "type", "const", "static"].includes(
                  s.kind,
                ),
              ),
            };
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
    if (["imports", "modules"].includes(l.kind) && itemPresence(l).length) {
      const { failedFiles: ignored, ...rest } = found;
      found = {
        ...rest,
        complete: false,
        reason: "item-under-opaque-attribute",
        opaqueAttributes: itemPresence(l),
      };
    }
    if (
      l.kind !== "contains" &&
      found.complete &&
      found.symbols.some((s) => itemPresence(s).length)
    )
      found = {
        ...found,
        complete: false,
        reason: "item-under-opaque-attribute",
        opaqueAttributes: [
          ...new Set(found.symbols.flatMap(itemPresence)),
        ].sort(),
      };
    if (
      l.kind !== "contains" &&
      ((d.conditions ?? []) as string[]).some((c) => c.includes("?"))
    )
      found = { ...found, complete: false, reason: "cfg-condition-unverified" };
    if (d.conditionalBinding) {
      const { failedFiles: possibleFiles, ...binding } = found;
      found = {
        ...binding,
        complete: false,
        reason: "conditional-binding-may-shadow-name",
      };
    }
    if (
      !found.symbols.length &&
      !found.failedFiles?.length &&
      ownerPlace(l.file, str(d.scope)).some(
        (loc) => relevantFailures(loc.crate.root).length,
      )
    ) {
      found = {
        ...found,
        complete: false,
        reason: [
          ...new Set(
            [
              ...(found.reason?.split(/;\s*/) ?? []),
              "failed-file-unseen-declarations",
            ].filter(Boolean),
          ),
        ].join("; "),
      };
    }
    if (found.failedFiles?.length) {
      uncertain?.(l, [], "invalid-code", found.failedFiles);
      continue;
    }
    if (!found.complete) {
      uncertain?.(
        l,
        unique(found.symbols),
        found.reason || "namespace/import/alias structure is unknown",
        undefined,
        found.opaqueAttributes,
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
    if (d.method && targets.length > 1) {
      uncertain?.(l, targets, "receiver-type-unverified");
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
