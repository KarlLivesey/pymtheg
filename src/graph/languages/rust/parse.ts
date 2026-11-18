// SPDX-License-Identifier: MIT
import { implies, possible } from "./cfg.js";
import { argumentCalls, macroProfile } from "./macro-rules.js";
import type { Node } from "web-tree-sitter";
import { fileURLToPath } from "node:url";
import { createTagsParser } from "../../tree-sitter.js";
import type { Json, ParseResult, SourceInput } from "../../types.js";

const field = (n: Node, name: string) => n.childForFieldName(name);
const span = (n: Node) => ({ start: n.startIndex, end: n.endIndex });
const compact = (s: string) => s.replace(/\s+/g, "").replace(/\br#/g, "");
/** Classify references by their syntax, never by an enclosing guard's pattern. */
function referencePosition(n: Node):
  | {
      namespace: "type" | "value" | "macro";
      pattern?: boolean;
      constructorHead?: "literal" | "pattern";
    }
  | undefined {
  let head = n;
  while (
    head.parent &&
    ["generic_type", "generic_type_with_turbofish"].includes(
      head.parent.type,
    ) &&
    field(head.parent, "type")?.id === head.id
  )
    head = head.parent;
  const parent = head.parent;
  if (!parent) return undefined;
  if (
    parent.type === "macro_invocation" &&
    field(parent, "macro")?.id === head.id
  )
    return { namespace: "macro" };
  if (
    parent.type === "struct_expression" &&
    field(parent, "name")?.id === head.id
  )
    return { namespace: "type", constructorHead: "literal" };
  if (parent.type === "struct_pattern" && field(parent, "type")?.id === head.id)
    return { namespace: "type", constructorHead: "pattern", pattern: true };
  if (
    parent.type === "tuple_struct_pattern" &&
    field(parent, "type")?.id === head.id
  )
    return { namespace: "value", pattern: true };
  // A type nested in a pattern (e.g. a constructor's generic argument) is
  // still a type. Cast types inside a match guard take this same route.
  if (
    [
      "type_identifier",
      "scoped_type_identifier",
      "generic_type",
      "generic_type_with_turbofish",
    ].includes(head.type)
  )
    return { namespace: "type" };
  if (
    [
      "identifier",
      "scoped_identifier",
      "self",
      "field_expression",
      "generic_function",
    ].includes(n.type)
  ) {
    let child = head;
    let ancestor: Node | null = parent;
    while (ancestor) {
      // Tree-sitter nests the guard in match_pattern.condition. Stop BEFORE
      // treating that wrapper as a pattern; nested let-patterns still count.
      if (
        ancestor.type === "match_pattern" &&
        field(ancestor, "condition")?.id === child.id
      )
        break;
      if (ancestor.type.endsWith("_pattern"))
        return { namespace: "value", pattern: true };
      if (
        [
          "parameter",
          "let_declaration",
          "let_condition",
          "match_arm",
          "function_item",
          "call_expression",
          "block",
        ].includes(ancestor.type)
      )
        break;
      child = ancestor;
      ancestor = ancestor.parent;
    }
    if (
      [
        "arguments",
        "block",
        "expression_statement",
        "return_expression",
        "array_expression",
        "tuple_expression",
        "binary_expression",
        "reference_expression",
        "assignment_expression",
        "match_arm",
        "field_initializer",
        "struct_expression",
        "let_declaration",
        "if_expression",
        "match_expression",
        "call_expression",
        "generic_function",
        "field_expression",
        "type_cast_expression",
        "match_pattern",
        "let_condition",
        "parenthesized_expression",
      ].includes(parent.type)
    )
      return { namespace: "value" };
  }
  return undefined;
}
export type AttributeEffect = "inert" | "conditional" | "macro" | "opaque";
export type AttributeRule = {
  category: "builtin" | "prelude" | "tool";
  effect: AttributeEffect;
  condition?: string;
  shadowing?: "visible";
};
/** One classification table. Native shadow controls pin every builtin entry. */
export const attributeRules = new Map<string, AttributeRule>([
  ["allow", { category: "builtin", effect: "inert" }],
  ["automatically_derived", { category: "builtin", effect: "inert" }],
  ["cfg", { category: "builtin", effect: "conditional" }],
  ["cfg_attr", { category: "builtin", effect: "conditional" }],
  ["cold", { category: "builtin", effect: "inert" }],
  ["collapse_debuginfo", { category: "builtin", effect: "inert" }],
  ["coverage", { category: "builtin", effect: "inert" }],
  ["crate_name", { category: "builtin", effect: "inert" }],
  ["crate_type", { category: "builtin", effect: "inert" }],
  ["debugger_visualizer", { category: "builtin", effect: "inert" }],
  ["deny", { category: "builtin", effect: "inert" }],
  ["deprecated", { category: "builtin", effect: "inert" }],
  ["doc", { category: "builtin", effect: "inert" }],
  ["expect", { category: "builtin", effect: "inert" }],
  ["export_name", { category: "builtin", effect: "inert" }],
  ["feature", { category: "builtin", effect: "inert" }],
  ["forbid", { category: "builtin", effect: "inert" }],
  ["ignore", { category: "builtin", effect: "inert" }],
  ["inline", { category: "builtin", effect: "inert" }],
  ["instruction_set", { category: "builtin", effect: "inert" }],
  ["link", { category: "builtin", effect: "inert" }],
  ["link_name", { category: "builtin", effect: "inert" }],
  ["link_ordinal", { category: "builtin", effect: "inert" }],
  ["link_section", { category: "builtin", effect: "inert" }],
  ["macro_export", { category: "builtin", effect: "inert" }],
  ["macro_use", { category: "builtin", effect: "inert" }],
  ["must_use", { category: "builtin", effect: "inert" }],
  ["naked", { category: "builtin", effect: "inert" }],
  ["no_builtins", { category: "builtin", effect: "inert" }],
  ["no_core", { category: "builtin", effect: "inert" }],
  ["no_implicit_prelude", { category: "builtin", effect: "inert" }],
  ["no_link", { category: "builtin", effect: "inert" }],
  ["no_main", { category: "builtin", effect: "inert" }],
  ["no_mangle", { category: "builtin", effect: "inert" }],
  ["no_std", { category: "builtin", effect: "inert" }],
  ["non_exhaustive", { category: "builtin", effect: "inert" }],
  ["optimize", { category: "builtin", effect: "inert" }],
  ["panic_handler", { category: "builtin", effect: "inert" }],
  ["path", { category: "builtin", effect: "inert" }],
  ["proc_macro", { category: "builtin", effect: "macro" }],
  ["proc_macro_attribute", { category: "builtin", effect: "macro" }],
  ["proc_macro_derive", { category: "builtin", effect: "macro" }],
  ["recursion_limit", { category: "builtin", effect: "inert" }],
  ["repr", { category: "builtin", effect: "inert" }],
  ["should_panic", { category: "builtin", effect: "inert" }],
  ["target_feature", { category: "builtin", effect: "inert" }],
  ["track_caller", { category: "builtin", effect: "inert" }],
  ["type_length_limit", { category: "builtin", effect: "inert" }],
  ["used", { category: "builtin", effect: "inert" }],
  ["warn", { category: "builtin", effect: "inert" }],
  ["windows_subsystem", { category: "builtin", effect: "inert" }],
  ["test", { category: "prelude", effect: "conditional", condition: "test" }],
  ["bench", { category: "prelude", effect: "conditional", condition: "test" }],
  ["derive", { category: "prelude", effect: "inert", shadowing: "visible" }],
  [
    "global_allocator",
    { category: "prelude", effect: "inert", shadowing: "visible" },
  ],
  ["test_case", { category: "prelude", effect: "opaque" }],
  ["cfg_eval", { category: "prelude", effect: "opaque" }],
  ["cfg_accessible", { category: "prelude", effect: "opaque" }],
  ["rustfmt", { category: "tool", effect: "inert" }],
  ["clippy", { category: "tool", effect: "inert" }],
  ["diagnostic", { category: "tool", effect: "inert" }],
  ["miri", { category: "tool", effect: "inert" }],
  ["rust_analyzer", { category: "tool", effect: "inert" }],
]);
/** E4: only captured bindings shadow these two heads; other heads stay strict. */
export function attributeBindingShadows(
  name: string,
  visible: boolean,
  unseen: boolean,
): boolean {
  return (
    visible ||
    (attributeRules.get(name.split("::")[0]!)?.shadowing !== "visible" &&
      unseen)
  );
}
export type MacroUseImport = { crate: string; names: string[] | null };
export function attributeEffect(
  name: string,
  shadowed = false,
): AttributeEffect {
  const head = name.split("::")[0]!,
    rule = attributeRules.get(name.includes("::") ? head : name);
  if (
    !rule ||
    (name.includes("::") && rule.category !== "tool") ||
    (rule.category === "tool" && !name.includes("::")) ||
    (rule.category !== "builtin" && shadowed)
  )
    return "opaque";
  return rule.effect;
}
export const inertAttributes = new Set(
  [...attributeRules]
    .filter(([, r]) => r.effect === "inert" && r.category !== "tool")
    .map(([n]) => n),
);
export const conditionalAttributes = new Map(
  [...attributeRules]
    .filter(([, r]) => r.condition)
    .map(([n, r]) => [n, r.condition!]),
);
export const macroDefinitionAttributes = new Set(
  [...attributeRules].filter(([, r]) => r.effect === "macro").map(([n]) => n),
);
export const knownAttributeName = (name: string, shadowed = false) =>
  attributeEffect(name, shadowed) !== "opaque";
const kinds: Record<string, string> = {
  mod_item: "module",
  function_item: "function",
  function_signature_item: "function",
  struct_item: "struct",
  enum_item: "enum",
  enum_variant: "variant",
  trait_item: "trait",
  type_item: "type",
  associated_type: "type",
  const_item: "const",
  static_item: "static",
  macro_definition: "macro",
  impl_item: "impl",
};

type Helper = Awaited<ReturnType<typeof createTagsParser>>;
let sharedHelper: Promise<Helper> | undefined;
let pending: SourceInput | undefined;

/** One grammar/query/parser per process; parse() is synchronous after loading.
 * The shared helper deletes each borrowed tree in its finally block. */
function parser(): Promise<Helper> {
  sharedHelper ??= createHelper().catch((error: unknown) => {
    sharedHelper = undefined;
    throw error;
  });
  return sharedHelper;
}
/**
 * The vendored, patched grammar (grammars/rust: upstream v0.24.2 + PRs #319,
 * #271, #317, #312, #283, #281; see its manifest.json and docs/changes/W2-V.md).
 * Resolved from this file so it works from dist/ and from the installed package.
 */
const GRAMMAR = fileURLToPath(
  new URL("../../../../grammars/rust/tree-sitter-rust.wasm", import.meta.url),
);
async function createHelper(): Promise<Helper> {
  return createTagsParser({
    wasmPath: GRAMMAR,
    // No tags query: the scoped AST pass below maps every definition and
    // reference itself, and nothing reads tags captures (definitions map to
    // nothing and there is no reference mapper). A minimal query keeps the
    // module independent of query files written for another grammar build.
    query: "(source_file) @file",
    mapDefinition: () => undefined,
    secondPass({ tree, result }) {
      const { path, text } = pending!;
      let first: Node | null = null;
      function errorNode(n: Node): void {
        if (
          (n.type === "ERROR" || n.isMissing) &&
          (!first ||
            n.startIndex < first.startIndex ||
            (n.startIndex === first.startIndex && n.endIndex < first.endIndex))
        )
          first = n;
        for (const c of n.children) errorNode(c);
      }
      errorNode(tree.rootNode);
      if (first) {
        const bad = first as Node;
        const textToken = (bad.text.trim().match(/^\S+/u)?.[0] ?? bad.type)
          .slice(0, 40)
          .replace(/[\r\n]/g, " ");
        const lines = text.slice(0, bad.startIndex).split(/\r\n|[\r\n]/);
        result.status = "failed";
        result.symbols = [];
        result.links = [];
        result.diagnostics = [
          {
            message: `line ${lines.length}, column ${lines.at(-1)!.length + 1}: ${bad.isMissing ? `missing \`${bad.type}\`` : `unexpected \`${textToken}\``}`,
            range: span(bad),
          },
        ];
        return;
      }
      const opaqueCrateAliases: string[] = [];
      const opaqueItemScopes = new Set<string>();
      const standardMacroScopes: {
        name: string;
        scope: string;
        start: number;
        block?: true;
      }[] = [];
      // Every statement-level invocation is a candidate: the non-conservative
      // binding pass treats it as scope-neutral, the conservative pass does
      // not, and the resolver applies the conservative facts (stdFallback*)
      // and opacity unless it proves the macro neutral where it is invoked:
      // a standard statement macro, an audited ecosystem macro, or a readable
      // workspace `macro_rules!` macro whose arms emit no item or `let` (R1-K).
      const neutralMacro = (n: Node): boolean => n.type === "macro_invocation";
      // Macro expansion can shadow bare names only in a lexical item container.
      // Fields/variants and associated items do not introduce lexical bindings.
      const lexicalItemContainer = (n: Node | null): boolean =>
        !!n &&
        (["source_file", "block"].includes(n.type) ||
          (n.type === "declaration_list" &&
            !["impl_item", "trait_item"].includes(n.parent?.type ?? "")));

      result.symbols.push({
        key: "file",
        name: path,
        kind: "module",
        identity: "$crate",
        range: { start: 0, end: text.length },
        data: { scope: "", unit: true, visibility: "private" },
      });
      const lexicalScopes = new Map<number, string>();
      let activeConditions: string[] = [];
      const link = (
        n: Node,
        owner: string,
        scope: string,
        kind: string,
        targetName: string,
        extra: Record<string, Json> = {},
        range?: { start: number; end: number },
      ) => {
        if (
          targetName.includes("<") &&
          ["calls", "values", "types", "implements"].includes(kind)
        ) {
          const libraryPath = libraryNamePath(n);
          extra = {
            ...extra,
            ...(libraryPath ? { libraryPath } : {}),
            ...qualifiedTrait(n),
          };
        }
        if (
          !["contains", "modules", "imports"].includes(kind) &&
          !extra.macroArguments &&
          !extra.libraryMacroFlavor
        ) {
          const position = referencePosition(n);
          if (!position) extra = { ...extra, namespaceUnknown: true };
          else if (["types", "patterns", "values"].includes(kind)) {
            kind = position.pattern
              ? "patterns"
              : position.namespace === "type"
                ? "types"
                : "values";
            extra = {
              ...extra,
              ...(position.constructorHead === "literal"
                ? { structLiteral: true }
                : {}),
              ...(position.pattern
                ? { structPattern: position.constructorHead === "pattern" }
                : {}),
            };
          }
        }
        if (
          targetName &&
          !(["types", "patterns"].includes(kind) && targetName === "_")
        )
          result.links.push({
            sourceKey: owner,
            kind,
            targetName,
            range: range ?? span(n),
            data: {
              scope,
              conditions: activeConditions,
              ...attributeContext(n),
              ...(presenceAttributes(n).length
                ? { opaqueItemAttributes: presenceAttributes(n) }
                : {}),
              ...extra,
            },
          });
      };
      function imports(
        n: Node,
        prefix: string,
        owner: string,
        scope: string,
        visibility: string,
        conditions: string[] = [],
        names?: string[],
      ) {
        if (n.type === "scoped_use_list") {
          const p = field(n, "path")?.text;
          imports(
            field(n, "list")!,
            prefix + (p ? compact(p) + "::" : ""),
            owner,
            scope,
            visibility,
            conditions,
            names,
          );
        } else if (n.type === "use_list") {
          for (const c of n.namedChildren)
            imports(c, prefix, owner, scope, visibility, conditions, names);
        } else {
          const rename = n.type === "use_as_clause";
          let name = prefix + compact(rename ? field(n, "path")!.text : n.text);
          if (name.endsWith("::self")) name = name.slice(0, -6);
          const alias = rename
            ? field(n, "alias")!.text
            : name.split("::").at(-1)!;
          if (names)
            names.push(n.type === "use_wildcard" ? "*" : compact(alias));
          else
            link(n, owner, scope, "imports", name, {
              alias,
              visibility,
              conditions,
              glob: n.type === "use_wildcard",
            });
        }
      }
      type Meta = {
        start: number;
        name: string;
        value?: Node | undefined;
        args?: Node | undefined;
      };
      const parts = (nodes: Node[]): Meta => {
        const ns = nodes.filter((c) => !c.type.endsWith("comment"));
        const end = ns.findIndex(
            (c) => c.type === "=" || c.type === "token_tree",
          ),
          i = end < 0 ? ns.length : end;
        return {
          start: ns[0]?.startIndex ?? 0,
          name: compact(
            ns
              .slice(0, i)
              .map((n) => n.text)
              .join(""),
          ),
          value: ns[i]?.type === "=" ? ns[i + 1] : undefined,
          args: ns[i]?.type === "token_tree" ? ns[i] : undefined,
        };
      };
      const meta = (n: Node): Meta =>
        parts(
          (n.namedChildren.find((c) => c.type === "attribute") ?? n).children,
        );
      function payloads(n: Node): Meta[] {
        const groups: Node[][] = [[]];
        for (const c of n.children.slice(1, -1)) {
          if (c.type === ",") groups.push([]);
          else groups.at(-1)!.push(c);
        }
        return groups.filter((g) => g.length).map(parts);
      }
      function libraryNamePath(n: Node | null): string {
        if (!n) return "";
        if (n.type === "generic_type") return libraryNamePath(field(n, "type"));
        if (
          n.type === "scoped_identifier" ||
          n.type === "scoped_type_identifier"
        ) {
          const path = field(n, "path"),
            prefix = libraryNamePath(path);
          if (path && !prefix) return "";
          return prefix + "::" + compact(field(n, "name")?.text ?? "");
        }
        return /^[\p{ID_Start}_][\p{ID_Continue}_]*$/u.test(compact(n.text))
          ? compact(n.text)
          : "";
      }
      function qualifiedTrait(n: Node): Record<string, Json> {
        const qualifier = field(n, "path")?.namedChildren[0];
        if (qualifier?.type !== "qualified_type") return {};
        const libraryTrait = libraryNamePath(field(qualifier, "alias"));
        return libraryTrait && !genericShadow(n, libraryTrait.split("::")[0]!)
          ? {
              libraryTrait,
              libraryTraitMember: compact(field(n, "name")?.text ?? ""),
            }
          : {};
      }
      // Compare cfg predicates by syntax tokens, preserving literal contents.
      const cfgText = (n: Node): string =>
        n.type.endsWith("comment")
          ? ""
          : n.type.includes("literal")
            ? n.text
            : n.children.length
              ? n.children.map(cfgText).join("")
              : n.text;
      function predicate(m: Meta): string | undefined {
        if (!/^[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(m.name))
          return undefined;
        if (m.args) {
          if (!["all", "any", "not"].includes(m.name)) return undefined;
          const args = payloads(m.args).map(predicate);
          if (
            args.some((x) => x === undefined) ||
            (m.name === "not" && args.length !== 1)
          )
            return undefined;
          return `${m.name}(${args.join(",")})`;
        }
        if (
          m.value &&
          !["string_literal", "raw_string_literal"].includes(m.value.type)
        )
          return undefined;
        return m.name + (m.value ? "=" + m.value.text : "");
      }
      function cfg(meta: Meta, at?: Node, includeImplicit = true): string[] {
        const implicit = conditionalAttributes.get(meta.name);
        if (
          implicit &&
          includeImplicit &&
          at &&
          attributeEffect(meta.name, shadowed(meta.name, at)) === "conditional"
        )
          return [
            at.type === "function_item"
              ? implicit
              : "?conditional-attribute-target",
          ];
        if (meta.name === "cfg") {
          const args = meta.args ? payloads(meta.args) : [];
          return [args.length === 1 ? (predicate(args[0]!) ?? "?") : "?"];
        }
        if (meta.name === "cfg_attr") {
          if (!meta.args) return ["?"];
          const ps = payloads(meta.args);
          if (ps.length < 2) return ["?"];
          const condition = predicate(ps[0]!) ?? "?";
          return ps
            .slice(1)
            .flatMap((m) =>
              cfg(m, at, includeImplicit).map(
                (c) => `any(not(${condition}),${c})`,
              ),
            );
        }
        return [];
      }
      function applications(
        m: Meta,
        n: Node,
        guards = explicitConditionsOn(n),
      ): { meta: Meta; guards: string[] }[] {
        if (!possible(guards)) return [];
        if (m.name === "cfg_attr") {
          if (!m.args) return [{ meta: m, guards }];
          const ps = payloads(m.args);
          if (!ps[0]) return [{ meta: m, guards }];
          return ps
            .slice(1)
            .flatMap((p) =>
              applications(p, n, [...guards, predicate(ps[0]!) ?? "?"]),
            );
        }
        if (m.name === "unsafe" && m.args)
          return payloads(m.args).flatMap((p) => applications(p, n, guards));
        return [{ meta: m, guards }];
      }
      function procMacro(
        meta: Meta,
        n: Node,
      ): { kind: string; name?: string | undefined; conditional: boolean }[] {
        return applications(meta, n)
          .filter((a) => macroDefinitionAttributes.has(a.meta.name))
          .map((a) => ({
            kind: a.meta.name,
            conditional: a.guards.some(
              (c) => !implies(explicitConditionsOn(n), c),
            ),
            ...(a.meta.name === "proc_macro_derive" && a.meta.args
              ? { name: payloads(a.meta.args)[0]?.name }
              : {}),
          }));
      }
      const attributeCache = new Map<number, Node[]>();
      const conditionCache = new Map<number, string[]>();
      const attributeContainers = new Set([
        "source_file",
        "block",
        "declaration_list",
        "parameters",
        "closure_parameters",
        "field_declaration_list",
        "ordered_field_declaration_list",
        "enum_variant_list",
        "match_block",
        "field_initializer_list",
        "arguments",
        "type_arguments",
        "type_parameters",
        "tuple_expression",
        "array_expression",
      ]);
      function attributesOn(n: Node): Node[] {
        const cached = attributeCache.get(n.id);
        if (cached) return cached;
        const attrs: Node[] = [];
        let previous = n.previousNamedSibling;
        while (
          previous &&
          ["attribute_item", "line_comment", "block_comment"].includes(
            previous.type,
          )
        ) {
          if (previous.type === "attribute_item") attrs.unshift(previous);
          previous = previous.previousNamedSibling;
        }
        // Embedded outer attributes belong to their parameter/arm/expression,
        // not to a container's first child (fields, parameters, statements).
        if (!attributeContainers.has(n.type))
          attrs.push(
            ...n.namedChildren.filter((c) => c.type === "attribute_item"),
          );
        const body =
          field(n, "body") ?? (attributeContainers.has(n.type) ? n : null);
        for (const c of body?.namedChildren ?? []) {
          if (c.type.endsWith("comment")) continue;
          if (c.type !== "inner_attribute_item") break;
          attrs.push(c);
        }
        const result = [...new Map(attrs.map((a) => [a.id, a])).values()];
        attributeCache.set(n.id, result);
        return result;
      }
      /** All attribute consumers share cfg_attr/unsafe expansion and viability. */
      function effectiveAttributes(n: Node) {
        return attributesOn(n).flatMap((a) => applications(meta(a), n));
      }
      /** Parenthesized/bracketed final macros are expressions; braces can still emit items. */
      function tailMacro(n: Node): boolean {
        return (
          n.type === "macro_invocation" &&
          !n.namedChildren.some(
            (c) => c.type === "token_tree" && c.text.startsWith("{"),
          ) &&
          n.parent?.type === "block" &&
          n.parent.children
            .filter(
              (c) => c.startIndex >= n.endIndex && !c.type.endsWith("comment"),
            )
            .every((c) => c.type === "}")
        );
      }
      function deriveHelper(
        m: Meta,
        n: Node,
        guards: string[],
      ): { helper: true; nested: boolean } | null {
        if (
          !/^[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(m.name) ||
          attributeRules.has(m.name)
        )
          return null;
        const adts = ["struct_item", "enum_item", "union_item"];
        if (
          !adts.includes(n.type) &&
          !["field_declaration", "enum_variant"].includes(n.type) &&
          n.parent?.type !== "ordered_field_declaration_list"
        )
          return null;
        let owner: Node | null = n;
        while (owner && !adts.includes(owner.type)) {
          if (
            ["block", "function_item", "impl_item", "mod_item"].includes(
              owner.type,
            )
          )
            return null;
          owner = owner.parent;
        }
        if (!owner) return null;
        const derived = effectiveAttributes(owner).some(
          (a) =>
            a.meta.name === "derive" &&
            a.meta.start < m.start &&
            !!a.meta.args &&
            payloads(a.meta.args).length > 0 &&
            a.guards.every((c) => implies(guards, c)),
        );
        return derived ? { helper: true, nested: owner.id !== n.id } : null;
      }
      function macroUseConditions(n: Node): string[][] {
        return effectiveAttributes(n)
          .filter((a) => a.meta.name === "macro_use")
          .map((a) => a.guards);
      }
      function noImplicitPrelude(n: Node): boolean {
        return effectiveAttributes(n).some(
          (a) => a.meta.name === "no_implicit_prelude",
        );
      }
      /** The one cfg collector for every item/site, including inherited gates. */
      function conditionsOn(n: Node): string[] {
        const cached = conditionCache.get(n.id);
        if (cached) return cached;
        const inherited = n.parent ? conditionsOn(n.parent) : [];
        const own = attributesOn(n).flatMap((a) => cfg(meta(a), n));
        if (
          attributesOn(n)
            .flatMap((a) => procMacro(meta(a), n))
            .some((p) => p.conditional)
        )
          own.push("?proc-macro-kind");
        const result = own.length
          ? [...new Set([...inherited, ...own])]
          : inherited;
        conditionCache.set(n.id, result);
        return result;
      }
      const attributeBindings = new Map<
        number,
        {
          node: Node;
          names: Set<string>;
          unknown: boolean;
          macroUse: boolean;
          helperUnknown: boolean;
          macroUseImports: MacroUseImport[];
        }
      >();
      const explicitCache = new Map<number, string[]>();
      function explicitConditionsOn(n: Node): string[] {
        const cached = explicitCache.get(n.id);
        if (cached) return cached;
        const inherited = n.parent ? explicitConditionsOn(n.parent) : [];
        const own = attributesOn(n).flatMap((a) => cfg(meta(a), n, false));
        const result = [...new Set([...inherited, ...own])];
        explicitCache.set(n.id, result);
        return result;
      }
      function bindingContainer(n: Node): Node {
        let p = n.parent;
        while (p && !lexicalItemContainer(p)) p = p.parent;
        return p ?? tree.rootNode;
      }
      function collectAttributeBindings(n: Node): void {
        if (!possible(explicitConditionsOn(n))) return;
        const names: string[] = [];
        if (n.type === "use_declaration") {
          const argument = field(n, "argument");
          if (argument) imports(argument, "", "", "", "", [], names);
        } else if (
          [
            "mod_item",
            "struct_item",
            "enum_item",
            "trait_item",
            "type_item",
            "macro_definition",
          ].includes(n.type)
        ) {
          const name = field(n, "name");
          if (name) names.push(compact(name.text));
        } else if (n.type === "extern_crate_declaration") {
          const name = field(n, "alias") ?? field(n, "name");
          if (name) names.push(compact(name.text));
        }
        let macroUse = false;
        const macroNames = new Set<string>();
        const macroUseImports: MacroUseImport[] = [];
        if (n.type === "extern_crate_declaration")
          for (const app of effectiveAttributes(n))
            if (app.meta.name === "macro_use") {
              macroUseImports.push({
                crate: compact(field(n, "name")?.text ?? ""),
                names: app.meta.args
                  ? payloads(app.meta.args).map((x) => x.name)
                  : null,
              });
              if (!app.meta.args) macroUse = true;
              else
                for (const entry of payloads(app.meta.args)) {
                  names.push(entry.name);
                  macroNames.add(entry.name);
                }
            }
        const scope = bindingContainer(n),
          unknown =
            n.type === "macro_invocation" &&
            !tailMacro(n) &&
            [
              "source_file",
              "declaration_list",
              "block",
              "expression_statement",
            ].includes(n.parent?.type ?? "");
        const helperUnknown =
          lexicalItemContainer(n.parent) &&
          effectiveAttributes(n).some(
            (a) =>
              a.meta.name === "derive" ||
              !knownAttributeName(a.meta.name, false),
          );
        if (
          names.some((n) => n !== "*" && n !== "_") ||
          unknown ||
          macroUse ||
          helperUnknown
        ) {
          const v = attributeBindings.get(scope.id) ?? {
            node: scope,
            names: new Set<string>(),
            unknown: false,
            macroUse: false,
            helperUnknown: false,
            macroUseImports: [],
          };
          for (const name of names)
            if (
              attributeRules.get(name)?.category === "tool" ||
              (attributeRules.get(name)?.category === "prelude" &&
                (["use_declaration", "macro_definition"].includes(n.type) ||
                  (n.type === "extern_crate_declaration" &&
                    macroNames.has(name))))
            )
              v.names.add(name);
          v.helperUnknown ||= helperUnknown;
          v.unknown ||= unknown;
          v.macroUse ||= macroUse;
          v.macroUseImports.push(...macroUseImports);
          attributeBindings.set(scope.id, v);
        }
        for (const c of n.namedChildren) collectAttributeBindings(c);
      }
      function shadowed(name: string, n: Node): boolean {
        const rule = attributeRules.get(name.split("::")[0]!);
        if (!rule || rule.category === "builtin") return false;
        const head = name.split("::")[0]!;
        let node: Node | null = n.type === "source_file" ? n : n.parent;
        while (node) {
          const b = attributeBindings.get(node.id);
          if (
            b &&
            attributeBindingShadows(
              head,
              b.names.has(head),
              b.unknown || (rule.category === "prelude" && b.macroUse),
            )
          )
            return true;
          node = node.parent;
        }
        return false;
      }
      collectAttributeBindings(tree.rootNode);
      const implicitCache = new Map<
        number,
        { name: string; scope: string; condition: string; explicit: boolean }[]
      >();
      function implicitConditionsOn(n: Node): {
        name: string;
        scope: string;
        condition: string;
        explicit: boolean;
      }[] {
        const cached = implicitCache.get(n.id);
        if (cached) return cached;
        const inherited = n.parent ? implicitConditionsOn(n.parent) : [];
        function from(m: Meta): {
          name: string;
          scope: string;
          condition: string;
          explicit: boolean;
        }[] {
          if (m.name === "cfg_attr" && m.args) {
            const ps = payloads(m.args),
              p = predicate(ps[0]!) ?? "?";
            return ps
              .slice(1)
              .flatMap(from)
              .map((x) => ({
                ...x,
                condition: `any(not(${p}),${x.condition})`,
              }));
          }
          const condition = conditionalAttributes.get(m.name);
          return condition && !shadowed(m.name, n) && n.type === "function_item"
            ? [
                {
                  name: m.name,
                  scope: lexicalScopes.get(n.id) ?? "",
                  condition,
                  explicit: false,
                },
              ]
            : [];
        }
        const result = [
          ...inherited,
          ...attributesOn(n).flatMap((a) => from(meta(a))),
        ].map((x) => ({
          ...x,
          explicit: explicitConditionsOn(n).includes(x.condition),
        }));
        implicitCache.set(n.id, result);
        return result;
      }
      const shadowableCache = new Map<
        number,
        { name: string; scope: string; helper?: true; nested?: boolean }[]
      >();
      function shadowableOn(
        n: Node,
      ): { name: string; scope: string; helper?: true; nested?: boolean }[] {
        const cached = shadowableCache.get(n.id);
        if (cached) return cached;
        function from(
          m: Meta,
        ): { name: string; scope: string; helper?: true; nested?: boolean }[] {
          return applications(m, n).flatMap(({ meta: m, guards }) => {
            const helper = deriveHelper(m, n, guards);
            const rule = attributeRules.get(m.name.split("::")[0]!);
            return helper ||
              (rule && rule.category !== "builtin" && !shadowed(m.name, n))
              ? [
                  {
                    name: m.name,
                    ...(helper ?? {}),
                    scope:
                      lexicalScopes.get(
                        (n.type === "source_file" ? n : bindingContainer(n)).id,
                      ) ?? "",
                  },
                ]
              : [];
          });
        }
        const result = [
          ...new Map(
            [
              ...(n.parent ? shadowableOn(n.parent) : []),
              ...attributesOn(n).flatMap((a) => from(meta(a))),
            ].map((x) => [JSON.stringify(x), x]),
          ).values(),
        ].sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope),
        );
        shadowableCache.set(n.id, result);
        return result;
      }
      const attributeContexts: {
        sourceConditions: string[];
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
      }[] = [];
      const contextIds = new Map<string, number>();
      function attributeContext(n: Node) {
        const context = {
          sourceConditions: conditionsOn(n),
          shadowable: shadowableOn(n),
          implicit: implicitConditionsOn(n),
        };
        if (
          !context.sourceConditions.length &&
          !context.shadowable.length &&
          !context.implicit.length
        )
          return {};
        const key = JSON.stringify(context);
        let id = contextIds.get(key);
        if (id === undefined) {
          id = attributeContexts.length;
          attributeContexts.push(context);
          contextIds.set(key, id);
        }
        return { attributeContext: id };
      }
      const presenceCache = new Map<number, string[]>();
      function opaquePresence(meta: Meta, n: Node): string[] {
        return applications(meta, n)
          .filter(
            (a) =>
              !knownAttributeName(a.meta.name, shadowed(a.meta.name, n)) &&
              !deriveHelper(a.meta, n, a.guards),
          )
          .map((a) => a.meta.name || "?attribute");
      }
      /** One presence predicate, inherited through every enclosing AST item. */
      function presenceAttributes(n: Node): string[] {
        const cached = presenceCache.get(n.id);
        if (cached) return cached;
        const inherited = n.parent ? presenceAttributes(n.parent) : [];
        const own = attributesOn(n).flatMap((a) => opaquePresence(meta(a), n));
        const result = own.length
          ? [...new Set([...inherited, ...own])].sort()
          : inherited;
        presenceCache.set(n.id, result);
        return result;
      }
      const fileMacroUse = macroUseConditions(tree.rootNode);
      const fileModulePath = modulePath(tree.rootNode);
      result.symbols[0]!.data = {
        noStdConditions: effectiveAttributes(tree.rootNode)
          .filter((a) => a.meta.name === "no_std")
          .map((a) => a.guards),
        ...(fileMacroUse.length ? { macroUseConditions: fileMacroUse } : {}),
        ...(fileModulePath.paths.length || fileModulePath.pathOpaque
          ? { innerModulePath: fileModulePath }
          : {}),
        ...(noImplicitPrelude(tree.rootNode)
          ? { noImplicitPrelude: true }
          : {}),
        scope: "",
        unit: true,
        visibility: "private",
        conditions: conditionsOn(tree.rootNode),
        ...attributeContext(tree.rootNode),
        opaqueItemAttributes: presenceAttributes(tree.rootNode),
      };
      function modulePath(n: Node): {
        path: string;
        paths: string[];
        pathExplicit: boolean;
        pathOpaque: boolean;
      } {
        const paths: string[] = [];
        let path = "",
          pathExplicit = false,
          pathOpaque = false,
          firstCertainPath = false;
        const read = (m: Meta, conditional: boolean): void => {
          if (m.name !== "path" || firstCertainPath) return;
          if (!conditional) firstCertainPath = true;
          let value: string | undefined;
          if (m.value?.type === "raw_string_literal")
            value =
              /^r(#[#]*)?"([\s\S]*)"\1$/.exec(m.value.text)?.[2] ??
              /^r"([\s\S]*)"$/.exec(m.value.text)?.[1];
          else if (m.value?.type === "string_literal") {
            try {
              value = JSON.parse(m.value.text) as string;
            } catch {}
          }
          if (value === undefined) {
            pathOpaque = true;
            return;
          }
          paths.push(value);
          if (!conditional) {
            if (paths.length === 1 && !pathOpaque) {
              path = value;
              pathExplicit = true;
            } else pathOpaque = true;
          }
        };
        for (const app of effectiveAttributes(n))
          read(
            app.meta,
            app.guards.some((c) => !implies(explicitConditionsOn(n), c)),
          );
        return { path, paths: [...new Set(paths)], pathExplicit, pathOpaque };
      }
      const argumentSyntaxCache = new Map<number, string>();
      function argumentSyntax(type: Node | null): string {
        if (!type) return "[]";
        const cached = argumentSyntaxCache.get(type.id);
        if (cached !== undefined) return cached;
        function syntax(n: Node): unknown | null {
          if (
            [
              "function_type",
              "for_lifetimes",
              "higher_ranked_trait_bound",
              "macro_invocation",
              "block",
              "binary_expression",
              "call_expression",
              "string_literal",
              "raw_string_literal",
            ].includes(n.type)
          )
            return null;
          if (
            n.type === "char_literal" ||
            n.type === "integer_literal" ||
            n.type === "boolean_literal"
          )
            return [n.type, n.text];
          const children = (
            n.type === "type_arguments" ? n.namedChildren : n.children
          ).filter((c) => c.type !== "lifetime" && !c.type.endsWith("comment"));
          if (n.type === "type_arguments" && !children.length)
            return [n.type, []];
          if (!children.length)
            return [
              n.type,
              ["identifier", "type_identifier"].includes(n.type)
                ? compact(n.text)
                : n.text,
            ];
          const values = children.map(syntax);
          return values.some((v) => v === null) ? null : [n.type, values];
        }
        const args = field(type, "type_arguments");
        const nodes =
          args?.namedChildren.filter(
            (c) => c.type !== "lifetime" && !c.type.endsWith("comment"),
          ) ?? [];
        const shapes = nodes.map(syntax),
          value = shapes.some((v) => v === null) ? "" : JSON.stringify(shapes);
        argumentSyntaxCache.set(type.id, value);
        return value;
      }
      const bindingAttributeOpaque = (m: Meta, n: Node): boolean =>
        applications(m, n).some(
          (a) =>
            a.meta.name === "derive" ||
            !knownAttributeName(a.meta.name, shadowed(a.meta.name, n)),
        );
      function bindingType(n: Node): Node | null {
        return attributesOn(n).some((a) => bindingAttributeOpaque(meta(a), n))
          ? null
          : field(n, "type");
      }
      type ReceiverType = {
        name: string;
        scope: string;
        borrow: string;
        mutable: boolean;
        argumentSyntax: string;
      };
      // Build lexical binding evidence once per function. Each query visits only
      // its ancestor scopes and binary-searches the requested name's activations.
      type Binding = {
        pattern: Node;
        type: Node | null;
        start: number;
        order: number;
        macro?: boolean;
        item?: boolean;
        conditions?: string[];
      };
      type BindingScopes = Map<number, Map<string, Binding[]>>;
      const bindingCache = new Map<string, BindingScopes>();
      function patternNames(n: Node): Node[] {
        if (
          ["identifier", "shorthand_field_identifier", "self"].includes(n.type)
        )
          return n.text === "_" ? [] : [n];
        if (
          [
            "scoped_identifier",
            "scoped_type_identifier",
            "type_identifier",
            "field_identifier",
          ].includes(n.type)
        )
          return [];
        if (n.type === "field_pattern") {
          const value = field(n, "pattern") ?? field(n, "name");
          return value ? patternNames(value) : [];
        }
        return n.namedChildren
          .filter(
            (c) =>
              field(n, "type")?.id !== c.id &&
              field(n, "condition")?.id !== c.id,
          )
          .flatMap(patternNames);
      }
      function bindings(
        root: Node,
        at: Node,
        name: string,
        conservative = false,
      ): {
        blocked: Set<string>;
        types: Map<string, ReceiverType>;
        invalidated: boolean;
        conditional: Set<string>;
      } {
        name = compact(name);
        let scopes = bindingCache.get(`${root.id}|${conservative}`);
        if (!scopes) {
          scopes = new Map();
          let order = 0;
          const add = (
            pattern: Node | null,
            type: Node | null,
            region: Node,
            start: number,
            macro = false,
          ) => {
            if (!pattern) return;
            const ids = patternNames(pattern);
            const names =
              scopes!.get(region.id) ?? new Map<string, Binding[]>();
            for (const id of ids) {
              if (
                id.text === "_" ||
                id.parent?.type === "scoped_identifier" ||
                field(id.parent ?? id, "type")?.id === id.id
              )
                continue;
              const list = names.get(compact(id.text)) ?? [];
              list.push({
                pattern,
                type: pattern.type === "identifier" ? type : null,
                start,
                order: order++,
                macro,
                conditions: conditionsOn(pattern),
              });
              names.set(compact(id.text), list);
            }
            scopes!.set(region.id, names);
          };
          function scan(n: Node, parameterRegion: Node) {
            if (n.parent?.type === "block") {
              const valueItem =
                ["function_item", "const_item", "static_item"].includes(
                  n.type,
                ) ||
                (n.type === "struct_item" &&
                  !n.namedChildren.some(
                    (c) => c.type === "field_declaration_list",
                  ));
              const imported: string[] = [];
              if (n.type === "use_declaration")
                imports(field(n, "argument")!, "", "", "", "", [], imported);
              const wildcard =
                imported.includes("*") ||
                (n.type === "macro_invocation" &&
                  !tailMacro(n) &&
                  (conservative || !neutralMacro(n))) ||
                (n.type === "expression_statement" &&
                  n.namedChildren.some(
                    (c) =>
                      c.type === "macro_invocation" &&
                      (conservative || !neutralMacro(c)),
                  )) ||
                (n.type === "attribute_item" &&
                  bindingAttributeOpaque(meta(n), n));
              for (const alias of imported.filter(
                (x) => x !== "*" && x !== "_",
              )) {
                const names =
                  scopes!.get(n.parent.id) ?? new Map<string, Binding[]>();
                names.set("?" + alias, [
                  { pattern: n, type: null, start: 0, order: order++ },
                ]);
                scopes!.set(n.parent.id, names);
              }
              const id = field(n, "name");
              if (valueItem && id) {
                const names =
                  scopes!.get(n.parent.id) ?? new Map<string, Binding[]>();
                const list = names.get(compact(id.text)) ?? [];
                list.push({
                  pattern: id,
                  type: null,
                  start: 0,
                  order: order++,
                  item: true,
                });
                names.set(compact(id.text), list);
                scopes!.set(n.parent.id, names);
              }
              if (wildcard) {
                const names =
                  scopes!.get(n.parent.id) ?? new Map<string, Binding[]>();
                const list = names.get("*") ?? [];
                list.push({
                  pattern: n,
                  type: null,
                  start: 0,
                  order: order++,
                  item: true,
                });
                names.set("*", list);
                scopes!.set(n.parent.id, names);
              }
            }
            if (
              n.id !== root.id &&
              ["function_item", "impl_item", "mod_item"].includes(n.type)
            )
              return;
            if (
              n.type === "macro_invocation" &&
              n.parent?.type === "expression_statement" &&
              n.parent.parent?.type === "block"
            ) {
              for (const token of (conservative || !neutralMacro(n)
                ? n.namedChildren
                : []
              )
                .filter((c) => c.type === "token_tree")
                .flatMap((c) => c.descendantsOfType(["identifier", "self"])))
                if (!["self", "Self"].includes(compact(token.text)))
                  add(token, null, n.parent.parent, n.endIndex, true);
              return;
            }
            if (n.type === "closure_expression") parameterRegion = n;
            if (
              n.type === "parameter" &&
              n.parent?.parent?.id === parameterRegion.id
            )
              add(field(n, "pattern"), bindingType(n), parameterRegion, 0);
            if (n.type === "let_declaration" && n.parent)
              add(field(n, "pattern"), bindingType(n), n.parent, n.endIndex);
            if (n.type === "let_condition") {
              let control = n.parent;
              while (
                control &&
                !["if_expression", "while_expression", "match_arm"].includes(
                  control.type,
                )
              )
                control = control.parent;
              const region =
                control &&
                (field(control, "consequence") ??
                  field(control, "body") ??
                  field(control, "value"));
              if (control) {
                const chain =
                  field(control, "condition") ??
                  (field(control, "pattern") &&
                    field(field(control, "pattern")!, "condition"));
                if (chain) add(field(n, "pattern"), null, chain, n.endIndex);
              }
              if (region) add(field(n, "pattern"), null, region, 0);
            }
            if (
              [
                "closure_expression",
                "for_expression",
                "match_arm",
                "if_expression",
                "while_expression",
              ].includes(n.type)
            ) {
              add(
                field(n, "pattern"),
                null,
                n.type === "for_expression" ? (field(n, "body") ?? n) : n,
                0,
              );
              const ps = field(n, "parameters");
              if (ps)
                for (const p of ps.namedChildren)
                  add(
                    p.type === "parameter" ? field(p, "pattern") : p,
                    null,
                    n,
                    0,
                  );
            }
            for (const c of n.namedChildren) scan(c, parameterRegion);
          }
          scan(root, root);
          for (const names of scopes.values())
            for (const list of names.values())
              list.sort((a, b) => a.start - b.start || a.order - b.order);
          bindingCache.set(`${root.id}|${conservative}`, scopes);
        }
        let invalidated = false;
        const blocked = new Set<string>();
        const conditional = new Set<string>();
        const callerConditions = conditionsOn(at);
        const types = new Map<string, ReceiverType>();
        let ancestor: Node | null = at;
        while (ancestor) {
          const names = scopes.get(ancestor.id);
          // Unknown block generation can shadow a receiver, but cannot erase
          // an enclosing runtime binding and expose an outer function value.
          if (
            name !== "self" &&
            (names?.get("*")?.length || names?.get("?" + name)?.length)
          )
            invalidated = true;
          const list = names?.get(name);
          if (list) {
            let lo = 0,
              hi = list.length;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (list[mid]!.start <= at.startIndex) lo = mid + 1;
              else hi = mid;
            }
            let item = list[lo - 1];
            while (
              item &&
              !possible([...callerConditions, ...(item.conditions ?? [])])
            )
              item = list[--lo - 1];
            if (item) {
              const uncertain = (item.conditions ?? []).some(
                (c) => !implies(callerConditions, c),
              );
              if (uncertain) {
                conditional.add(name);
                invalidated = true;
              }
              if (!item.item) blocked.add(name);
              invalidated ||= item.macro === true;
              const { pattern, type } = item;
              const nominal =
                type?.type === "reference_type" ? field(type, "type") : type;
              if (
                !invalidated &&
                type &&
                nominal &&
                [
                  "type_identifier",
                  "scoped_type_identifier",
                  "generic_type",
                  "primitive_type",
                ].includes(nominal.type)
              )
                types.set(name, {
                  name: nominal.text.replace(/\br#/g, "").trim(),
                  argumentSyntax: argumentSyntax(nominal),
                  scope: lexicalScopes.get(type.id) ?? "",
                  borrow:
                    type.type === "reference_type"
                      ? type.namedChildren.some(
                          (c) => c.type === "mutable_specifier",
                        )
                        ? "mutable"
                        : "shared"
                      : "owned",
                  mutable:
                    pattern.parent?.namedChildren.some(
                      (c) => c.type === "mutable_specifier",
                    ) ?? false,
                });
              break;
            }
          }
          if (ancestor.id === root.id) break;
          ancestor = ancestor.parent;
        }
        return { blocked, types, invalidated, conditional };
      }
      function arity(list: Node | null) {
        let minimum = 0,
          maximum = 0,
          optional = false;
        for (const child of list?.namedChildren ?? []) {
          if (child.type.endsWith("comment")) continue;
          if (child.type === "attribute_item") {
            optional ||= /\bcfg(?:_attr)?\b/.test(child.text);
            continue;
          }
          maximum++;
          if (!optional) minimum++;
          optional = false;
        }
        return { minimum, maximum };
      }
      // Receiver grammar, including typed self, is inspected structurally. Raw
      // source is retained separately; lifetimes never hide a mutable_specifier.
      function receiverInfo(fn: Node | null) {
        const parameter =
          fn &&
          field(fn, "parameters")?.namedChildren.find(
            (c) =>
              c.type === "self_parameter" ||
              field(c, "pattern")?.type === "self",
          );
        if (!parameter)
          return {
            kind: "none",
            borrow: "unknown",
            mutable: false,
            syntax: "",
            type: "",
          };
        const type = field(parameter, "type");
        const mutable = parameter.namedChildren.some(
          (c) => c.type === "mutable_specifier",
        );
        const reference =
          (type?.type === "reference_type" &&
            field(type, "type")?.text === "Self") ||
          (!type && parameter.children.some((c) => c.type === "&"));
        const referenceMutable =
          reference &&
          (type ?? parameter).namedChildren.some(
            (c) => c.type === "mutable_specifier",
          );
        const owned =
          !type || (type.type === "type_identifier" && type.text === "Self");
        const borrow = reference
          ? referenceMutable
            ? "mutable"
            : "shared"
          : owned
            ? "owned"
            : "unknown";
        return {
          kind:
            borrow === "mutable"
              ? "&mut self"
              : borrow === "shared"
                ? "&self"
                : borrow === "owned"
                  ? "self"
                  : "unknown",
          borrow,
          mutable,
          syntax: parameter.text,
          type: type?.text ?? "Self",
        };
      }
      // Rust's directory ownership changes across block-local modules.
      // Record the class only for file declarations; inline text stays written
      // in the same file, while descendants in other files inherit uncertainty.
      function blockModuleLocation(n: Node): "inline" | "direct" | undefined {
        if (
          n.type !== "mod_item" ||
          field(n, "body") ||
          !possible(explicitConditionsOn(n))
        )
          return;
        let inlineAncestor = false,
          blockAncestor = false;
        for (let a = n.parent; a && a.type !== "source_file"; a = a.parent) {
          // Inline module bodies are declaration_list nodes, not blocks.
          // A real block between an inline module and its module scope makes
          // it block-local, regardless of the expression/item owning the block.
          if (a.type === "mod_item") inlineAncestor = true;
          if (a.type === "block") {
            blockAncestor = true;
            if (inlineAncestor) return "inline";
          }
        }
        return blockAncestor ? "direct" : undefined;
      }

      const genericBindingsCache = new Map<number, string>();
      function genericBindings(n: Node): string {
        const cached = genericBindingsCache.get(n.id);
        if (cached !== undefined) return cached;
        const names = new Set<string>();
        let parent: Node | null = n;
        while (parent && parent.type !== "mod_item") {
          for (const parameter of field(parent, "type_parameters")
            ?.namedChildren ?? []) {
            const name = compact(
              field(parameter, "name")?.text ?? parameter.text,
            );
            if (!name.startsWith("'")) names.add(name);
          }
          parent = parent.parent;
        }
        const value = [...names].join(",");
        genericBindingsCache.set(n.id, value);
        return value;
      }
      const blockNumbers = new Map<string, number>();
      function genericShadow(n: Node, name: string): boolean {
        let parent: Node | null = n;
        while (parent) {
          const parameters = field(parent, "type_parameters");
          if (
            parameters?.namedChildren.some(
              (p) =>
                compact(field(p, "name")?.text ?? p.text) === compact(name),
            )
          )
            return true;
          parent = parent.parent;
        }
        return false;
      }
      /**
       * A call written in a macro invocation's argument tokens. The link data
       * mirrors a `call_expression` at the same place; `macroArguments` names
       * the invocations whose expansion must be proved to evaluate these
       * tokens as an expression, else the resolver leaves it unverified.
       */
      function tokenCall(
        call: ReturnType<typeof argumentCalls>[number],
        owner: string,
        scope: string,
        fn: Node | null,
        implType: string,
        implNode: Node | null,
        implScope: string,
      ) {
        const anchor = call.anchor;
        const empty = {
          blocked: new Set<string>(),
          types: new Map<string, ReceiverType>(),
          invalidated: false,
          conditional: new Set<string>(),
        };
        const macroData = {
          macroArguments: call.macros,
          macroArgumentNames: call.macroNames,
        };
        const range = { start: call.start, end: call.end };
        const targetName = text
          .slice(call.start, call.end)
          .replace(/\br#/g, "");
        if (call.method) {
          const receiver = call.receiver;
          const name = receiver ? compact(receiver.text) : "";
          const b = fn && receiver ? bindings(fn, receiver, name) : empty;
          const old = fn && receiver ? bindings(fn, receiver, name, true) : b;
          const self = name === "self";
          const receiverType = !receiver
            ? ""
            : self
              ? b.invalidated
                ? ""
                : implType
              : (b.types.get(name)?.name ?? "");
          link(
            anchor,
            owner,
            scope,
            "calls",
            targetName,
            {
              genericBindings: genericBindings(fn ?? anchor),
              argumentCount: call.argumentCount,
              argumentMinimum: call.argumentCount,
              method: call.method,
              ...(!!receiverType &&
              (self ? old.invalidated : !old.types.has(name))
                ? { stdFallbackReceiverUnknown: true }
                : {}),
              receiverType,
              receiverArgumentSyntax: self
                ? argumentSyntax(implNode && field(implNode, "type"))
                : (b.types.get(name)?.argumentSyntax ?? "[]"),
              receiverBorrow: self
                ? receiverInfo(fn).borrow
                : (b.types.get(name)?.borrow ?? "owned"),
              receiverMutable: self
                ? receiverInfo(fn).mutable
                : (b.types.get(name)?.mutable ?? false),
              implKey: implNode ? `item:${implNode.startIndex}` : "",
              typeScope: self ? implScope : (b.types.get(name)?.scope ?? scope),
              implType,
              implScope,
              blocked:
                !receiverType ||
                genericShadow(anchor, receiverType.split("::")[0]!),
              ...macroData,
            },
            range,
          );
          return;
        }
        const path = call.path!.join("::");
        const head = compact(call.path![0]!);
        const b = fn ? bindings(fn, anchor, head) : empty;
        const old = fn ? bindings(fn, anchor, head, true) : b;
        link(
          anchor,
          owner,
          scope,
          "calls",
          path,
          {
            ...(old.blocked.has(head) && !b.blocked.has(head)
              ? { stdFallbackBlocked: true }
              : {}),
            ...(old.conditional.has(head) && !b.conditional.has(head)
              ? { stdFallbackConditional: true }
              : {}),
            pathSyntax: path,
            pathArgumentSyntax: "[]",
            implArgumentSyntax: argumentSyntax(
              implNode && field(implNode, "type"),
            ),
            genericBindings: genericBindings(fn ?? anchor),
            argumentCount: call.argumentCount,
            argumentMinimum: call.argumentCount,
            ...(b.conditional.has(head) ? { conditionalBinding: true } : {}),
            blocked: b.blocked.has(head) || genericShadow(anchor, head),
            implType,
            implScope,
            implKey: implNode ? `item:${implNode.startIndex}` : "",
            ...macroData,
          },
          range,
        );
      }
      function visit(
        n: Node,
        owner: string,
        scope: string,
        fn: Node | null,
        implType: string,
        moduleScope = "",
        conditions: string[] = [],
      ) {
        conditions = conditionsOn(n);
        activeConditions = conditions;
        // Signature types are outside the function body item's scope. Preserve
        // the annotation's namespace so a later local type cannot retarget it.
        const body = fn && field(fn, "body");
        if (fn && body && n.startIndex < body.startIndex)
          scope = lexicalScopes.get(fn.id) ?? scope;
        lexicalScopes.set(n.id, scope);
        let implNode: Node | null = n;
        while (implNode && implNode.type !== "impl_item")
          implNode = implNode.parent;
        const implScope = implNode
          ? (lexicalScopes.get(implNode.id) ?? "")
          : "";
        let nextOwner = owner,
          nextScope = scope,
          nextFn = fn,
          nextImpl = implType;
        if (n.type === "block" && n.parent?.type !== "function_item") {
          const index = blockNumbers.get(scope) ?? 0;
          blockNumbers.set(scope, index + 1);
          scope = `${scope}::$block${index}`;
          nextScope = scope;
        }
        const kind = kinds[n.type];
        if (kind) {
          const nameNode = field(n, "name");
          const type = field(n, "type");
          const trait = field(n, "trait");
          const transformations =
            n.type === "function_item"
              ? attributesOn(n).flatMap((a) => procMacro(meta(a), n))
              : [];
          const transformed =
            transformations.length === 1 && !transformations[0]!.conditional
              ? transformations[0]
              : undefined;
          const name =
            n.type === "impl_item"
              ? `impl${field(n, "type_parameters") ? compact(field(n, "type_parameters")!.text) : ""} ${trait ? compact(trait.text) + " for " : ""}${type ? compact(type.text) : "?"}`
              : nameNode
                ? compact(nameNode.text)
                : undefined;
          if (name) {
            const key = `item:${n.startIndex}`;
            const identity = scope ? `${scope}::${name}` : name;
            const actualKind =
              kind === "function" &&
              (n.parent?.parent?.type === "impl_item" ||
                n.parent?.parent?.type === "trait_item")
                ? "method"
                : kind;
            const attributeNodes = attributesOn(n);
            const attrs = attributeNodes.map((a) => a.text);
            activeConditions = conditions;
            result.symbols.push({
              key,
              name,
              kind: actualKind,
              identity,
              range: span(n),
              data: {
                scope,
                moduleScope,
                conditions,
                ...attributeContext(n),
                ...(transformations.length
                  ? {
                      procMacroKinds: transformations.map((p) => p.kind),
                      ...(transformed
                        ? {
                            sourceFunctionName: nameNode?.text ?? "",
                            semanticKind: "macro",
                            exportedMacroName:
                              transformed.name ?? nameNode?.text ?? "",
                          }
                        : {
                            namespaceUnverified: true,
                            exportedMacroNames: transformations.flatMap((p) =>
                              p.name ? [p.name] : [],
                            ),
                          }),
                    }
                  : {}),
                ...(presenceAttributes(n).length
                  ? { opaqueItemAttributes: presenceAttributes(n) }
                  : {}),
                ...(["struct", "variant"].includes(actualKind)
                  ? {
                      constructorForm: n.namedChildren.some(
                        (c) => c.type === "field_declaration_list",
                      )
                        ? "named"
                        : n.namedChildren.some(
                              (c) =>
                                c.type === "ordered_field_declaration_list",
                            )
                          ? "tuple"
                          : "unit",
                    }
                  : {}),
                ...(actualKind === "method"
                  ? {
                      arity: arity(field(n, "parameters")).maximum,
                      arityMinimum: arity(field(n, "parameters")).minimum,
                      receiverKind: receiverInfo(n).kind,
                      receiverConditions: (() => {
                        const p = field(n, "parameters")?.namedChildren.find(
                          (p) =>
                            p.type === "self_parameter" ||
                            field(p, "pattern")?.type === "self",
                        );
                        return p ? conditionsOn(p) : [];
                      })(),
                      receiverSyntax: receiverInfo(n).syntax,
                      receiverType: receiverInfo(n).type,
                      receiverMutable: receiverInfo(n).mutable,
                      defaultBody: !!field(n, "body"),
                      methodBounded:
                        n.namedChildren.some(
                          (c) => c.type === "where_clause",
                        ) ||
                        !!field(n, "type_parameters")?.descendantsOfType(
                          "trait_bounds",
                        ).length,
                    }
                  : {}),
                ...(actualKind === "macro"
                  ? {
                      macroRules: true,
                      macroProfile: macroProfile(n) as unknown as Json,
                      macroExportConditions: effectiveAttributes(n)
                        .filter((a) => a.meta.name === "macro_export")
                        .map((a) => a.guards),
                      // `#[macro_export(local_inner_macros)]`: every bare
                      // macro name in the transcriber means `$crate::name`.
                      ...(effectiveAttributes(n).some(
                        (a) =>
                          a.meta.name === "macro_export" &&
                          /\blocal_inner_macros\b/.test(
                            a.meta.args?.text ?? "",
                          ),
                      )
                        ? { localInnerMacros: true }
                        : {}),
                    }
                  : {}),
                visibility:
                  actualKind === "macro" &&
                  effectiveAttributes(n).some(
                    (a) =>
                      a.meta.name === "macro_export" &&
                      a.guards.every((c) =>
                        implies(explicitConditionsOn(n), c),
                      ),
                  )
                    ? "pub"
                    : (n.namedChildren.find(
                        (c) => c.type === "visibility_modifier",
                      )?.text ??
                      (n.type === "enum_variant" ||
                      n.parent?.parent?.type === "trait_item"
                        ? "inherited"
                        : "private")),
                attributes: attrs,
                ...(actualKind === "method"
                  ? {
                      receiver:
                        field(n, "parameters")?.namedChildren.some(
                          (p) =>
                            p.type === "self_parameter" ||
                            field(p, "pattern")?.type === "self",
                        ) ?? false,
                    }
                  : {}),
                ...(n.type === "mod_item"
                  ? {
                      inline: !!field(n, "body"),
                      ...(() => {
                        const location = blockModuleLocation(n);
                        return location
                          ? { blockModuleLocation: location }
                          : {};
                      })(),
                      macroUseConditions: macroUseConditions(n),
                      ...(noImplicitPrelude(n)
                        ? { noImplicitPrelude: true }
                        : {}),
                      ...modulePath(n),
                    }
                  : {}),
                ...(n.type === "type_item"
                  ? {
                      aliasType:
                        type?.type === "tuple_type" &&
                        type.namedChildren.length === 1 &&
                        !type.children.some((c) => c.type === ",")
                          ? type.namedChildren[0]!.text
                          : (type?.text ?? ""),
                      aliasShape:
                        type?.type === "tuple_type" &&
                        type.namedChildren.length === 1 &&
                        !type.children.some((c) => c.type === ",")
                          ? "parenthesized_type"
                          : (type?.type ?? ""),
                      generics:
                        field(n, "type_parameters")?.namedChildren.map((p) =>
                          compact(field(p, "name")?.text ?? p.text),
                        ) ?? [],
                    }
                  : {}),
                ...(n.type === "impl_item"
                  ? {
                      implType: type?.text ?? "",
                      universal:
                        !!type &&
                        type.type === "generic_type" &&
                        (() => {
                          const parameters =
                            field(n, "type_parameters")
                              ?.namedChildren.filter(
                                (p) => p.type !== "lifetime_parameter",
                              )
                              .map((p) =>
                                compact(field(p, "name")?.text ?? p.text),
                              ) ?? [];
                          const args =
                            field(type, "type_arguments")
                              ?.namedChildren.filter(
                                (c) => c.type !== "lifetime",
                              )
                              .map((c) => compact(c.text)) ?? [];
                          return (
                            parameters.length > 0 &&
                            new Set(args).size === args.length &&
                            parameters.length === args.length &&
                            parameters.every((p, i) => p === args[i])
                          );
                        })(),
                      bounded:
                        !!n.namedChildren.find(
                          (c) => c.type === "where_clause",
                        ) ||
                        !!field(n, "type_parameters")?.descendantsOfType(
                          "trait_bounds",
                        ).length,
                      argumentSyntax: argumentSyntax(type),
                      trait: trait?.text ?? "",
                      generics:
                        field(n, "type_parameters")?.namedChildren.map((p) =>
                          compact(field(p, "name")?.text ?? p.text),
                        ) ?? [],
                    }
                  : {}),
              },
            });
            link(n, owner, scope, "contains", name, { key });
            nextOwner = key;
            nextScope = identity;
            if (n.type === "impl_item") {
              nextImpl = type?.text ?? "";
              if (trait)
                link(trait, key, scope, "implements", compact(trait.text));
            }
            if (
              n.type === "function_item" ||
              n.type === "function_signature_item"
            )
              nextFn = n;
            if (n.type === "mod_item" && !field(n, "body"))
              link(n, key, scope, "modules", name, { key });
          }
        }
        if (n.type === "extern_crate_declaration") {
          const name = field(n, "name");
          if (name)
            link(name, owner, scope, "imports", compact(name.text), {
              alias: field(n, "alias")?.text ?? name.text,
              externCrate: true,
              macroUseRequests: effectiveAttributes(n)
                .filter((a) => a.meta.name === "macro_use")
                .map((a) => ({
                  conditions: a.guards,
                  names: a.meta.args
                    ? payloads(a.meta.args).map((x) => x.name)
                    : null,
                })),
              visibility:
                n.namedChildren.find((c) => c.type === "visibility_modifier")
                  ?.text ?? "private",
            });
          const alias = field(n, "alias")?.text;
          if (
            alias &&
            ["std", "core"].includes(alias) &&
            field(n, "name")?.text !== alias
          )
            opaqueCrateAliases.push(alias);
        }
        if (n.type === "use_declaration") {
          imports(
            field(n, "argument")!,
            "",
            owner,
            scope,
            n.namedChildren.find((c) => c.type === "visibility_modifier")
              ?.text ?? "private",
            conditions,
          );
          return;
        }
        if (n.type === "macro_definition") return;
        if (n.type === "macro_invocation") {
          const m = field(n, "macro");
          if (m)
            link(m, owner, scope, "macros", compact(m.text), {
              genericBindings: genericBindings(fn ?? n),
            });
          const group = n.namedChildren.find((c) => c.type === "token_tree");
          if (m && group)
            for (const call of argumentCalls({
              name: compact(m.text),
              nameNode: m,
              group,
            }))
              tokenCall(call, owner, scope, fn, implType, implNode, implScope);
          if (
            !tailMacro(n) &&
            lexicalItemContainer(
              n.parent?.type === "expression_statement"
                ? n.parent.parent
                : n.parent,
            )
          )
            if (neutralMacro(n))
              standardMacroScopes.push({
                name: compact(m!.text),
                scope,
                start: m!.startIndex,
                // Only a block statement can bind locals that the
                // conservative binding facts (stdFallback*) describe.
                ...((n.parent?.type === "expression_statement"
                  ? n.parent.parent
                  : n.parent
                )?.type === "block"
                  ? { block: true }
                  : {}),
              });
            else opaqueItemScopes.add(scope);
          return;
        }
        if (n.type === "call_expression") {
          let f = field(n, "function");
          if (f?.type === "generic_function") f = field(f, "function");
          if (f) {
            const b = fn
              ? bindings(
                  fn,
                  n,
                  f.type === "field_expression"
                    ? field(f, "value")!.text
                    : f.text.split("::")[0]!,
                )
              : {
                  blocked: new Set<string>(),
                  types: new Map<string, ReceiverType>(),
                  invalidated: false,
                  conditional: new Set<string>(),
                };
            const old = fn
              ? bindings(
                  fn,
                  n,
                  f.type === "field_expression"
                    ? field(f, "value")!.text
                    : f.text.split("::")[0]!,
                  true,
                )
              : b;
            const fallbackBlocked = old.blocked.has(
              compact(f.text.split("::")[0]!),
            );
            if (f.type === "field_expression") {
              const receiver = field(f, "value")!;
              const method = field(f, "field")!;
              const receiverType =
                receiver.text === "self"
                  ? b.invalidated
                    ? ""
                    : implType
                  : (b.types.get(compact(receiver.text))?.name ??
                    (receiver.type === "struct_expression"
                      ? (field(receiver, "name")?.text ?? "")
                      : ""));
              link(f, owner, scope, "calls", f.text.replace(/\br#/g, ""), {
                genericBindings: genericBindings(fn ?? n),
                argumentCount: arity(field(n, "arguments")).maximum,
                argumentMinimum: arity(field(n, "arguments")).minimum,
                method: method.text,
                ...(!!receiverType &&
                receiver.type !== "struct_expression" &&
                (receiver.text === "self"
                  ? old.invalidated
                  : !old.types.has(compact(receiver.text)))
                  ? { stdFallbackReceiverUnknown: true }
                  : {}),
                receiverType,
                receiverArgumentSyntax:
                  receiver.text === "self"
                    ? argumentSyntax(implNode && field(implNode, "type"))
                    : (b.types.get(compact(receiver.text))?.argumentSyntax ??
                      argumentSyntax(
                        receiver.type === "struct_expression"
                          ? field(receiver, "name")
                          : null,
                      )),
                receiverBorrow:
                  receiver.text === "self"
                    ? receiverInfo(fn).borrow
                    : (b.types.get(compact(receiver.text))?.borrow ?? "owned"),
                receiverMutable:
                  receiver.text === "self"
                    ? receiverInfo(fn).mutable
                    : (b.types.get(compact(receiver.text))?.mutable ?? false),
                implKey: implNode ? `item:${implNode.startIndex}` : "",
                typeScope:
                  receiver.text === "self"
                    ? implScope
                    : (b.types.get(compact(receiver.text))?.scope ?? scope),
                implType,
                implScope,
                blocked:
                  !receiverType ||
                  genericShadow(n, receiverType.split("::")[0]!),
              });
            } else
              link(f, owner, scope, "calls", compact(f.text), {
                ...(fallbackBlocked &&
                !b.blocked.has(compact(f.text.split("::")[0]!))
                  ? { stdFallbackBlocked: true }
                  : {}),
                ...(old.conditional.has(compact(f.text.split("::")[0]!)) &&
                !b.conditional.has(compact(f.text.split("::")[0]!))
                  ? { stdFallbackConditional: true }
                  : {}),
                pathSyntax: f.text,
                pathArgumentSyntax: argumentSyntax(field(f, "path")),
                implArgumentSyntax: argumentSyntax(
                  implNode && field(implNode, "type"),
                ),
                genericBindings: genericBindings(fn ?? n),
                argumentCount: arity(field(n, "arguments")).maximum,
                argumentMinimum: arity(field(n, "arguments")).minimum,
                ...(b.conditional.has(compact(f.text.split("::")[0]!))
                  ? { conditionalBinding: true }
                  : {}),
                blocked:
                  b.blocked.has(compact(f.text.split("::")[0]!)) ||
                  genericShadow(n, f.text.split("::")[0]!),
                implType,
                implScope,
                implKey: implNode ? `item:${implNode.startIndex}` : "",
              });
          }
        }
        if (
          ["identifier", "scoped_identifier", "self"].includes(n.type) &&
          n.text !== "_" &&
          n.parent &&
          [
            "arguments",
            "block",
            "expression_statement",
            "return_expression",
            "array_expression",
            "tuple_expression",
            "binary_expression",
            "reference_expression",
            "assignment_expression",
            "match_arm",
            "field_initializer",
            "struct_expression",
            "let_declaration",
            "if_expression",
            "match_expression",
          ].includes(n.parent.type) &&
          field(n.parent, "pattern")?.id !== n.id &&
          field(n.parent, "name")?.id !== n.id &&
          !(
            n.parent.type === "match_arm" &&
            field(n.parent, "value")?.id !== n.id
          )
        ) {
          const b = fn ? bindings(fn, n, n.text.split("::")[0]!) : null;
          const old = fn ? bindings(fn, n, n.text.split("::")[0]!, true) : null;
          link(n, owner, scope, "values", compact(n.text), {
            ...(old?.blocked.has(compact(n.text.split("::")[0]!)) &&
            !b?.blocked.has(compact(n.text.split("::")[0]!))
              ? { stdFallbackBlocked: true }
              : {}),
            implType,
            implScope,
            blocked:
              n.type === "self" ||
              !!b?.blocked.has(compact(n.text.split("::")[0]!)) ||
              genericShadow(n, n.text.split("::")[0]!),
          });
        }
        // Outermost type paths only; don't treat declaration names as references.
        if (
          [
            "type_identifier",
            "scoped_type_identifier",
            ...(n.type === "identifier" &&
            n.parent?.type === "tuple_struct_pattern" &&
            field(n.parent, "type")?.id === n.id
              ? ["identifier"]
              : []),
            ...(n.type === "scoped_identifier" &&
            /pattern/.test(n.parent?.type ?? "")
              ? ["scoped_identifier"]
              : []),
          ].includes(n.type) &&
          n.parent?.type !== "scoped_type_identifier" &&
          (field(n.parent ?? n, "name")?.id !== n.id ||
            n.parent?.type === "struct_expression") &&
          n.parent?.type !== "type_parameter"
        ) {
          link(n, nextOwner, scope, "types", compact(n.text), {
            implType: nextImpl,
            implScope,
            blocked: genericShadow(n, n.text.split("::")[0]!),
          });
        }
        for (const c of n.namedChildren)
          visit(
            c,
            nextOwner,
            nextScope,
            n.type === "mod_item" ? null : nextFn,
            n.type === "mod_item" ? "" : nextImpl,
            n.type === "mod_item" ? nextScope : moduleScope,
            conditions,
          );
      }
      for (const n of tree.rootNode.namedChildren)
        visit(n, "file", "", null, "", "", conditionsOn(tree.rootNode));
      const opaqueAttributes: {
        scope: string;
        raw: string;
        name: string;
        start: number;
        module: string;
        conditions: string[];
        helper?: true;
        nested?: boolean;
      }[] = [];
      const declarationKeys = new Set(
        result.symbols.map((symbol) => symbol.key),
      );
      function attributes(n: Node): void {
        if (["attribute_item", "inner_attribute_item"].includes(n.type)) {
          let item =
            n.type === "inner_attribute_item" ? n.parent : n.nextNamedSibling;
          while (
            item &&
            ["attribute_item", "line_comment", "block_comment"].includes(
              item.type,
            )
          )
            item = item.nextNamedSibling;
          if (
            item &&
            lexicalItemContainer(
              n.type === "inner_attribute_item" ? item : item.parent,
            )
          )
            for (const app of applications(meta(n), item)) {
              const scope = lexicalScopes.get(item.id) ?? "";
              const helper = deriveHelper(app.meta, item, app.guards);
              opaqueAttributes.push({
                scope,
                name: app.meta.name,
                start: app.meta.start,
                ...(helper ?? {}),
                raw: `#[${app.meta.name}${app.meta.args?.text ?? (app.meta.value ? "=" + app.meta.value.text : "")}]`,
                conditions: app.guards,
                module:
                  item.type === "mod_item"
                    ? compact(field(item, "name")?.text ?? "")
                    : "",
              });
              const name = app.meta.name;
              const names =
                name === "derive" && app.meta.args
                  ? payloads(app.meta.args)
                  : !attributeRules.has(name.split("::")[0]!) && !helper
                    ? [app.meta]
                    : [];
              const key = `item:${item.startIndex}`;
              const owner = declarationKeys.has(key) ? key : "file";
              activeConditions = [...conditionsOn(item), ...app.guards];
              for (const target of names) {
                if (
                  !/^(?:::)?[_\p{ID_Start}][_\p{ID_Continue}]*(?:::[_\p{ID_Start}][_\p{ID_Continue}]*)*$/u.test(
                    target.name,
                  )
                )
                  continue;
                link(
                  item,
                  owner,
                  scope,
                  "macros",
                  target.name,
                  {
                    libraryMacroFlavor:
                      name === "derive" ? "derive" : "attribute",
                    libraryAttributeStart: app.meta.start,
                  },
                  {
                    start: target.start,
                    end: target.start + target.name.length,
                  },
                );
              }
            }
        }
        for (const c of n.namedChildren) attributes(c);
      }
      attributes(tree.rootNode);
      result.data = {
        // Source gates are interned separately from derived output conditions,
        // so cached analyzed facts can be analyzed again without feedback.
        hasSourceConditions: true,
        attributeContexts,
        attributeBindings: [...attributeBindings.values()].map((b) => ({
          scope: lexicalScopes.get(b.node.id) ?? "",
          names: [...b.names].sort(),
          unknown: b.unknown,
          helperUnknown: b.helperUnknown,
          macroUse: b.macroUse,
          macroUseImports: b.macroUseImports,
        })),
        opaqueCrateAliases,
        opaqueItemScopes: [...opaqueItemScopes],
        standardMacroScopes,
        opaqueAttributes,
      };
    },
  });
}
// These standard expansions cannot add bindings/items to the caller's scope.
// Identity is checked against captured bindings by the resolver (E4 assumption).
export const scopeNeutralStandardMacros = new Set([
  "print",
  "println",
  "eprint",
  "eprintln",
  "assert",
  "assert_eq",
  "assert_ne",
  "debug_assert",
  "debug_assert_eq",
  "debug_assert_ne",
  "vec",
  "format",
  "write",
  "writeln",
  "panic",
  "todo",
  "unreachable",
  "unimplemented",
  "dbg",
  "matches",
]);
export function standardMacroName(path: string): string | null {
  const match = /^(?:(?:::)?(?:std|core|alloc)::)?([a-z_]+)$/.exec(path);
  return match && scopeNeutralStandardMacros.has(match[1]!) ? match[1]! : null;
}
export async function parseRust(source: SourceInput): Promise<ParseResult> {
  try {
    const helper = await parser();
    pending = source;
    const result = helper.parse(source.text);
    if (
      result.status === "failed" &&
      !result.diagnostics[0]?.message.startsWith("line ")
    )
      throw new Error(
        "Rust parser internal error: " +
          (result.diagnostics[0]?.message ?? "no tree"),
      );
    return result;
  } catch (error) {
    throw new Error(
      `Rust parser internal error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    pending = undefined;
  }
}
