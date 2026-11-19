// SPDX-License-Identifier: MIT
import { implies as cfgImplies, possible as cfgPossible } from "./cfg.js";
import {
  auditedMacro,
  ecosystemMacros,
  compatibleRelease,
  compatibleRequirement,
} from "./macro-catalog.js";
import {
  scopeNeutralStandardMacros,
  standardMacroName,
  knownAttributeName,
  attributeRules,
  attributeBindingShadows,
  type MacroUseImport,
} from "./parse.js";
import {
  consumingBuiltins,
  formatStandardMacros,
  standardFormatName,
  type MacroProfile,
} from "./macro-rules.js";
import { posix as p } from "node:path";
import type {
  AddedLink,
  GraphSymbol,
  GraphLink,
  Json,
  LinkResolution,
  ParseResult,
  ResolutionContext,
} from "../../types.js";
import { crates, type Crate } from "./cargo.js";
import {
  LookupMemo,
  LookupTrace,
  lookupDepth,
  type ImportExpansion,
} from "./lookup-memo.js";
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
/** `std::fmt::Display<X>` → `Display`. */
const lastSegment = (s: string) =>
  compact(s)
    .replace(/<[\s\S]*$/, "")
    .split("::")
    .at(-1)!;
/**
 * C-10: method names of the standard prelude traits (all editions), split by
 * whether a candidate can precede an autoref'd `&self` inherent method (by
 * value) or only a `&mut self` one (by `&self`). A trait in this table counts
 * for a type only when the type implements it in the checkout or derives it;
 * the blanket entries apply to every type. Lists are deliberately broad:
 * a `&mut self` method listed as by-value only blocks more links.
 */
const iteratorMethods =
  "next next_chunk size_hint count last advance_by nth step_by chain zip intersperse intersperse_with map for_each filter filter_map enumerate peekable skip_while take_while map_while skip take scan flat_map flatten map_windows fuse inspect by_ref collect try_collect collect_into partition partition_in_place is_partitioned try_fold try_for_each fold reduce try_reduce all any find find_map try_find position rposition max min max_by_key max_by min_by_key min_by rev unzip copied cloned cycle array_chunks sum product cmp cmp_by partial_cmp partial_cmp_by eq eq_by ne lt le gt ge is_sorted is_sorted_by is_sorted_by_key next_back advance_back_by nth_back try_rfold rfold rfind into_iter";
const preludeTraitMethods: Record<string, { value: string; ref: string }> = {
  Clone: { value: "", ref: "clone clone_from" },
  Copy: { value: "", ref: "" },
  PartialEq: { value: "", ref: "eq ne" },
  Eq: {
    value: "",
    ref: "eq ne assert_receiver_is_total_eq assert_fields_are_eq",
  },
  PartialOrd: {
    value: "",
    ref: "partial_cmp lt le gt ge __chaining_lt __chaining_le __chaining_gt __chaining_ge",
  },
  Ord: {
    value: "max min clamp",
    ref: "cmp partial_cmp lt le gt ge __chaining_lt __chaining_le __chaining_gt __chaining_ge",
  },
  Default: { value: "", ref: "" },
  Drop: { value: "", ref: "drop" },
  AsRef: { value: "", ref: "as_ref" },
  AsMut: { value: "", ref: "as_mut" },
  Iterator: {
    value: iteratorMethods + " __iterator_get_unchecked",
    ref: "size_hint len is_empty",
  },
  DoubleEndedIterator: { value: iteratorMethods, ref: "" },
  ExactSizeIterator: { value: iteratorMethods, ref: "len is_empty" },
  IntoIterator: { value: "into_iter", ref: "" },
  Extend: { value: "", ref: "extend extend_one extend_reserve" },
  Future: { value: "into_future poll", ref: "poll" },
  IntoFuture: { value: "into_future", ref: "" },
  Fn: { value: "call call_mut call_once", ref: "call" },
  FnMut: { value: "call_mut call_once", ref: "call_mut" },
  FnOnce: { value: "call_once", ref: "" },
};
/** Non-prelude standard traits whose complete method sets are known. */
const standardTraitMethods: Record<string, { value: string; ref: string }> = {
  Hash: { value: "", ref: "hash" },
  Debug: { value: "", ref: "fmt" },
  Display: { value: "", ref: "fmt to_string" },
  Error: { value: "", ref: "source description cause provide" },
  Deref: { value: "", ref: "deref" },
  DerefMut: { value: "", ref: "deref_mut" },
  Borrow: { value: "", ref: "borrow" },
  BorrowMut: { value: "", ref: "borrow_mut" },
  Any: { value: "", ref: "type_id" },
  FromStr: { value: "", ref: "" },
  From: { value: "", ref: "" },
  TryFrom: { value: "", ref: "" },
  Into: { value: "into", ref: "" },
  TryInto: { value: "try_into", ref: "" },
  ToString: { value: "", ref: "to_string" },
  ToOwned: { value: "", ref: "to_owned clone_into" },
  Send: { value: "", ref: "" },
  Sync: { value: "", ref: "" },
  Unpin: { value: "", ref: "" },
  Sized: { value: "", ref: "" },
  Index: { value: "", ref: "index" },
  IndexMut: { value: "", ref: "index_mut" },
  Add: { value: "add", ref: "" },
  Sub: { value: "sub", ref: "" },
  Mul: { value: "mul", ref: "" },
  Div: { value: "div", ref: "" },
  Rem: { value: "rem", ref: "" },
  Neg: { value: "neg", ref: "" },
  Not: { value: "not", ref: "" },
  BitAnd: { value: "bitand", ref: "" },
  BitOr: { value: "bitor", ref: "" },
  BitXor: { value: "bitxor", ref: "" },
  Shl: { value: "shl", ref: "" },
  Shr: { value: "shr", ref: "" },
  // `&mut self` methods never precede an autoref'd inherent method.
  AddAssign: { value: "", ref: "" },
  SubAssign: { value: "", ref: "" },
  MulAssign: { value: "", ref: "" },
  DivAssign: { value: "", ref: "" },
  RemAssign: { value: "", ref: "" },
  BitAndAssign: { value: "", ref: "" },
  BitOrAssign: { value: "", ref: "" },
  BitXorAssign: { value: "", ref: "" },
  ShlAssign: { value: "", ref: "" },
  ShrAssign: { value: "", ref: "" },
  FromIterator: { value: "", ref: "" },
  Sum: { value: "", ref: "" },
  Product: { value: "", ref: "" },
  Binary: { value: "", ref: "fmt" },
  Octal: { value: "", ref: "fmt" },
  LowerHex: { value: "", ref: "fmt" },
  UpperHex: { value: "", ref: "fmt" },
  LowerExp: { value: "", ref: "fmt" },
  UpperExp: { value: "", ref: "fmt" },
  Pointer: { value: "", ref: "fmt" },
  Termination: { value: "report", ref: "" },
  UnwindSafe: { value: "", ref: "" },
  RefUnwindSafe: { value: "", ref: "" },
};
const blanketValueMethods = new Set(["into", "try_into"]);
const blanketRefMethods = new Set([
  "to_owned",
  "clone_into",
  "to_string",
  "borrow",
  "borrow_mut",
  "type_id",
]);
/** Attributes that cannot add a trait impl to the item they annotate. */
const inertItemAttributes = new Set([
  "derive",
  "cfg",
  "cfg_attr",
  "doc",
  "allow",
  "warn",
  "deny",
  "forbid",
  "expect",
  "must_use",
  "repr",
  "non_exhaustive",
  "deprecated",
  "automatically_derived",
  "rustfmt",
  "clippy",
  "serde",
  "default",
]);
type Namespace = "type" | "value" | "macro" | "any" | "import" | "importType";
type AttributeOrigin = {
  name: string;
  scope: string;
  file: string;
  helper?: true;
  nested?: boolean;
};
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
  noImplicitPrelude?: boolean;
  directoryUnverified?: boolean;
}
interface Found {
  symbols: GraphSymbol[];
  complete: boolean;
  reason?: string;
  failedFiles?: string[];
  bound?: boolean;
  opaqueAttributes?: string[];
  // Captured import spellings survive even when their target/namespace cannot
  // be resolved. These are shadowing evidence, never semantic target proofs.
  possibleImportNames?: string[];
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
  ctx: Pick<ResolutionContext, "projectId" | "symbols" | "links"> & {
    contextFiles: Parameters<typeof crates>[0];
    files: readonly {
      path: string;
      module: string;
      result: Pick<ParseResult, "status" | "diagnostics" | "data">;
    }[];
  },
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
  /** Derived links (R1-K: calls written in macro bodies, at each invocation). */
  derived?: (link: AddedLink) => void,
  /** C-10: analysis notes merged into a link's data (receiver typing). */
  annotate?: (link: GraphLink, extra: Record<string, Json>) => void,
): LinkResolution[] {
  // Cache only unproved import namespaces, never targets or positive proofs.
  // Facts are immutable for this run; caller conditions and placement are in
  // the key. A failed proof keeps alternatives, it never asserts a binding.
  const unprovedImports = new Set<string>();
  let cycleCuts = 0;
  const namespaceParents = new WeakMap<Place, number>();
  let nextNamespaceParent = 0;
  function parentIdentity(loc: Place): number {
    if (!loc.parent) return 0;
    const id = namespaceParents.get(loc.parent) ?? ++nextNamespaceParent;
    namespaceParents.set(loc.parent, id);
    return id;
  }
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
      helperUnknown?: boolean;
      macroUse?: boolean;
      macroUseImports?: MacroUseImport[];
    }
  >();
  for (const file of ctx.files)
    for (const b of (data(file.result).attributeBindings ?? []) as {
      scope: string;
      names: string[];
      unknown: boolean;
      helperUnknown?: boolean;
      macroUse?: boolean;
      macroUseImports?: MacroUseImport[];
    }[]) {
      const key = file.path + "|" + b.scope,
        old = attributeBindings.get(key);
      attributeBindings.set(key, {
        names: [...new Set([...(old?.names ?? []), ...b.names])],
        unknown: !!old?.unknown || b.unknown,
        helperUnknown: !!old?.helperUnknown || !!b.helperUnknown,
        macroUse: !!old?.macroUse || !!b.macroUse,
        macroUseImports: [
          ...(old?.macroUseImports ?? []),
          ...(b.macroUseImports ?? []),
        ],
      });
    }
  type AttributeContext = {
    shadowable: {
      name: string;
      scope: string;
      helper?: true;
      nested?: boolean;
    }[];
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
  const inferredHelperNames = new Set(
    [...contextsByFile.values()].flatMap((contexts) =>
      contexts.flatMap((c) =>
        c.shadowable.filter((a) => a.helper).map((a) => a.name),
      ),
    ),
  );
  // A finite graph of captured module exports. A glob transfers only names
  // visible in its source module; opaque/unreadable output contributes none
  // under E4. This is positive binding evidence, never an export-completeness
  // claim or a semantic target resolution.
  let capturedMacroExports: Map<string, Set<string>> | undefined;
  let capturedHelperExports: Map<string, Set<string>> | undefined;
  let buildingHelperExports = false;
  function readableMacroUseBinds(
    head: string,
    file: string,
    scope: string,
    imports: readonly MacroUseImport[],
    helpersOnly = false,
  ): boolean {
    if (helpersOnly && buildingHelperExports) return true;
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
    let captured = helpersOnly ? capturedHelperExports : capturedMacroExports;
    if (!captured) {
      if (helpersOnly) buildingHelperExports = true;
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
        return (
          (helpersOnly && inferredHelperNames.has(name)) ||
          scopeNeutralStandardMacros.has(name) ||
          (!!rule && rule.category !== "builtin")
        );
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
                if (data(link).visibility === "pub" && watched(alias)) {
                  // macro_use imports only the macro namespace. A captured
                  // module/type re-export is not a competing helper attribute.
                  const target = helpersOnly
                    ? findUsePath(raw, loc, str(data(link).scope), "macro")
                    : null;
                  if (!target?.complete || target.symbols.length)
                    get(loc.crate.manifest, q).add(alias);
                }
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
      captured = new Map(
        packages
          .filter((c) => c.kind === "lib")
          .map((c) => [
            c.manifest,
            exports.get(key(c.manifest, "")) ?? new Set<string>(),
          ]),
      );
      if (helpersOnly) {
        capturedHelperExports = captured;
        buildingHelperExports = false;
      } else capturedMacroExports = captured;
    }
    for (const manifest of manifests)
      if (captured.get(manifest)?.has(head)) return true;
    return false;
  }
  // E5 (owner): unseen output/exports do not bind inferred derive-helper names.
  // Captured symbols and named imports still defeat the item-level inference.
  const assumeUnseenHelperBindings = true;
  function helperShadowed(origin: AttributeOrigin): boolean {
    // Stable Rust does not apply procedural attribute macros to fields/variants.
    if (origin.nested) return false;
    if (!helperReady) return true;
    const key = JSON.stringify(origin),
      cached = helperCache.get(key);
    if (cached !== undefined) return cached;
    if (helperBusy.has(key)) return true;
    helperBusy.add(key);
    let shadow = false;
    try {
      for (const own of ownerPlace(origin.file, origin.scope)) {
        let loc: Place | null = own;
        while (loc) {
          let scope = loc === own ? origin.scope : loc.local;
          while (true) {
            const b = attributeBindings.get(loc.file + "|" + scope);
            if (b) {
              if (
                readableMacroUseBinds(
                  origin.name,
                  loc.file,
                  scope,
                  b.macroUseImports ?? [],
                  true,
                ) ||
                (b.macroUseImports ?? []).some((r) =>
                  r.names?.includes(origin.name),
                )
              )
                shadow = true;
              if (
                !assumeUnseenHelperBindings &&
                (b.unknown || b.macroUse || b.helperUnknown)
              )
                shadow = true; // unseen helper binding
            }
            const found = find(origin.name, loc, scope, "macro");
            if (
              found.symbols.some(
                (s) => s.kind === "macro" || data(s).semanticKind === "macro",
              ) ||
              found.possibleImportNames?.includes(origin.name)
            )
              shadow = true;
            if (!assumeUnseenHelperBindings && !found.complete) shadow = true; // unseen helper lookup
            if (!scope) break;
            scope = scope.includes("::")
              ? scope.slice(0, scope.lastIndexOf("::"))
              : "";
          }
          loc = loc.parent;
        }
      }
      helperCache.set(key, shadow);
      clearIncompleteLookups();
      return shadow;
    } finally {
      helperBusy.delete(key);
    }
  }
  const attributeShadowCache = new Map<string, boolean>();
  function shadowFromParents(origin: AttributeOrigin): boolean {
    if (origin.helper) return helperShadowed(origin);
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
  let helperReady = false;
  const helperBusy = new Set<string>();
  const helperCache = new Map<string, boolean>();
  const deferredHelpers: AttributeOrigin[] = [];
  const itemPresenceCache = new Map<string, string[]>();
  function itemPresence(item: GraphSymbol | GraphLink): string[] {
    const cached = itemPresenceCache.get(item.id);
    if (cached) return cached;
    const attributes = [
      ...new Set([
        ...((data(item).opaqueItemAttributes ?? []) as string[]),
        ...("kind" in item && item.kind === "module" && !data(item).unit
          ? (moduleTargets.get(item.id) ?? []).flatMap((unit) =>
              itemPresence(unit),
            )
          : []),
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
    // One presence condition covers every semantic route, including textual
    // macro transfer and crate-root macro exports from guessed module files.
    if (
      attributeContextReady &&
      !conditions.includes("?module-layout") &&
      ownerPlace(s.file, str(data(s).scope)).some(
        (loc) => loc.directoryUnverified,
      )
    )
      conditions = [...conditions, "?module-layout"];
    // Always return a fresh canonical array, including module-file gates.
    const canonical = [...new Set(conditions)];
    return contextOf(s)?.implicit.length ? canonical.sort() : canonical;
  };
  // Captured paths are lexical hints, never evidence about symlinks or
  // rustc's special directory tracking for inner/inline path attributes.
  function plainModulePath(value: string): boolean {
    return (
      !!value &&
      !value.includes("\\") &&
      !/^(?:\/|[A-Za-z]:)/.test(value) &&
      value.split("/").every((part) => !!part && part !== "." && part !== "..")
    );
  }
  function hintedFiles(names: string[]): string[] {
    const wanted = new Set(names);
    return [...files.keys()].filter(
      (file) =>
        wanted.has(p.basename(file)) ||
        (p.basename(file) === "mod.rs" &&
          wanted.has(p.basename(p.dirname(file)) + ".rs")),
    );
  }
  function moduleDirectories(
    layout: Data,
    defaults: string[],
    base: string,
    inline: boolean,
  ): { directories: string[]; uncertain: boolean } {
    const paths = (layout.paths ?? []) as string[];
    if (!paths.length && !layout.pathOpaque)
      return { directories: defaults, uncertain: false };
    // These newly supported shapes lack a complete rustc directory model.
    // Keep locations only as hints; descendants also search captured filenames.
    return {
      directories: [
        ...new Set([
          ...defaults,
          ...paths.map((value) =>
            inline
              ? p.normalize(p.join(base, value))
              : p.dirname(p.join(base, value)),
          ),
        ]),
      ],
      uncertain: true,
    };
  }
  function walk(place: Place, ancestors: Set<string>) {
    const visitKey = `${place.crate.root}|${place.file}|${place.local}`;
    if (ancestors.has(visitKey)) return;
    places.push(place);
    const next = new Set([...ancestors, visitKey]);
    for (const s of moduleDeclarations.get(`${place.file}|${place.local}`) ??
      []) {
      if (place.uncertain) moduleIncomplete.add(s.id);
      const local = s.identity;
      const relative = local.slice(place.local.length).replace(/^::/, "");
      const scope = [place.scope, relative].filter(Boolean).join("::");
      const destinations: Place[] = [];
      if (data(s).inline) {
        const layout = moduleDirectories(
          data(s),
          [p.join(place.directory, s.name)],
          place.directory,
          true,
        );
        if (layout.uncertain) moduleIncomplete.add(s.id);
        for (const directory of layout.directories)
          destinations.push({
            ...place,
            scope,
            local,
            directory,
            directoryUnverified:
              !!place.directoryUnverified || layout.uncertain,
            noImplicitPrelude:
              !!place.noImplicitPrelude || !!data(s).noImplicitPrelude,
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
            uncertain:
              place.uncertain || moduleIncomplete.has(s.id) || layout.uncertain,
          });
      } else {
        const path = str(data(s).path);
        const pathValues = (data(s).paths ?? []) as string[];
        const pathUnverified =
          !!data(s).pathOpaque ||
          pathValues.some((value) => !plainModulePath(value));
        const locationUnverified =
          !!place.directoryUnverified ||
          pathUnverified ||
          data(s).blockModuleLocation === "inline" ||
          (data(s).blockModuleLocation === "direct" && !data(s).pathExplicit);
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
            ...(locationUnverified
              ? hintedFiles(
                  pathValues.length
                    ? pathValues.map((value) =>
                        p.basename(value.replaceAll("\\", "/")),
                      )
                    : [s.name + ".rs"],
                )
              : []),
          ]),
        ];
        if (locationUnverified) moduleIncomplete.add(s.id);
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
          if (locationUnverified) directories.add(p.dirname(file));
          if (pathTargets.has(file)) directories.add(p.dirname(file));
          if (!data(s).pathExplicit && !path && ordinary.includes(file))
            directories.add(
              p.basename(file) === "mod.rs"
                ? p.dirname(file)
                : p.join(p.dirname(file), p.basename(file, ".rs")),
            );
          // An unconditional outer path is first and makes the inner path unused.
          const innerLayout = (
            data(s).pathExplicit && path
              ? {}
              : (data(units.get(file) ?? {}).innerModulePath ?? {})
          ) as Data;
          const layout = moduleDirectories(
            innerLayout,
            [...directories],
            p.dirname(file),
            false,
          );
          if (layout.uncertain) moduleIncomplete.add(s.id);
          for (const directory of layout.directories)
            destinations.push({
              crate: place.crate,
              file,
              local: "",
              scope,
              noImplicitPrelude:
                !!place.noImplicitPrelude ||
                !!data(s).noImplicitPrelude ||
                !!data(units.get(file) ?? {}).noImplicitPrelude,
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
              uncertain:
                place.uncertain ||
                moduleIncomplete.has(s.id) ||
                layout.uncertain,
              directory,
              directoryUnverified: locationUnverified || layout.uncertain,
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
      noImplicitPrelude: !!data(units.get(crate.root) ?? {}).noImplicitPrelude,
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
  if (markConditions)
    for (const link of ctx.links)
      if (contextOf(link)?.implicit.length)
        markConditions(link, conditionsFor(link));
  const failedByScope = new Map<string, string[]>(),
    failedByCrate = new Map<string, string[]>();
  for (const loc of places)
    if (failedFiles.has(loc.file) && !loc.directoryUnverified) {
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
    symbol?: GraphSymbol;
    conditions?: string[];
    unseenReason?: string;
    file: string;
    scope: string;
    start: number;
    order: number[];
  };
  const directText: TextMacro[] = symbols
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
  function importedText(m: GraphSymbol, seen = new Set<string>()): TextMacro[] {
    if (seen.has(m.id)) return [];
    seen = new Set([...seen, m.id]);
    const result: TextMacro[] = [];
    for (const body of modulePlaces.get(m.id) ?? []) {
      const failed = failedFiles.has(body.file);
      const guards = [
        ...((data(m).macroUseConditions ?? []) as string[][]),
        ...(data(m).inline
          ? []
          : ((data(units.get(body.file) ?? {}).macroUseConditions ??
              []) as string[][])),
        ...(failed || body.directoryUnverified ? [[]] : []),
      ];
      // A failed file's leading inner attributes cannot prove absence of macro_use.
      if (!guards.length) continue;
      const inBody = (e: { file: string; scope: string }) =>
        data(m).inline
          ? e.file === m.file && e.scope === m.identity
          : e.file === body.file && e.scope === "";
      const entries = [
        ...directText.filter(inBody),
        ...modules
          .filter((child) =>
            inBody({ file: child.file, scope: str(data(child).scope) }),
          )
          .flatMap((child) => importedText(child, seen)),
      ];
      if (failed || body.directoryUnverified)
        entries.push({
          file: m.file,
          scope: str(data(m).scope),
          start: m.range.end,
          order: [Number.MAX_SAFE_INTEGER],
          conditions: [],
          unseenReason: body.directoryUnverified
            ? "module-layout-unverified"
            : internalFailures.has(body.file)
              ? "parser-internal-error"
              : "failed-file-unseen-declarations",
        });
      for (const entry of entries) {
        const condition = `all(${[...conditionsFor(m), ...(entry.conditions ?? []), entry.symbol ? str(data(entry.symbol).macroPathCondition) || "all()" : "all()", `any(${guards.map((cs) => `all(${cs.join(",")})`).join(",")})`].join(",")})`;
        result.push({
          ...(entry.symbol
            ? {
                symbol: {
                  ...entry.symbol,
                  data: {
                    ...data(entry.symbol),
                    macroPathCondition: condition,
                  },
                },
              }
            : {
                conditions: [condition],
                unseenReason:
                  entry.unseenReason ?? "failed-file-unseen-declarations",
              }),
          file: m.file,
          scope: str(data(m).scope),
          start: m.range.end,
          order: [m.range.end, ...entry.order],
        });
      }
    }
    return result;
  }
  const textMacrosByFile = new Map<
    string,
    { named: Map<string, TextMacro[]>; unseen: TextMacro[] }
  >();
  {
    const unseen = new Set<string>();
    const indexTextMacro = (entry: TextMacro): void => {
      let file = textMacrosByFile.get(entry.file);
      if (!file) {
        file = { named: new Map(), unseen: [] };
        textMacrosByFile.set(entry.file, file);
      }
      if (!entry.symbol) {
        // Identical unseen imports contribute the same reason in the same
        // textual position. Keep the first occurrence and all distinct facts.
        const key = JSON.stringify(entry);
        if (unseen.has(key)) return;
        unseen.add(key);
        file.unseen.push(entry);
      } else {
        const name = entry.symbol.name;
        const named = file.named.get(name) ?? [];
        named.push(entry);
        file.named.set(name, named);
      }
    };
    for (const entry of directText) indexTextMacro(entry);
    for (const module of modules)
      for (const entry of importedText(module)) indexTextMacro(entry);
  }
  function textualMacro(
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
    seen = new Set<string>(),
  ): Found | null {
    const guard = `${site.file}|${scope}|${site.range.start}`;
    if (seen.has(guard)) return null;
    seen = new Set([...seen, guard]);
    const file = textMacrosByFile.get(site.file);
    const entries = [...(file?.named.get(name) ?? []), ...(file?.unseen ?? [])]
      .filter(
        (e) =>
          e.start <= site.range.start &&
          (!e.scope || e.scope === scope || scope.startsWith(e.scope + "::")) &&
          possible([
            ...(loc.conditions ?? []),
            ...(e.symbol ? conditionsFor(e.symbol) : (e.conditions ?? [])),
          ]),
      )
      .sort(
        (a, b) =>
          b.scope.length - a.scope.length ||
          b.start - a.start ||
          a.order.reduce((diff, v, i) => diff || (b.order[i] ?? 0) - v, 0),
      );
    const targets: GraphSymbol[] = [];
    const unseen = new Set<string>();
    for (const entry of entries) {
      if (!entry.symbol) {
        unseen.add(entry.unseenReason ?? "failed-file-unseen-declarations");
        continue;
      }
      targets.push(entry.symbol);
      if (present(targets, loc)) break;
    }
    // A child inherits the parent's textual environment at its declaration,
    // not at the end of the parent file. Local unconditional definitions win.
    let boundary: Place | null = loc;
    while (boundary?.parent && boundary.parent.file === site.file)
      boundary = boundary.parent;
    let inherited =
      boundary?.parent && boundary.symbol
        ? textualMacro(
            name,
            {
              ...site,
              file: boundary.parent.file,
              range: boundary.symbol.range,
            },
            {
              ...boundary.parent,
              conditions: [
                ...(boundary.parent.conditions ?? []),
                ...(loc.conditions ?? []),
              ],
            },
            str(data(boundary.symbol).scope),
            seen,
          )
        : null;
    if (inherited && (boundary?.directoryUnverified || boundary?.uncertain))
      inherited = {
        ...inherited,
        complete: false,
        reason: "module-layout-unverified",
      };
    if (!targets.length && !unseen.size) return inherited;
    if (inherited && !present(targets, loc)) {
      targets.push(...inherited.symbols);
      if (!inherited.complete)
        unseen.add(inherited.reason ?? "macro-applicability-unverified");
    }
    // A fallback can guarantee coverage without proving each alternative's
    // applicability (for example, a conditional module-file layout).
    if (targets.some((s) => conditionsFor(s).some((c) => c.includes("?"))))
      unseen.add("macro-applicability-unverified");
    const found = conditional(
      { symbols: unique(targets), complete: true },
      targets,
      loc,
    );
    return unseen.size
      ? {
          ...found,
          complete: false,
          reason: [
            ...new Set([...(found.reason ? [found.reason] : []), ...unseen]),
          ].join("; "),
        }
      : found;
  }
  const externCratesByFile = new Map<string, GraphLink[]>();
  for (const l of ctx.links)
    if (data(l).externCrate && str(data(l).scope) === "")
      externCratesByFile.set(l.file, [
        ...(externCratesByFile.get(l.file) ?? []),
        l,
      ]);
  for (const links of externCratesByFile.values())
    links.sort((a, b) => b.range.start - a.range.start);
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
    let path = find(name, loc, scope, "macro");
    // Captured macro_export definitions are path-based at the exporting crate
    // root. Proc-macro expansion itself remains outside the fallback.
    const visibleSymbols = path.symbols.filter(
      (s) =>
        (ownerPlace(s.file, str(data(s).scope)).some(
          (p) => p.crate.root === loc.crate.root,
        ) &&
          (s.kind === "macro" || s.file === site.file)) ||
        (s.kind === "macro" &&
          data(s).macroRules &&
          ((data(s).macroExportConditions ?? []) as string[][]).length > 0),
    );
    if (visibleSymbols.length !== path.symbols.length) {
      if (path.complete) clearIncompleteLookups();
      path.symbols = visibleSymbols;
    }
    if (
      !loc.noImplicitPrelude &&
      !name.includes("::") &&
      !(path.complete && path.symbols.length)
    ) {
      const imports: Found[] = [];
      // macro_use prelude imports are fallback bindings; the most recent
      // matching import wins. A later unknown export set defeats that proof.
      const externs = externCratesByFile.get(loc.crate.root) ?? [];
      outer: for (const l of externs) {
        for (const request of (data(l).macroUseRequests ?? []) as {
          names: string[] | null;
          conditions: string[];
        }[]) {
          if (request.names && !request.names.includes(name)) continue;
          const cs = [...conditionsFor(l), ...request.conditions];
          if (!possible([...(loc.conditions ?? []), ...cs])) continue;
          let branch = dependencyLookup(
            l.targetName,
            [name],
            { ...loc, conditions: [...(loc.conditions ?? []), ...cs] },
            "macro",
            new Set(),
            true,
            loc,
            true,
          );
          const { failedFiles: ignored, ...rest } = branch;
          branch = {
            ...rest,
            symbols: branch.symbols.filter(
              (s) =>
                s.kind === "macro" &&
                data(s).macroRules &&
                ((data(s).macroExportConditions ?? []) as string[][]).length >
                  0,
            ),
          };
          if (!branch.symbols.length || ignored?.length)
            branch = {
              ...branch,
              complete: false,
              reason: "macro-use-exports-unverified",
            };
          const at = { ...l, data: { ...data(l), conditions: cs } };
          branch = conditional(branch, [at], loc);
          imports.push(branch);
          if (branch.complete && branch.symbols.length) break outer;
        }
      }
      if (imports.length)
        path =
          path.symbols.length || !path.complete
            ? merge([path, ...imports])
            : merge(imports);
    }
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
  // Incomplete results are reusable only with the same active guards and
  // expansion limits. A cycle cut here can be a real route in another search.
  const incompleteLookups = new LookupMemo<Found>();
  const observedIncompleteGuards = new Set<string>();
  const observedImportProofs = new Set<string>();
  let lookupRevision = 0;
  let lookupFactsFinal = false;
  let activeLookup:
    | {
        trace: LookupTrace;
        seen: Set<string>;
        expansion: ImportExpansion | undefined;
      }
    | undefined;
  function clearIncompleteLookups() {
    incompleteLookups.clear();
    observedIncompleteGuards.clear();
    observedImportProofs.clear();
    lookupRevision++;
  }
  const empty = (complete = true): Found => ({ symbols: [], complete });
  const merge = (xs: Found[]): Found => {
    const causes = xs.flatMap((x) => x.failedFiles ?? []);
    const possibleImportNames = [
      ...new Set(xs.flatMap((x) => x.possibleImportNames ?? [])),
    ];
    const alternatives = xs.some(
      (x) => !x.failedFiles?.length && (x.symbols.length || !x.complete),
    );
    return causes.length
      ? {
          possibleImportNames,
          ...(alternatives
            ? { complete: false, reason: "failed-file-unseen-declarations" }
            : broken(causes)),
          symbols: unique(xs.flatMap((x) => x.symbols)),
          opaqueAttributes: [
            ...new Set(xs.flatMap((x) => x.opaqueAttributes ?? [])),
          ].sort(),
        }
      : {
          possibleImportNames,
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
        .filter((p) => failedFiles.has(p.file) && !p.directoryUnverified)
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
              dest.directoryUnverified && failedFiles.has(dest.file)
                ? {
                    symbols: [],
                    complete: false,
                    reason: "module-layout-unverified",
                  }
                : find(
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
      if (!rest.length && bindings.some((binding) => "targetName" in binding))
        found = {
          ...found,
          possibleImportNames: [
            ...new Set([...(found.possibleImportNames ?? []), name]),
          ],
        };
      // Declaration bindings are already namespace-filtered. An explicit use
      // needs independent proof about its first segment, not its members or
      // an unknown external namespace. Unknown is not a binding in every ns.
      bindings = bindings.filter((binding) => {
        if (!("targetName" in binding)) return accepts(binding, headNs);
        const proofKey = JSON.stringify([
          parentIdentity(loc),
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
          !!loc.noImplicitPrelude,
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
        if (!proven && (reused ? reused.cycleFree : cycleCuts === before)) {
          unprovedImports.add(proofKey);
          if (observedImportProofs.has(proofKey)) clearIncompleteLookups();
        } else if (activeLookup) observedImportProofs.add(proofKey);
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
        activeLookup?.trace.requireShorterSuffix(expansionKey, suffix.length);
        cycleCuts++;
        return { ...empty(false), reason: "import-cycle-unverified" };
      }
      const lookup = activeLookup;
      const previousExpansion = lookup?.expansion;
      if (lookup) {
        lookup.trace.requireSuffix(expansionKey, suffix.length);
        lookup.expansion = { key: expansionKey, length: suffix.length };
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
        if (lookup) lookup.expansion = previousExpansion;
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
    absolutePath = false,
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
          (!explicit && !absolutePath && loc.noImplicitPrelude) ||
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
              !explicit && !absolutePath && loc.noImplicitPrelude
                ? "no-implicit-prelude-binding-unverified"
                : !loc.crate.edition && !explicit
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
      !!loc.noImplicitPrelude,
      allowGlobs,
      accessFrom?.crate.root,
      accessFrom?.scope,
      loc.conditions,
    ]);
    const cached = memo.get(guard);
    if (cached) return cached;
    const outer = activeLookup;
    if (outer && outer.seen !== seen) outer.trace.valid = false;
    if (seen.has(guard)) {
      if (lookupFactsFinal) observedIncompleteGuards.add(guard);
      outer?.trace.required.add(guard);
      cycleCuts++;
      return empty(!accessFrom ? false : true);
    }
    if (seen.size > lookupDepth) {
      if (outer) outer.trace.valid = false;
      cycleCuts++;
      return { ...empty(false), reason: "import-lookup-depth-unverified" };
    }
    const state = lookupFactsFinal
      ? JSON.stringify([
          guard,
          ns === "macro" ? activeMacroImports.at(-1)?.id : undefined,
          parentIdentity(loc),
          loc.local,
          loc.symbol?.id,
          loc.crate.manifest,
          loc.crate.edition,
          loc.crate.kind,
          loc.crate.name,
          !!loc.uncertain,
          !!loc.directoryUnverified,
          accessFrom.conditions?.length
            ? [...new Set(accessFrom.conditions)].sort()
            : undefined,
          helperBusy.size ? [...helperBusy].sort() : undefined,
        ])
      : undefined;
    const reused =
      state === undefined
        ? undefined
        : incompleteLookups.get(state, seen, importExpansions);
    if (reused) {
      outer?.trace.absorb(reused.trace, outer.expansion);
      if (reused.cut) cycleCuts++;
      return { ...reused.result };
    }
    const revision = lookupRevision;
    const cutsBefore = cycleCuts;
    const next = new Set([...seen, guard]);
    const trace = state === undefined ? undefined : new LookupTrace();
    if (!trace && outer) outer.trace.valid = false;
    activeLookup = trace
      ? { trace, seen: next, expansion: undefined }
      : undefined;
    let result: Found;
    try {
      result = lookupPath(name, loc, scope, ns, next, allowGlobs, accessFrom);
    } finally {
      activeLookup = outer;
    }
    if (result.complete) {
      // A complete entry preempts a previous incomplete result or cycle cut,
      // including when another saved lookup depended on that answer.
      if (observedIncompleteGuards.has(guard)) clearIncompleteLookups();
      memo.set(guard, result);
    } else if (trace && state !== undefined) {
      observedIncompleteGuards.add(guard);
      // This guard is supplied by the lookup itself, and must be absent on
      // entry. Other observed guards still depend on the caller's stack.
      trace.required.delete(guard);
      trace.excluded.add(guard);
      outer?.trace.absorb(trace, outer.expansion);
      if (trace.fits() && revision === lookupRevision)
        incompleteLookups.set(state, {
          result: { ...result },
          cut: cycleCuts !== cutsBefore,
          trace,
        });
    }
    return result;
  }

  function lookupPath(
    name: string,
    loc: Place,
    scope: string,
    ns: Namespace,
    seen: Set<string>,
    allowGlobs: boolean,
    accessFrom: Place,
  ): Found {
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
    const fallbackImportNames: string[] = [];
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
            fallbackImportNames.push(...(found.possibleImportNames ?? []));
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
          absolute,
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
        possibleImportNames: [
          ...new Set([
            ...fallbackImportNames,
            ...(result.possibleImportNames ?? []),
          ]),
        ],
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
  // On stable Rust a derive name resolves among derive macros only, which
  // come from proc-macro crates (use, path, `#[macro_use] extern crate`) or
  // the standard prelude. `macro_rules!` macros are function-like on stable
  // (`macro_rules!` derives are unstable, E0658), and a bang `macro_rules!
  // Debug` coexists with `#[derive(Debug)]` (R1-K controls2/d1, d2), so
  // `#[macro_use] mod m;` cannot change a derive. A named extern-crate import
  // list risks only the names it lists; a bare one risks every name (strict).
  const macroUseCrates = new Map<string, Set<string> | null>();
  for (const f of ctx.files)
    for (const b of (data(f.result).attributeBindings ?? []) as {
      macroUseImports?: MacroUseImport[];
    }[])
      for (const request of b.macroUseImports ?? [])
        for (const loc of ownerPlace(f.path, "")) {
          const known = macroUseCrates.get(loc.crate.root);
          if (known === null) continue;
          macroUseCrates.set(
            loc.crate.root,
            request.names
              ? new Set([...(known ?? []), ...request.names])
              : null,
          );
        }
  const macroUseDerive = (root: string, name: string): boolean => {
    if (!macroUseCrates.has(root)) return false;
    const names = macroUseCrates.get(root);
    return names === null || !!names?.has(name);
  };
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
      names.some(
        (n) => !standardDerives.has(n) || macroUseDerive(loc.crate.root, n),
      )
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
  // Visible captured bindings defeat the std assumption. Checking the whole
  // project for definitions is intentionally conservative; imports are checked
  // in the caller's lexical module. Unseen output is ignored under E4.
  const coreStatementMacros = new Set([
    "assert",
    "assert_eq",
    "assert_ne",
    "debug_assert",
    "debug_assert_eq",
    "debug_assert_ne",
    "panic",
    "todo",
    "unreachable",
    "unimplemented",
    "matches",
    "write",
    "writeln",
  ]);
  const sysrootNames = new Set(["std", "core", "alloc"]);
  const canonicalSysrootImport = (l: GraphLink, crate: Crate): boolean =>
    !!data(l).externCrate &&
    sysrootNames.has(l.targetName) &&
    data(l).alias === l.targetName &&
    !crate.deps.has(l.targetName) &&
    !itemPresence(l).length;
  const macroSites = new Map(
    ctx.links
      .filter((l) => l.kind === "macros")
      .map((l) => [`${l.file}|${l.range.start}`, l]),
  );
  function standardAvailable(
    entry: { name: string; scope: string; start?: number },
    loc: Place,
  ): boolean {
    const site = macroSites.get(`${loc.file}|${entry.start}`);
    const conditions = [
      ...(loc.conditions ?? []),
      ...(site ? conditionsFor(site) : []),
    ];
    const noStd = (
      (data(units.get(loc.crate.root) ?? {}).noStdConditions ??
        []) as string[][]
    ).some((cs) => possible([...conditions, ...cs]));
    const parts = entry.name.replace(/^::/, "").split("::");
    const name = parts.at(-1)!;
    const imported = (crate: string, macros: boolean) =>
      (externCratesByFile.get(loc.crate.root) ?? []).some(
        (l) =>
          l.file === loc.crate.root &&
          str(data(l).scope) === "" &&
          l.targetName === crate &&
          canonicalSysrootImport(l, loc.crate) &&
          conditionsFor(l).every((c) => implies(conditions, c)) &&
          (!macros ||
            (
              (data(l).macroUseRequests ?? []) as {
                conditions: string[];
                names: string[] | null;
              }[]
            ).some(
              (r) =>
                (!r.names || r.names.includes(name)) &&
                r.conditions.every((c) => implies(conditions, c)),
            )),
      );
    if (parts.length > 1) {
      if (parts[0] === "alloc") return imported("alloc", false);
      if (parts[0] === "std" && noStd) return imported("std", false);
      return true;
    }
    if (!noStd || coreStatementMacros.has(name)) return true;
    return (
      imported("std", true) ||
      (["vec", "format"].includes(name) && imported("alloc", true))
    );
  }
  // A captured `macro_rules!` definition binds a bare name only where it is
  // in textual scope, or through a path or import (checked by
  // importedStandardName). Other macro bindings stay project-wide (R1-K).
  const textualMacroNames = new Set(
    symbols
      .filter((s) => s.kind === "macro" && data(s).macroRules)
      .map((s) => s.name),
  );
  const visibleMacroNames = new Set(
    symbols
      .filter(
        (s) =>
          (s.kind === "macro" && !data(s).macroRules) ||
          data(s).semanticKind === "macro",
      )
      .map((s) => s.name),
  );
  function textualStandardBinding(
    name: string,
    entry: { scope: string; start?: number },
    file: string,
    loc: Place,
  ): boolean {
    if (!textualMacroNames.has(name)) return false;
    const site = macroSites.get(`${file}|${entry.start}`);
    if (!site) return true;
    const textual = textualMacro(name, site, { ...loc, file }, entry.scope);
    return !!textual?.symbols.length;
  }

  for (const f of ctx.files)
    for (const b of (data(f.result).attributeBindings ?? []) as {
      macroUseImports?: MacroUseImport[];
    }[])
      for (const request of b.macroUseImports ?? []) {
        if (
          sysrootNames.has(request.crate) &&
          ownerPlace(f.path, "").every(
            (loc) => !loc.crate.deps.has(request.crate),
          )
        )
          continue;
        for (const name of request.names ?? []) visibleMacroNames.add(name);
        if (!request.names)
          for (const name of scopeNeutralStandardMacros)
            if (readableMacroUseBinds(name, f.path, "", [request]))
              visibleMacroNames.add(name);
      }
  const visiblePrefixes = new Set(
    symbols
      .filter((s) => ["module", "type", "struct", "enum"].includes(s.kind))
      .map((s) => s.name),
  );
  for (const l of ctx.links)
    if (l.kind === "imports" && !data(l).glob)
      if (
        !ownerPlace(l.file, str(data(l).scope)).every((loc) =>
          canonicalSysrootImport(l, loc.crate),
        )
      )
        visiblePrefixes.add(str(data(l).alias));
  for (const c of packages)
    for (const name of c.deps.keys()) visiblePrefixes.add(name);
  function importedStandardName(
    file: string,
    scope: string,
    name: string,
  ): boolean {
    return ownerPlace(file, scope).some((loc) => {
      let local = scope,
        resolved = false;
      while (true) {
        // R1-K: an explicit import binds the macro name unless it resolves
        // to std's own macro path or, completely, to no macro (a function,
        // a module). The nearest explicit import decides.
        const explicit = importsByScope
          .get(`${file}|${local}`)
          ?.explicit.get(name);
        if (explicit?.length) {
          if (!explicit.every((l) => importBindsNoMacro(l, name, loc, local)))
            return true;
          resolved = true;
          break;
        }
        if (!local || local === loc.local) break;
        local = local.includes("::")
          ? local.slice(0, local.lastIndexOf("::"))
          : "";
      }
      const found = find(name, loc, scope, "macro");
      return (
        !!found.symbols.length ||
        (!resolved && !!found.possibleImportNames?.includes(name))
      );
    });
  }
  // E4: failed/unverified textual entries are unseen code. Assume they do
  // not rebind the standard names; ordinary textual macro lookup stays strict.
  function dependencyMacro(alias: string, name: string, loc: Place): boolean {
    const edges = (loc.crate.dependencies ?? []).filter(
      (e) =>
        e.name === alias &&
        possible([...(loc.conditions ?? []), ...e.conditions]),
    );
    return (
      edges.length > 0 &&
      edges.some((e) =>
        e.conditions.every((c) => implies(loc.conditions ?? [], c)),
      ) &&
      edges.every((e) =>
        auditedMacro(
          e.packageName ?? "",
          e.registryVersion,
          name,
          e.registryRequirement,
        ),
      )
    );
  }
  function ecosystemPath(path: string, loc: Place, scope: string): boolean {
    const parts = path.replace(/^::/, "").split("::");
    if (parts.length !== 2 || !loc.crate.edition) return false;
    const [alias, name] = parts as [string, string];
    if (!dependencyMacro(alias, name, loc)) return false;
    // A captured module/import or an unknown glob can override an extern-
    // prelude name. Query the ordinary type namespace, not macro spelling.
    const prefix = find(alias, loc, scope, "type");
    if (
      prefix.symbols.length ||
      !prefix.complete ||
      prefix.possibleImportNames?.length
    ) {
      // `extern crate tracing;` is the same dependency, not a local module.
      let local = scope;
      let direct: GraphLink[] = [];
      let globs = false;
      while (true) {
        const uses = importsByScope.get(`${loc.file}|${local}`);
        globs ||= !!uses?.globs.length;
        direct = uses?.explicit.get(alias) ?? [];
        if (direct.length || !local || local === loc.local) break;
        local = local.includes("::")
          ? local.slice(0, local.lastIndexOf("::"))
          : "";
      }
      if (
        prefix.symbols.length ||
        !direct.length ||
        !present(direct, loc) ||
        direct.some(
          (l) =>
            (!(data(l).externCrate && l.targetName === alias) &&
              // Audited `anyhow::anyhow` is macro-only: importing it does not
              // shadow the crate's type-namespace name with its own macro alias.
              !(
                alias === "anyhow" &&
                name === "anyhow" &&
                !globs &&
                l.targetName === "anyhow::anyhow" &&
                data(l).alias === alias
              )) ||
            itemPresence(l).length,
        )
      )
        return false;
    }
    if (loc.crate.edition === "2015")
      return ctx.links.some(
        (l) =>
          l.file === loc.crate.root &&
          data(l).externCrate &&
          l.targetName === alias &&
          data(l).alias === alias &&
          conditionsFor(l).every((c) => implies(loc.conditions ?? [], c)),
      );
    return true;
  }
  function ecosystemProven(
    entry: { name: string; scope: string; start?: number },
    loc: Place,
  ): boolean {
    const site = macroSites.get(`${loc.file}|${entry.start}`);
    if (!site) return false;
    loc = {
      ...loc,
      conditions: [...(loc.conditions ?? []), ...conditionsFor(site)],
    };
    if (entry.name.includes("::"))
      return ecosystemPath(entry.name, loc, entry.scope);
    const textual = textualMacro(entry.name, site, loc, entry.scope);
    if (textual && (textual.symbols.length || !textual.complete)) return false;
    let scope = entry.scope;
    while (true) {
      const uses = importsByScope.get(`${loc.file}|${scope}`);
      const direct = (uses?.explicit.get(entry.name) ?? []).filter(
        (l) =>
          !data(l).externCrate &&
          possible([...(loc.conditions ?? []), ...conditionsFor(l)]),
      );
      if (direct.length)
        return (
          present(direct, loc) &&
          direct.every(
            (l) =>
              !data(l).glob &&
              ecosystemPath(
                l.targetName,
                {
                  ...loc,
                  conditions: [...(loc.conditions ?? []), ...conditionsFor(l)],
                },
                scope,
              ),
          )
        );
      if (uses?.globs.length) {
        const supplied = find(entry.name, loc, scope, "macro");
        if (
          supplied.symbols.length ||
          !supplied.complete ||
          supplied.possibleImportNames?.includes(entry.name)
        )
          return false;
      }
      if (!scope || scope === loc.local) break;
      scope = scope.includes("::")
        ? scope.slice(0, scope.lastIndexOf("::"))
        : "";
    }
    if (loc.noImplicitPrelude) return false;
    let guaranteed = false;
    for (const l of externCratesByFile.get(loc.crate.root) ?? []) {
      for (const request of (data(l).macroUseRequests ?? []) as {
        names: string[] | null;
        conditions: string[];
      }[]) {
        if (request.names && !request.names.includes(entry.name)) continue;
        const cs = [...conditionsFor(l), ...request.conditions];
        if (!possible([...(loc.conditions ?? []), ...cs])) continue;
        if (canonicalSysrootImport(l, loc.crate)) continue;
        const edges = (loc.crate.dependencies ?? []).filter(
          (e) => e.name === l.targetName,
        );
        if (
          edges.length &&
          edges.every((e) => {
            const contract = ecosystemMacros.get(e.packageName ?? "");
            return (
              !!contract &&
              (e.registryVersion === undefined
                ? compatibleRequirement(
                    contract.version,
                    e.registryRequirement,
                    contract.minimum,
                  )
                : compatibleRelease(
                    contract.version,
                    e.registryVersion,
                    contract.minimum,
                  )) &&
              !contract.names.has(entry.name)
            );
          })
        )
          continue;
        if (
          !dependencyMacro(l.targetName, entry.name, {
            ...loc,
            conditions: [...(loc.conditions ?? []), ...cs],
          })
        )
          return false;
        guaranteed ||= cs.every((c) => implies(loc.conditions ?? [], c));
      }
    }
    return guaranteed;
  }
  /** The standard-macro exemption's checks, for one name at one site. */
  function standardUnsafe(
    entry: { name: string; scope: string; start?: number },
    file: string,
    loc: Place,
  ): boolean {
    return (
      !standardAvailable(entry, { ...loc, file }) ||
      (entry.name.includes("::")
        ? visiblePrefixes.has(entry.name.replace(/^::/, "").split("::")[0]!)
        : visibleMacroNames.has(standardMacroName(entry.name)!) ||
          textualStandardBinding(
            standardMacroName(entry.name)!,
            entry,
            file,
            loc,
          ) ||
          importedStandardName(file, entry.scope, entry.name)) ||
      ownerPlace(file, entry.scope).some((p) => p.noImplicitPrelude)
    );
  }
  /**
   * A macro exported with `local_inner_macros` resolves every bare nested
   * macro name at its own crate root (`$crate::name`), standard-looking names
   * included. Rather than model that, every proof through such a macro is
   * withheld when it invokes any macro by a bare name: not neutral, not
   * clean, not forwarding (R1-K round 5).
   */
  const profileOf = (s: GraphSymbol): MacroProfile | undefined => {
    const profile = data(s).macroProfile as unknown as MacroProfile | undefined;
    if (
      profile &&
      data(s).localInnerMacros &&
      profile.macroHeads.some((h) => h !== "$crate" && h !== "")
    )
      return {
        ...profile,
        neutral: false,
        clean: false,
        forwards: null,
        bodyMacros: [],
      };
    return profile;
  };
  /**
   * The one readable workspace `macro_rules!` definition that `name` names at
   * an invocation site, or null. Names in a transcriber resolve at the call
   * site, except `$crate::` paths, which resolve in the defining crate.
   */
  function definiteMacro(
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
    from?: GraphSymbol,
  ): GraphSymbol | null {
    if (name.startsWith("$crate::")) {
      const home = from && ownerPlace(from.file, "")[0];
      if (!home) return null;
      return definiteMacro(
        "crate::" + name.slice(8),
        site,
        { ...home, conditions: loc.conditions ?? [] },
        "",
      );
    }
    if (name.includes("$")) return null;
    const found = macroLookup(name, site, loc, scope);
    const targets = unique(found.symbols);
    if (!found.complete || found.failedFiles?.length || targets.length !== 1)
      return null;
    const s = targets[0]!;
    if (
      s.kind !== "macro" ||
      !data(s).macroRules ||
      itemPresence(s).length ||
      !profileOf(s)?.readable ||
      conditionsFor(s).some((c) => !implies(loc.conditions ?? [], c))
    )
      return null;
    return s;
  }
  const siteLoc = (site: GraphLink, loc: Place): Place => ({
    ...loc,
    conditions: [...(loc.conditions ?? []), ...conditionsFor(site)],
  });
  /** A statement-position invocation cannot add items or `let` bindings. */
  function projectNeutral(
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
    from?: GraphSymbol,
    seen = new Set<string>(),
  ): boolean {
    if (
      standardMacroName(name) &&
      !standardUnsafe({ name, scope, start: site.range.start }, site.file, loc)
    )
      return true;
    // A standard name that a workspace macro rebinds is judged as that macro.
    const s = definiteMacro(name, site, loc, scope, from);
    if (!s || seen.has(s.id) || seen.size > 16) return false;
    const profile = profileOf(s)!;
    return (
      profile.neutral &&
      profile.nested.every((n) =>
        projectNeutral(n, site, loc, scope, s, new Set([...seen, s.id])),
      )
    );
  }
  /**
   * R1-K round 4, the name rule: at one invocation point, `n` (a bare name)
   * is the standard or builtin macro only if nothing else can be bound to it
   * there under macro name lookup, and everything that could matter is read.
   * Fails closed on anything unseen or unenumerable.
   */
  function standardAt(
    n: string,
    site: GraphLink,
    loc: Place,
    scope: string,
  ): boolean {
    const file = site.file,
      at = { ...loc, file };
    // Availability (no_std, no_implicit_prelude).
    if (
      standardMacroName(n) &&
      !standardAvailable({ name: n, scope, start: site.range.start }, at)
    )
      return false;
    if (ownerPlace(file, scope).some((p) => p.noImplicitPrelude)) return false;
    // Proc macros and named or readable `#[macro_use]` imports, anywhere.
    if (visibleMacroNames.has(n)) return false;
    // (a) Textual scope: earlier `macro_rules!` here and in enclosing scopes
    // (functions included), inherited from parent files, carried by
    // `#[macro_use] mod`. An unseen entry (failed file) fails closed.
    const textual = textualMacro(n, site, at, scope);
    if (textual && (textual.symbols.length || !textual.complete)) return false;
    // `#[macro_use] extern crate`: outside the workspace fails closed; a
    // workspace crate binds the names it exports.
    for (const l of externCratesByFile.get(loc.crate.root) ?? [])
      for (const r of (data(l).macroUseRequests ?? []) as {
        names: string[] | null;
        conditions: string[];
      }[]) {
        if (r.names && !r.names.includes(n)) continue;
        if (!possible([...(loc.conditions ?? []), ...r.conditions])) continue;
        if (canonicalSysrootImport(l, loc.crate)) continue;
        const manifest = loc.crate.deps.get(l.targetName);
        if (
          !manifest ||
          !packages.some((c) => c.kind === "lib" && c.manifest === manifest)
        )
          return false;
        if (
          readableMacroUseBinds(n, loc.crate.root, "", [
            { crate: l.targetName, names: r.names },
          ])
        )
          return false;
      }
    // (b) Path-based scope: explicit `use` items in this block, function and
    // module and each enclosing one, resolved in the macro namespace. Globs
    // are not consulted: a glob that brings in a macro named like a standard
    // prelude macro is an ambiguity error (E0659) wherever it is (crate root,
    // child module, block; workspace, builtin or external target), so in
    // code that compiles a glob never rebinds one (controls4/glob).
    let local = scope;
    for (;;) {
      const uses = importsByScope.get(`${file}|${local}`);
      for (const l of uses?.explicit.get(n) ?? [])
        if (!importBindsNoMacro(l, n, loc, local)) return false;
      if (!local || local === loc.local) break;
      local = local.includes("::")
        ? local.slice(0, local.lastIndexOf("::"))
        : "";
    }
    // Items of the module itself (a crate-root `#[macro_export]` macro, a
    // `pub(crate) use` re-export) found by the ordinary path lookup. The
    // imports themselves were resolved above.
    const found = find(n, loc, scope, "macro");
    return !found.symbols.length && !found.failedFiles?.length;
  }
  /** A path starting at a dependency outside the workspace: its contents are
   * not captured, so "resolves to nothing" proves nothing there. */
  const outsideWorkspace = (path: string, loc: Place): boolean => {
    const head = path.replace(/^::/, "").split("::")[0]!;
    if (["crate", "self", "super"].includes(head)) return false;
    const manifest = loc.crate.deps.get(head);
    if (manifest)
      return !packages.some((c) => c.kind === "lib" && c.manifest === manifest);
    // A registry, git or other dependency with no captured workspace crate.
    return (loc.crate.dependencies ?? []).some((e) => e.name === head);
  };
  /** `use path as n;` binds no macro: the standard macro's own path, or a
   * workspace path that resolves completely, in the macro namespace, to
   * nothing. A path into a crate outside the workspace fails closed. */
  function importBindsNoMacro(
    l: GraphLink,
    n: string,
    loc: Place,
    local: string,
  ): boolean {
    if (!possible([...(loc.conditions ?? []), ...conditionsFor(l)]))
      return true;
    const target = compact(l.targetName).replace(/^::/, "");
    if (data(l).externCrate) return false;
    // `use std::vec;` names std's own `vec` (module and the same macro).
    if (
      new RegExp(`^(?:std|core|alloc)::${n}$`).test(target) &&
      !visiblePrefixes.has(target.split("::")[0]!)
    )
      return true;
    if (outsideWorkspace(target, loc)) return false;
    const r = findUsePath(target, loc, local, "macro");
    return r.complete && !r.symbols.length && !r.failedFiles?.length;
  }
  /** Is `name`, written at this point, the standard (or builtin) macro? */
  const standardSafe = (
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
  ): boolean => {
    const bare = name.replace(/^::/, "");
    if (bare.includes("::")) {
      // `std::name!`: only the path's first segment can be rebound.
      const head = bare.split("::")[0]!,
        last = bare.split("::").at(-1)!;
      return (
        sysrootNames.has(head) &&
        !visiblePrefixes.has(head) &&
        (!!standardMacroName(bare) ||
          consumingBuiltins.has(last) ||
          last === "format_args")
      );
    }
    return (
      (!!standardMacroName(bare) ||
        consumingBuiltins.has(bare) ||
        bare === "format_args") &&
      standardAt(bare, site, loc, scope)
    );
  };
  /** A macro name whose head an enclosing expansion's `use` may rebind. */
  const rebound = (name: string, uses: ReadonlySet<string>): boolean =>
    uses.has("*") || uses.has(name.replace(/^::/, "").split("::")[0]!);
  /**
   * Invoked inside another macro's expansion, `name` can neither define an
   * item, rebind a name in the group it lands in, nor remove code: a safe
   * standard or builtin macro, or a readable workspace macro that is neutral
   * and clean and invokes only harmless macros. Unreadable: not harmless.
   */
  function harmless(
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
    from: GraphSymbol | undefined,
    seen: Set<string>,
    uses: ReadonlySet<string>,
  ): boolean {
    if (rebound(name, uses)) return false;
    if (standardSafe(name, site, loc, scope)) return true;
    const s = definiteMacro(name, site, loc, scope, from);
    if (!s || seen.has(s.id) || seen.size > 16) return false;
    const profile = profileOf(s)!;
    return profile.neutral && expansionProved(s, site, loc, scope, seen, uses);
  }
  /** The expansion of `s` itself is clean and every macro it invokes is harmless. */
  function expansionProved(
    s: GraphSymbol,
    site: GraphLink,
    loc: Place,
    scope: string,
    seen: Set<string>,
    uses: ReadonlySet<string>,
  ): boolean {
    const profile = profileOf(s)!;
    const next = new Set([...seen, s.id]);
    const inner = new Set([...uses, ...profile.useNames]);
    return (
      profile.clean &&
      profile.bodyMacros.every((m) =>
        harmless(m.name, site, loc, scope, s, next, inner),
      )
    );
  }
  /**
   * Names that may shadow call-site names in tokens forwarded through `name`
   * into a standard format macro; null when the forwarding is unproved.
   */
  function forwardShadow(
    name: string,
    site: GraphLink,
    loc: Place,
    scope: string,
    from?: GraphSymbol,
    seen = new Set<string>(),
    uses: ReadonlySet<string> = new Set(),
  ): Set<string> | null {
    if (rebound(name, uses)) return null;
    const std = standardFormatName(name);
    if (
      std &&
      formatStandardMacros.has(std) &&
      standardSafe(name, site, loc, scope)
    )
      return new Set();
    const s = definiteMacro(name, site, loc, scope, from);
    if (!s || seen.has(s.id) || seen.size > 16) return null;
    const profile = profileOf(s)!;
    if (!profile.forwards || !expansionProved(s, site, loc, scope, seen, uses))
      return null;
    const shadow = new Set(profile.forwardShadow);
    const inner = new Set([...uses, ...profile.useNames]);
    for (const target of profile.forwards) {
      const found = forwardShadow(
        target,
        site,
        loc,
        scope,
        s,
        new Set([...seen, s.id]),
        inner,
      );
      if (!found) return null;
      for (const x of found) shadow.add(x);
    }
    return shadow;
  }

  // Compute provenance before adding prospective macro-opacity scopes. An
  // exemption cannot use the opacity it is deciding as its own premise.
  const ecosystemSafe = new Set<string>();
  for (const f of ctx.files)
    for (const entry of (data(f.result).standardMacroScopes ?? []) as {
      name: string;
      scope: string;
      start?: number;
    }[])
      if (
        ownerPlace(f.path, entry.scope).every((loc) => {
          if (standardMacroName(entry.name)) {
            // Only a standard name rebound by a workspace macro is decided here.
            const site = macroSites.get(`${f.path}|${entry.start}`);
            return (
              !!site &&
              standardUnsafe(entry, f.path, loc) &&
              projectNeutral(entry.name, site, siteLoc(site, loc), entry.scope)
            );
          }
          if (ecosystemProven(entry, loc)) return true;
          const site = macroSites.get(`${f.path}|${entry.start}`);
          return (
            !!site &&
            projectNeutral(entry.name, site, siteLoc(site, loc), entry.scope)
          );
        })
      )
        ecosystemSafe.add(`${f.path}|${entry.start}`);
  memo.clear();
  unprovedImports.clear();
  const unsafeStandardScopes = new Set<string>();
  for (const f of ctx.files)
    for (const loc of ownerPlace(f.path, "")) {
      for (const entry of (data(f.result).standardMacroScopes ?? []) as {
        name: string;
        scope: string;
        start?: number;
        block?: true;
      }[])
        if (
          !standardMacroName(entry.name)
            ? !ecosystemSafe.has(`${f.path}|${entry.start}`)
            : standardUnsafe(entry, f.path, loc) &&
              !ecosystemSafe.has(`${f.path}|${entry.start}`)
        ) {
          opaqueScopes.add(`${loc.crate.root}|${qualified(loc, entry.scope)}`);
          // A module-level macro cannot bind a function's locals; the
          // binding fallback applies only below a block statement (R1-K).
          if (entry.block) unsafeStandardScopes.add(`${f.path}|${entry.scope}`);
        }
      for (const scope of (data(f.result).opaqueItemScopes ?? []) as string[])
        opaqueScopes.add(`${loc.crate.root}|${qualified(loc, scope)}`);
      for (const e of (data(f.result).opaqueAttributes ?? []) as {
        scope: string;
        raw: string;
        module: string;
        conditions?: string[];
        name: string;
        helper?: true;
        nested?: boolean;
      }[])
        if (e.helper) deferredHelpers.push({ ...e, file: f.path });
        else if (opaqueAttribute(e.raw, loc, e.scope, e.conditions ?? [])) {
          const q = qualified(loc, e.scope);
          opaqueScopes.add(`${loc.crate.root}|${q}`);
          if (e.module)
            opaqueScopes.add(
              `${loc.crate.root}|${[q, e.module].filter(Boolean).join("::")}`,
            );
        }
    }
  memo.clear();
  unprovedImports.clear();
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
  helperReady = true;
  itemPresenceCache.clear();
  attributeShadowCache.clear();
  memo.clear();
  unprovedImports.clear();
  lookupFactsFinal = true;
  for (const origin of deferredHelpers)
    if (helperShadowed(origin))
      for (const loc of ownerPlace(origin.file, origin.scope)) {
        const key = `${loc.crate.root}|${qualified(loc, origin.scope)}`;
        if (!opaqueScopes.has(key)) {
          opaqueScopes.add(key);
          clearIncompleteLookups();
        }
      }
  itemPresenceCache.clear();
  helperCache.clear();
  memo.clear();
  unprovedImports.clear();
  clearIncompleteLookups();
  if (markPresence)
    for (const symbol of symbols) {
      const attributes = itemPresence(symbol);
      markPresence(symbol, attributes, conditionsFor(symbol));
    }
  const scopedMembers = (s: GraphSymbol) => membersByOwner.get(s.id) ?? [];
  const unknownImpls = new Map<string, GraphSymbol[]>(),
    unknownInherent = new Set<string>();
  const memberOwners = new Map<string, GraphSymbol>();
  const allMembers = new Map<string, GraphSymbol[]>();
  const defaultMembers = new Map<string, GraphSymbol[]>();
  const unknownTraitRoots = new Set<string>();
  const foreignTraits = new Map<string, Set<string>>();
  const unknownForeignTraits = new Set<string>();
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
      // C-10: impls of traits declared outside the checkout, by self type.
      if (
        data(impl).trait &&
        (!trait.complete || !trait.symbols.some((t) => t.kind === "trait"))
      ) {
        const traitName = lastSegment(str(data(impl).trait));
        const owners = targets.symbols.filter((t) =>
          ["struct", "enum"].includes(t.kind),
        );
        if (ex.unknown || !targets.complete || !owners.length)
          unknownForeignTraits.add(traitName);
        for (const t of owners)
          foreignTraits.set(
            t.id,
            new Set([...(foreignTraits.get(t.id) ?? []), traitName]),
          );
      }
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
    /** C-10: where the receiver type is written, when not at the call. */
    typeLoc: Place = loc,
    /** C-10: the call site, which enables the autoref probe step. */
    site?: { file: string; scope: string },
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
      typeLoc,
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
                typeLoc,
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
    const stepBase =
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
      !unknownInherentExists;
    const firstStep =
      stepBase &&
      proven.every((m) => form(m) === borrow && !conditions(m).length);
    // C-10: an owned receiver reaches a `&self`/`&mut self` inherent method
    // at the autoref step, after every by-value (and, for `&mut self`, every
    // `&self`) candidate of a trait in scope. Definite only when no such trait
    // candidate can exist at the call site.
    const autoref =
      !firstStep &&
      !!site &&
      stepBase &&
      borrow === "owned" &&
      unique(proven.map((m) => m.symbol)).length === 1 &&
      proven.every(
        (m) =>
          (form(m) === "shared" || form(m) === "mutable") &&
          !conditions(m).length,
      ) &&
      autorefClear(name, form(proven[0]!), type.symbols, loc, site);
    if (instance) {
      if (
        (firstStep || autoref) &&
        unique(proven.map((m) => m.symbol)).length === 1
      )
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
  // C-10: imports that could bring a trait into scope at a call site.
  const importsInScope = new Map<string, GraphLink[]>();
  for (const l of ctx.links)
    if (l.kind === "imports") {
      const k = `${l.file}|${str(data(l).scope)}`;
      const list = importsInScope.get(k) ?? [];
      list.push(l);
      importsInScope.set(k, list);
    }
  const parentScope = (s: string) =>
    s.includes("::") ? s.slice(0, s.lastIndexOf("::")) : "";
  function standardPath(path: string, loc: Place, scope: string): boolean {
    const head = path.replace(/^::/, "").split("::")[0]!;
    return (
      ["std", "core", "alloc"].includes(head) &&
      !loc.crate.deps.has(head) &&
      !opaqueStandardRoots.get(loc.crate.root)?.has(head) &&
      !find(head, loc, scope, "type").symbols.length
    );
  }
  type TraitRisk = {
    other: boolean;
    standard: Set<string>;
    standardGlob: boolean;
    glob: boolean;
  };
  const riskCache = new Map<string, TraitRisk>();
  /**
   * Traits a `use` could bring into scope from `scope` up to its module:
   * standard traits by name, any checkout-resolved name (whose traits are
   * known), and anything else as an unknown trait source.
   */
  function traitRisk(scope: string, place: Place, depth = 0): TraitRisk {
    const key = `${place.file}|${place.crate.root}|${place.local}|${scope}`;
    const cached = riskCache.get(key);
    if (cached) return cached;
    const risk: TraitRisk = {
      other: false,
      standard: new Set(),
      standardGlob: false,
      glob: false,
    };
    // A glob cycle is not proved here; the provisional entry says so.
    riskCache.set(key, { ...risk, other: true });
    let s = scope;
    while (true) {
      if (opaqueScopes.has(`${place.crate.root}|${qualified(place, s)}`))
        risk.other = true;
      for (const l of importsInScope.get(`${place.file}|${s}`) ?? []) {
        const d = data(l);
        if (d.externCrate) continue;
        const raw = compact(l.targetName).replace(/::\*$/, "");
        if (d.glob) risk.glob = true;
        if (standardPath(raw, place, s)) {
          if (d.glob) risk.standardGlob = true;
          else risk.standard.add(lastSegment(raw));
          continue;
        }
        if (d.glob) {
          const target = find(raw, place, s, "type");
          if (
            depth >= 3 ||
            !target.complete ||
            !target.symbols.length ||
            target.failedFiles?.length
          ) {
            risk.other = true;
            continue;
          }
          for (const m of target.symbols) {
            if (m.kind === "enum") continue;
            const bodies =
              m.kind !== "module"
                ? []
                : data(m).unit
                  ? [roots.get(m.file)!].filter(Boolean)
                  : (modulePlaces.get(m.id) ?? []);
            if (!bodies.length) risk.other = true;
            for (const body of bodies) {
              const inner = traitRisk(body.local, body, depth + 1);
              risk.other ||= inner.other;
              risk.standardGlob ||= inner.standardGlob;
              risk.glob ||= inner.glob;
              for (const n of inner.standard) risk.standard.add(n);
            }
          }
          continue;
        }
        const name = compact(l.targetName);
        activeMacroImports.push(l);
        let r: Found;
        try {
          r = findUsePath(
            name,
            place,
            s,
            "import",
            new Set(),
            true,
            false,
            !name.includes("::") && d.alias === name,
          );
        } finally {
          activeMacroImports.pop();
        }
        if (
          !r.complete ||
          !r.symbols.length ||
          r.failedFiles?.length ||
          r.possibleImportNames?.length
        )
          risk.other = true;
      }
      if (!s || s === place.local || !s.startsWith(place.local)) break;
      s = parentScope(s);
    }
    riskCache.set(key, risk);
    return risk;
  }
  let checkoutTraitMethodNames: Set<string> | undefined;
  /**
   * The traits a type implements outside the checkout's own traits: written
   * impls, derives, and (for an attribute that can generate code) unknown.
   */
  function implementedOutside(t: GraphSymbol): {
    names: Set<string>;
    unknown: boolean;
  } {
    const names = new Set([
      ...(foreignTraits.get(t.id) ?? []),
      ...unknownForeignTraits,
    ]);
    let unknown = false;
    for (const a of (data(t).attributes ?? []) as string[]) {
      const head = /^#!?\[\s*([\w]+)/.exec(a)?.[1] ?? "";
      if (head === "cfg_attr") {
        const inner = a.replace(/^#!?\[\s*cfg_attr\s*\(/, "");
        const parts = inner.slice(inner.indexOf(",") + 1);
        if (
          /\b(?!derive\b|serde\b|doc\b|allow\b)[A-Za-z_]\w*\s*[([\]]/.test(
            parts.replace(/derive\s*\([^()]*\)/g, ""),
          ) ||
          !/\(/.test(parts)
        )
          unknown = true;
      } else if (!inertItemAttributes.has(head)) unknown = true;
      for (const m of a.matchAll(/\bderive\s*\(([^()]*)\)/g))
        for (const x of m[1]!.split(","))
          if (x.trim()) {
            names.add(lastSegment(x));
            if (!standardDerives.has(lastSegment(x))) unknown = true;
          }
    }
    return { names, unknown };
  }
  /** C-10: no by-value (or, for `&mut self`, `&self`) trait candidate. */
  function autorefClear(
    name: string,
    form: string,
    types: GraphSymbol[],
    loc: Place,
    site: { file: string; scope: string },
  ): boolean {
    if (blanketValueMethods.has(name)) return false;
    if (form === "mutable" && blanketRefMethods.has(name)) return false;
    checkoutTraitMethodNames ??= new Set(
      symbols
        .filter((s) => s.kind === "trait")
        .flatMap(scopedMembers)
        .map((m) => m.name),
    );
    if (checkoutTraitMethodNames.has(name)) return false;
    if (unknownMethods(loc.crate.root, name).length) return false;
    // Unreadable code in reach could declare or import a candidate.
    if (relevantFailures(loc.crate.root).length) return false;
    if (loc.file !== site.file) return false;
    const risk = traitRisk(site.scope, loc);
    if (risk.other) return false;
    for (const t of types) {
      // A written impl of a trait whose methods are not known (it resolves
      // neither to the checkout nor to a known standard trait) is unproved.
      for (const trait of [
        ...(foreignTraits.get(t.id) ?? []),
        ...unknownForeignTraits,
      ])
        if (!preludeTraitMethods[trait] && !standardTraitMethods[trait])
          return false;
      const { names, unknown } = implementedOutside(t);
      if (unknown && (risk.standardGlob || risk.standard.size)) return false;
      // Code generated next to the type can declare a trait in its module.
      if (unknown && (t.file === site.file || risk.glob)) return false;
      const value = new Set<string>(),
        ref = new Set<string>();
      const add = (table: { value: string; ref: string }) => {
        for (const x of table.value.split(" ")) if (x) value.add(x);
        for (const x of table.ref.split(" ")) if (x) ref.add(x);
      };
      if (unknown)
        for (const k in preludeTraitMethods) add(preludeTraitMethods[k]!);
      for (const trait of names) {
        const prelude = preludeTraitMethods[trait];
        if (prelude) {
          add(prelude);
          continue;
        }
        if (!risk.standardGlob && !risk.standard.has(trait)) continue;
        const standard = standardTraitMethods[trait];
        if (!standard) return false;
        add(standard);
      }
      if (value.has(name)) return false;
      if (form === "mutable" && ref.has(name)) return false;
    }
    return true;
  }
  /** A bare standard prelude type name not rebound at this scope. */
  function preludeType(name: string, loc: Place, scope: string): boolean {
    if (loc.noImplicitPrelude) return false;
    const f = find(name, loc, scope, "type");
    if (
      !f.complete ||
      f.symbols.length ||
      f.failedFiles?.length ||
      f.possibleImportNames?.length
    )
      return false;
    let s = scope;
    while (true) {
      for (const l of importsInScope.get(`${loc.file}|${s}`) ?? [])
        if (
          data(l).glob ||
          compact(str(data(l).alias)) === name ||
          lastSegment(l.targetName) === name
        )
          return false;
      if (!s || s === loc.local || !s.startsWith(loc.local)) break;
      s = parentScope(s);
    }
    return true;
  }
  type Typed = {
    text: string;
    loc: Place;
    scope: string;
    generics: string;
    borrow: string;
    mutable: boolean;
    syntax: string;
    future?: boolean;
  };
  type Typing = Typed | { gap: string };
  const isGap = (t: Typing): t is { gap: string } => "gap" in t;
  const placeIds = new WeakMap<Place, number>();
  let placeCount = 0;
  const placeId = (p: Place) => {
    let id = placeIds.get(p);
    if (id === undefined) placeIds.set(p, (id = placeCount++));
    return id;
  };
  const typingCache = new Map<string, Typing>();
  /** Split one leading reference; a second reference level is not typed. */
  function splitReference(
    text: string,
  ): { text: string; borrow: string } | null {
    text = text.trim();
    const m = text.match(
      /^&\s*(?:'[_\p{ID_Start}][_\p{ID_Continue}]*\s*)?(mut\b\s*)?/u,
    );
    if (!m) return { text, borrow: "owned" };
    const rest = text.slice(m[0].length).trim();
    return rest.startsWith("&")
      ? null
      : { text: rest, borrow: m[1] ? "mutable" : "shared" };
  }
  /** Shapes the method lookup can name; others report their gap. */
  function shapeGap(text: string, generics: string): string | undefined {
    const t = text.trim();
    if (!t) return "unit-return";
    if (/^impl\b/.test(t)) return "impl-trait";
    if (/^dyn\b/.test(t)) return "trait-object";
    if (/^[([*!_]|^fn\b|^unsafe\b|^extern\b/.test(t)) return "aggregate";
    if (generics.split(",").includes(compact(t))) return "generic";
    if (/^Self::|<\s*Self\b|\bSelf::/.test(t)) return "associated-type";
    if (
      /^(?:[\w]+::)*[A-Z]\w*::[A-Z]\w*$/.test(t) &&
      generics.split(",").includes(t.split("::")[0]!)
    )
      return "associated-type";
    return undefined;
  }
  function declarationPlace(s: GraphSymbol): Place | undefined {
    const places = ownerPlace(s.file, str(data(s).scope));
    return places.length === 1 ? places[0] : undefined;
  }
  /** The written result type of a definite callee. */
  function resultOf(s: GraphSymbol): Typing {
    if (failedFiles.has(s.file) || itemPresence(s).length)
      return { gap: "callee-unverified" };
    const place = declarationPlace(s);
    if (!place) return { gap: "declaration-placement" };
    if (s.kind === "struct")
      return data(s).constructorForm === "tuple"
        ? {
            text: s.name,
            loc: place,
            scope: str(data(s).scope),
            generics: "",
            borrow: "owned",
            mutable: true,
            syntax: "",
          }
        : { gap: "callee-kind" };
    if (!["function", "method"].includes(s.kind) || !("returnType" in data(s)))
      return { gap: "callee-kind" };
    let text = str(data(s).returnType);
    const generics = str(data(s).signatureGenerics);
    if (/\bSelf\b/.test(text)) {
      const owner = memberOwners.get(s.id);
      if (owner?.kind !== "impl" || !str(data(owner).implType))
        return { gap: "trait-self" };
      if (/\bSelf\s*::/.test(text)) return { gap: "associated-type" };
      text = text.replace(/\bSelf\b/g, str(data(owner).implType));
    }
    const ref = splitReference(text);
    if (!ref) return { gap: "reference-to-reference" };
    const gap = shapeGap(ref.text, generics);
    if (gap) return { gap: gap === "generic" ? "generic-return" : gap };
    return {
      text: ref.text,
      loc: place,
      scope: str(data(s).scope),
      generics,
      borrow: ref.borrow,
      mutable: true,
      syntax: "",
      ...(data(s).async === true ? { future: true } : {}),
    };
  }
  /** A written standard `Result<T, E>` or `Option<T>`: its first argument. */
  function standardWrapper(
    raw: string,
    loc: Place,
    scope: string,
  ): string | undefined {
    const text = withoutLifetimes(raw);
    const m =
      /^((?:::)?(?:std|core)::(?:result|option)::)?(Result|Option)\s*</.exec(
        text,
      );
    if (
      !m ||
      (m[1] ? !standardPath(text, loc, scope) : !preludeType(m[2]!, loc, scope))
    )
      return undefined;
    const args = splitArguments(text.slice(text.indexOf("<")));
    return args && args.length === (m[2] === "Result" ? 2 : 1)
      ? args[0]!
      : undefined;
  }
  function payload(
    raw: string,
    loc: Place,
    scope: string,
    generics: string,
  ): Typing {
    const ref = splitReference(raw);
    if (!ref) return { gap: "reference-to-reference" };
    const gap = shapeGap(ref.text, generics);
    if (gap) return { gap: gap === "generic" ? "generic-return" : gap };
    return {
      text: ref.text,
      loc,
      scope,
      generics,
      borrow: ref.borrow,
      mutable: true,
      syntax: "",
    };
  }
  /**
   * `?` on a standard `Result`/`Option` written directly or through one
   * checkout alias (`type Result<T = ()> = std::result::Result<T, Error>`).
   * An alias argument keeps the scope it is written in.
   */
  function unwrapTry(t: Typed): Typing {
    if (t.future || t.borrow !== "owned") return { gap: "try-wrapper" };
    const direct = standardWrapper(t.text, t.loc, t.scope);
    if (direct !== undefined)
      return payload(direct, t.loc, t.scope, t.generics);
    const text = withoutLifetimes(t.text);
    const found = find(text, t.loc, t.scope, "type");
    const alias = found.symbols[0];
    const place = alias && declarationPlace(alias);
    if (
      !found.complete ||
      found.failedFiles?.length ||
      found.symbols.length !== 1 ||
      alias?.kind !== "type" ||
      itemPresence(alias).length ||
      !place
    )
      return { gap: "try-wrapper" };
    const aliasScope = str(data(alias).scope);
    const first = standardWrapper(
      str(data(alias).aliasType),
      place,
      aliasScope,
    );
    if (first === undefined) return { gap: "try-wrapper" };
    const defaults = (data(alias).genericDefaults ?? []) as (string | null)[];
    const params = ((data(alias).generics ?? []) as string[])
      .map((p, i) => [p.split("=")[0]!.trim(), defaults[i] ?? null] as const)
      .filter(([p]) => !p.startsWith("'"));
    const args = text.includes("<")
      ? splitArguments(text.slice(text.indexOf("<")))
      : [];
    if (!args || args.length > params.length) return { gap: "try-wrapper" };
    const index = params.findIndex(([p]) => p === compact(first));
    if (index >= 0)
      return index < args.length
        ? payload(args[index]!, t.loc, t.scope, t.generics)
        : params[index]![1] !== null
          ? payload(params[index]![1]!, place, aliasScope, "")
          : { gap: "try-wrapper" };
    if (identifiers(first).some((x) => params.some(([p]) => p === x)))
      return { gap: "try-wrapper" };
    return payload(first, place, aliasScope, "");
  }
  /** The declared type of a named field of a checkout struct. */
  function fieldOf(t: Typed, name: string, loc: Place): Typing {
    if (t.future) return { gap: "future-receiver" };
    const ex = expandType(
      t.text,
      t.loc,
      t.scope,
      new Set(),
      new Set(t.generics.split(",").filter(Boolean)),
    );
    if (ex.unknown || ex.externalShape) return { gap: "field-owner" };
    const found = find(ex.text, ex.loc, ex.scope, "type");
    const s = found.symbols[0];
    if (
      !found.complete ||
      found.symbols.length !== 1 ||
      found.failedFiles?.length ||
      s?.kind !== "struct" ||
      itemPresence(s).length ||
      !Array.isArray(data(s).fields)
    )
      return { gap: "field-owner" };
    const entry = (data(s).fields as string[][]).find((f) => f[0] === name);
    if (!entry) return { gap: "field-unknown" };
    const place = declarationPlace(s);
    if (!place) return { gap: "declaration-placement" };
    if (!visible(entry[2]!, place, loc)) return { gap: "field-private" };
    const ref = splitReference(entry[1]!);
    if (!ref) return { gap: "reference-to-reference" };
    const generics = ((data(s).typeGenerics ?? []) as string[]).join(",");
    const gap = shapeGap(ref.text, generics);
    if (gap) return { gap: gap === "generic" ? "generic-field" : gap };
    const scope = str(data(s).scope);
    return {
      text: ref.text,
      loc: place,
      scope: scope ? `${scope}::${s.name}` : s.name,
      generics,
      borrow: ref.borrow,
      mutable: t.borrow !== "shared" && t.mutable,
      syntax: "",
    };
  }
  /**
   * C-10: an identifier pattern is a path pattern, not a binding, when the
   * name resolves to a constant, unit struct or unit variant. The binding is
   * proved only when the lookup completes with no such item and no import
   * spelling that could supply one.
   */
  function bindsLocally(l: GraphLink, d: Data): boolean {
    const name = str((d.localBinding as Data | undefined)?.name);
    if (name === "self") return true;
    if (!name || name === "None") return false;
    const places = ownerPlace(l.file, str(d.scope));
    return (
      places.length > 0 &&
      places.every((loc) => {
        const f = find(name, loc, str(d.scope), "value");
        return (
          f.complete &&
          !f.failedFiles?.length &&
          !f.possibleImportNames?.length &&
          !f.symbols.some(
            (s) =>
              s.kind === "const" ||
              s.kind === "static" ||
              ((s.kind === "struct" || s.kind === "variant") &&
                data(s).constructorForm !== "tuple" &&
                data(s).constructorForm !== "named"),
          )
        );
      })
    );
  }
  /** A path call's callable targets: a value name or an associated item. */
  function pathCallTargets(
    name: string,
    selfPath: boolean,
    scope: string,
    d: Data,
    targetName: string,
    file: string,
    loc: Place,
  ): Found {
    let result = find(name, loc, scope, "value");
    const callableFound = result.symbols.some((s) =>
      ["function", "method", "struct", "variant"].includes(s.kind),
    );
    if (
      (!callableFound || !result.complete) &&
      !result.failedFiles?.length &&
      name.includes("::")
    ) {
      const pathSyntax = selfPath
        ? name
        : (str(d.pathSyntax) || targetName).replace(/\br#/g, "");
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
        selfPath ? `${file}|${str(d.implKey)}` : "",
        Number(d.argumentMinimum ?? d.argumentCount),
        str(d.genericBindings),
        str(selfPath ? d.implArgumentSyntax : d.pathArgumentSyntax),
      );
      result = callableFound ? merge([result, associated]) : associated;
    }
    return {
      ...result,
      symbols: result.symbols.filter(
        (s) =>
          s.kind === "function" ||
          s.kind === "method" ||
          (s.kind === "struct" && data(s).constructorForm !== "named") ||
          (s.kind === "variant" && data(s).constructorForm === "tuple"),
      ),
    };
  }
  /** One definite target or the reason there is none. */
  const single = (f: Found): GraphSymbol | undefined =>
    f.complete && !f.failedFiles?.length && unique(f.symbols).length === 1
      ? f.symbols[0]
      : undefined;
  /**
   * C-10: the type of a receiver recipe from written declarations only. A
   * method or path call in the chain must itself have one definite target.
   */
  function typing(
    r: Data,
    loc: Place,
    site: { file: string; scope: string },
    depth = 0,
  ): Typing {
    const key = `${site.file}|${site.scope}|${placeId(loc)}|${JSON.stringify(r)}`;
    const cached = typingCache.get(key);
    if (cached) return cached;
    let result: Typing;
    const inner = () =>
      depth > 32
        ? { gap: "receiver-too-long" }
        : typing((r.e ?? {}) as Data, loc, site, depth + 1);
    switch (str(r.k)) {
      case "type": {
        const ref = splitReference(str(r.t));
        result = !ref
          ? { gap: "reference-to-reference" }
          : {
              text: ref.text,
              loc,
              scope: str(r.s),
              generics: str(r.g),
              borrow: ref.borrow !== "owned" ? ref.borrow : str(r.b) || "owned",
              mutable: r.mu !== false,
              syntax: str(r.a),
            };
        break;
      }
      case "p": {
        let name = compact(str(r.p));
        const selfPath = name === "Self" || name.startsWith("Self::");
        if (selfPath && r.it) name = base(str(r.it)) + name.slice(4);
        const d: Data = {
          pathSyntax: str(r.p),
          pathArgumentSyntax: str(r.pa) || "[]",
          implType: str(r.it),
          implKey: str(r.ik),
          implArgumentSyntax: str(r.ia) || "[]",
          argumentCount: Number(r.c),
          argumentMinimum: Number(r.cm),
          genericBindings: str(r.g),
        };
        const s = single(
          pathCallTargets(
            name,
            selfPath,
            selfPath ? str(r.is) : str(r.s),
            d,
            str(r.p),
            site.file,
            loc,
          ),
        );
        result = s ? resultOf(s) : { gap: "callee-unresolved" };
        break;
      }
      case "m": {
        const t = inner();
        if (isGap(t)) result = t;
        else if (t.future) result = { gap: "future-receiver" };
        else {
          const s = single(
            methods(
              t.text,
              str(r.n),
              loc,
              t.scope,
              true,
              t.borrow,
              t.mutable,
              Number(r.c),
              "",
              Number(r.cm),
              t.generics,
              t.syntax,
              t.loc,
              site,
            ),
          );
          result = s ? resultOf(s) : { gap: "receiver-method-unresolved" };
        }
        break;
      }
      case "f": {
        const t = inner();
        result = isGap(t) ? t : fieldOf(t, str(r.n), loc);
        break;
      }
      case "ref": {
        const t = inner();
        result = isGap(t)
          ? t
          : t.borrow !== "owned" || t.future
            ? { gap: "reference-to-reference" }
            : { ...t, borrow: r.m === true ? "mutable" : "shared" };
        break;
      }
      case "deref": {
        const t = inner();
        result = isGap(t)
          ? t
          : t.borrow === "owned" || t.future
            ? { gap: "deref-owned" }
            : { ...t, mutable: t.borrow === "mutable", borrow: "owned" };
        break;
      }
      case "try": {
        const t = inner();
        result = isGap(t) ? t : unwrapTry(t);
        break;
      }
      case "await": {
        const t = inner();
        result = isGap(t)
          ? t
          : t.future
            ? { ...t, future: false }
            : { gap: "await-non-async" };
        break;
      }
      default:
        result = { gap: str(r.w) || "syntax" };
    }
    if (!isGap(result) && r.im === true && result.borrow === "owned")
      result = { ...result, mutable: false };
    typingCache.set(key, result);
    return result;
  }
  /**
   * Calls read from a macro invocation's argument tokens count only when the
   * invocation provably evaluates them as expressions at the call site: a
   * standard format macro, or a workspace macro that forwards its whole input
   * into one. Names its expansion binds around them must not be the head.
   */
  function argumentsProven(l: GraphLink, d: Data, loc: Place): boolean {
    const starts = (d.macroArguments ?? []) as number[],
      names = (d.macroArgumentNames ?? []) as string[];
    const site = macroSites.get(`${l.file}|${starts[0]}`);
    if (!site || !names.length || names.length !== starts.length) return false;
    const scope = str(d.scope),
      at = siteLoc(site, loc),
      shadow = new Set<string>();
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      const here =
        i === 0
          ? site
          : { ...site, range: { start: starts[i]!, end: starts[i]! } };
      if (standardFormatName(name) === "matches") {
        if (standardUnsafe({ name, scope, start: starts[i]! }, l.file, at))
          return false;
        continue;
      }
      if (i > 0 && !standardFormatName(name)) return false;
      const inner = forwardShadow(name, here, at, scope);
      if (!inner) return false;
      for (const x of inner) shadow.add(x);
    }
    // A standard macro nested in the arguments is looked up inside the
    // expansion too: a `use` there may rebind it.
    if (names.slice(1).some((n) => rebound(n, shadow))) return false;
    const head = compact(l.targetName)
      .replace(/^::/, "")
      .split(d.method ? /[.([?]/ : /::/)[0]!;
    return !shadow.has("*") && !shadow.has(head);
  }
  const resolutions: LinkResolution[] = [];
  for (const l of ctx.links) {
    let d = data(l);
    let scope = str(d.scope);
    let unsafe = false;
    while (true) {
      unsafe ||= unsafeStandardScopes.has(`${l.file}|${scope}`);
      if (!scope) break;
      scope = scope.includes("::")
        ? scope.slice(0, scope.lastIndexOf("::"))
        : "";
    }
    if (unsafe)
      d = {
        ...d,
        blocked: d.blocked || d.stdFallbackBlocked || false,
        conditionalBinding:
          d.conditionalBinding || d.stdFallbackConditional || false,
        receiverType: d.stdFallbackReceiverUnknown
          ? ""
          : (d.receiverType ?? ""),
      };
    let found: Found = empty();
    let note: Record<string, Json> | undefined;
    if (l.kind === "contains")
      found = {
        symbols: [byLocalKey.get(`${l.file}|${str(d.key)}`)!].filter(Boolean),
        complete: true,
      };
    else if (l.kind === "modules") {
      const s = byLocalKey.get(`${l.file}|${str(d.key)}`);
      const failed = (s ? (modulePlaces.get(s.id) ?? []) : [])
        .filter((p) => failedFiles.has(p.file) && !p.directoryUnverified)
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
      // C-10: a proved local binding or generic parameter. The reference
      // targets the declaring function or generic item.
      d.blocked &&
      !d.method &&
      !d.conditionalBinding &&
      ((["values", "calls"].includes(l.kind) &&
        !!d.localBinding &&
        !(unsafe && d.stdFallbackLocalUnknown)) ||
        (["values", "types"].includes(l.kind) && !!d.typeParameter))
    ) {
      const target = d.localBinding
        ? byLocalKey.get(`${l.file}|${l.sourceKey ?? ""}`)
        : byLocalKey.get(`${l.file}|${str(d.typeParameterOwner)}`);
      found =
        target && (!d.localBinding || bindsLocally(l, d))
          ? { symbols: [target], complete: true }
          : empty();
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
          const guard = (r: Found): Found =>
            !d.macroArguments ||
            r.failedFiles?.length ||
            argumentsProven(l, d, loc)
              ? r
              : {
                  ...r,
                  complete: false,
                  reason: [
                    ...new Set(
                      [
                        ...(r.reason?.split(/;\s*/) ?? []),
                        "macro-argument-unverified",
                      ].filter(Boolean),
                    ),
                  ].join("; "),
                };
          if (d.method) {
            const site = { file: l.file, scope: str(d.scope) };
            if (
              !str(d.receiverType) &&
              d.receiverExpr &&
              !(unsafe && d.stdFallbackReceiverExprUnknown)
            ) {
              const t = typing(d.receiverExpr as Data, loc, site);
              if (isGap(t) || t.future) {
                note ??= {
                  receiverTyping: {
                    gap: isGap(t) ? t.gap : "future-receiver",
                  },
                };
              } else {
                const own = find(t.text, t.loc, t.scope, "type");
                if (own.complete && !own.symbols.length)
                  note ??= { receiverTyping: { outside: compact(t.text) } };
                return guard(
                  methods(
                    t.text,
                    str(d.method),
                    loc,
                    t.scope,
                    true,
                    t.borrow,
                    t.mutable,
                    Number(d.argumentCount),
                    "",
                    Number(d.argumentMinimum ?? d.argumentCount),
                    t.generics,
                    t.syntax,
                    t.loc,
                    site,
                  ),
                );
              }
            }
            return guard(
              methods(
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
                loc,
                site,
              ),
            );
          }
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
          if (l.kind === "calls")
            return guard(
              pathCallTargets(
                name,
                selfPath,
                scope,
                d,
                l.targetName,
                l.file,
                loc,
              ),
            );
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
          if (l.kind === "patterns")
            result = {
              ...result,
              symbols: result.symbols.filter((s) =>
                ["variant", "struct", "type", "const", "static"].includes(
                  s.kind,
                ),
              ),
            };
          return guard(result);
        }),
      );
    }
    if (note) annotate?.(l, note);
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
  if (derived) macroBodyCalls(derived);
  return resolutions;

  /** Resolve a path call written in a macro body, as at a call site. */
  function bodyCall(
    path: string,
    argumentCount: number,
    loc: Place,
    scope: string,
  ): Found {
    let result = find(path, loc, scope, "value");
    const callable = result.symbols.some((s) =>
      ["function", "method", "struct", "variant"].includes(s.kind),
    );
    if (
      (!callable || !result.complete) &&
      !result.failedFiles?.length &&
      path.includes("::")
    ) {
      const split = path.lastIndexOf("::");
      const associated = methods(
        path.slice(0, split),
        path.slice(split + 2),
        loc,
        scope,
        false,
        "owned",
        true,
        argumentCount,
        "",
        argumentCount,
        "",
        "[]",
      );
      result = callable ? merge([result, associated]) : associated;
    }
    result = {
      ...result,
      symbols: result.symbols.filter(
        (s) =>
          s.kind === "function" ||
          s.kind === "method" ||
          (s.kind === "struct" && data(s).constructorForm !== "named") ||
          (s.kind === "variant" && data(s).constructorForm === "tuple"),
      ),
    };
    if (result.complete && result.symbols.some((s) => itemPresence(s).length))
      result = {
        ...result,
        complete: false,
        reason: "item-under-opaque-attribute",
      };
    return result;
  }
  /**
   * R1-K: a call written in a workspace `macro_rules!` body happens wherever
   * the macro is invoked. For each invocation that names one readable
   * definition, derive a call link from the invoking item, resolved at the
   * invocation (call-site names; `$crate::` in the defining crate). It is
   * definite only when the macro has one arm and nothing in the expansion
   * could rebind the name; otherwise it is unresolved with the would-be
   * targets. Calls with no workspace target are not derived.
   */
  function macroBodyCalls(emit: (link: AddedLink) => void): void {
    for (const site of ctx.links) {
      if (site.kind !== "macros") continue;
      const d = data(site),
        scope = str(d.scope);
      const places = ownerPlace(site.file, scope);
      if (places.length !== 1) continue;
      const loc: Place = {
        ...places[0]!,
        conditions: [
          ...(places[0]!.conditions ?? []),
          ...((d.conditions ?? []) as string[]),
        ],
      };
      if (((d.conditions ?? []) as string[]).some((c) => c.includes("?")))
        continue;
      const first = definiteMacro(compact(site.targetName), site, loc, scope);
      if (!first) continue;
      const generics = str(d.genericBindings).split(",").filter(Boolean);
      let index = 0;
      // Every property is one of the whole path from the invocation down to
      // the call, carried through each nested macro: arms proven, expansion
      // proved (clean, nested macros harmless), not under a repetition, no
      // function-local definition on the way, `use` names in force.
      const visit = (
        m: GraphSymbol,
        shadow: string[],
        armsKnown: boolean,
        seen: Set<string>,
        expansionKnown: boolean,
        pathRepeated: boolean,
        pathLocal: boolean,
        uses: ReadonlySet<string>,
      ) => {
        const profile = profileOf(m)!;
        const single = armsKnown && profile.arms === 1;
        const local = pathLocal || profile.blockLocal;
        const inner = new Set([...uses, ...profile.useNames]);
        // An attribute, an item other than `use`, or a nested macro that is
        // not provably harmless can remove the call or rebind its name.
        const proved =
          expansionKnown && expansionProved(m, site, loc, scope, seen, uses);
        for (const call of profile.calls) {
          let path = call.path,
            at = loc,
            from = scope;
          if (path.startsWith("$crate::")) {
            const home = ownerPlace(m.file, "")[0];
            if (!home) continue;
            path = "crate::" + path.slice(8);
            at = { ...home, conditions: loc.conditions ?? [] };
            from = "";
          } else if (/(^|::)Self(::|$)|\$/.test(path)) continue;
          const head = path.replace(/^::/, "").split("::")[0]!;
          // Sysroot paths have no workspace target; dropping a derived link
          // loses nothing a caller query could use.
          if (["std", "core", "alloc"].includes(head)) continue;
          const found = bodyCall(path, call.argumentCount, at, from);
          const targets = unique(found.symbols);
          const reasons: string[] = [];
          if (!found.complete)
            reasons.push(...(found.reason ?? "unverified").split(/;\s*/));
          const names = [...shadow, ...call.shadow];
          // `crate::` and `::` paths start at a root no item can shadow.
          const rooted = head === "crate" || path.startsWith("::");
          if (
            (!rooted && (names.includes("*") || names.includes(head))) ||
            (!path.startsWith("crate::") && generics.includes(head)) ||
            call.local
          )
            reasons.push("macro-body-name-unverified");
          if (!single) reasons.push("macro-arm-unverified");
          if (!proved) reasons.push("macro-expansion-unverified");
          if (call.repeated || pathRepeated)
            reasons.push("macro-repetition-unverified");
          // Read as an argument of a standard-looking macro: only if it is
          // the standard macro there, and no enclosing `use` rebinds it.
          if (
            call.within.some(
              (n) => rebound(n, inner) || !standardSafe(n, site, loc, scope),
            )
          )
            reasons.push("macro-argument-unverified");
          if (
            local &&
            !call.path.includes("::") &&
            !reasons.includes("macro-body-name-unverified")
          )
            reasons.push("macro-body-name-unverified");
          const base = {
            key: `macro-body:${site.range.start}:${index++}`,
            file: site.file,
            sourceId: site.sourceId,
            kind: "calls",
            targetName: path,
            range: site.range,
          };
          const facts = {
            scope,
            macroBody: true,
            macro: `${m.file}|${m.identity}`,
            conditions: (d.conditions ?? []) as string[],
          };
          if (found.failedFiles?.length) {
            emit({
              ...base,
              data: {
                ...facts,
                cause: { files: [...new Set(found.failedFiles)].sort() },
                uncertainty: "invalid-code",
              },
            });
            continue;
          }
          if (!targets.length) continue;
          if (!reasons.length)
            emit(
              targets.length === 1
                ? { ...base, data: facts, targetId: targets[0]!.id }
                : {
                    ...base,
                    data: facts,
                    candidateIds: targets.map((t) => t.id),
                  },
            );
          else
            emit({
              ...base,
              data: {
                ...facts,
                ...(targets.length > 16
                  ? { targetCount: targets.length }
                  : { targets: targets.map((t) => t.id).sort() }),
                uncertainty: [...new Set(reasons)].join("; "),
              },
            });
        }
        for (const nested of profile.bodyMacros) {
          // A name an enclosing `use` may rebind is not followed at all.
          if (rebound(nested.name, inner)) continue;
          const next = definiteMacro(nested.name, site, loc, scope, m);
          if (!next || seen.has(next.id) || seen.size > 8) continue;
          visit(
            next,
            [...shadow, ...nested.shadow],
            single,
            new Set([...seen, next.id]),
            proved,
            pathRepeated || nested.repeated,
            local,
            inner,
          );
        }
      };
      visit(
        first,
        [],
        true,
        new Set([first.id]),
        true,
        false,
        false,
        new Set(),
      );
    }
  }
}
