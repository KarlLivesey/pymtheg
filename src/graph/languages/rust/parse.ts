import type { Node } from "web-tree-sitter";
import { createTagsParser, tagsFromPackage } from "../../tree-sitter.js";
import type { ParseResult, SourceInput } from "../../types.js";

const field = (n: Node, name: string) => n.childForFieldName(name);
const span = (n: Node) => ({ start: n.startIndex, end: n.endIndex });
const compact = (s: string) => s.replace(/\s+/g, "").replace(/\br#/g, "");
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

/** Each invocation owns and frees its WASM resources. Only JSON facts escape. */
export async function parseRust({
  path,
  text,
}: SourceInput): Promise<ParseResult> {
  const helper = await createTagsParser({
    ...(await tagsFromPackage("tree-sitter-rust", "tree-sitter-rust.wasm")),
    // The bundled query emits function AND method at one start. The scoped AST
    // pass below maps all definitions once, including definitions absent from tags.
    mapDefinition: () => undefined,
    secondPass({ tree, result }) {
      result.symbols.push({
        key: "file",
        name: path,
        kind: "module",
        identity: "$crate",
        range: { start: 0, end: text.length },
        data: { scope: "", unit: true, visibility: "private" },
      });
      const link = (
        n: Node,
        owner: string,
        scope: string,
        kind: string,
        targetName: string,
        extra: Record<string, string | boolean | number> = {},
      ) => {
        if (targetName)
          result.links.push({
            sourceKey: owner,
            kind,
            targetName,
            range: span(n),
            data: { scope, ...extra },
          });
      };
      function imports(n: Node, prefix: string, owner: string, scope: string) {
        if (n.type === "scoped_use_list") {
          const p = field(n, "path")?.text;
          imports(
            field(n, "list")!,
            prefix + (p ? compact(p) + "::" : ""),
            owner,
            scope,
          );
        } else if (n.type === "use_list") {
          for (const c of n.namedChildren) imports(c, prefix, owner, scope);
        } else {
          const rename = n.type === "use_as_clause";
          let name = prefix + compact(rename ? field(n, "path")!.text : n.text);
          if (name.endsWith("::self")) name = name.slice(0, -6);
          const alias = rename
            ? field(n, "alias")!.text
            : name.split("::").at(-1)!;
          link(n, owner, scope, "imports", name, {
            alias,
            glob: n.type === "use_wildcard",
          });
        }
      }
      const lexicalScopes = new Map<number, string>();
      type ReceiverType = {
        name: string;
        scope: string;
        borrow: string;
        mutable: boolean;
      };
      // Build lexical binding evidence once per function. Each query visits only
      // its ancestor scopes and binary-searches the requested name's activations.
      type Binding = {
        pattern: Node;
        type: Node | null;
        start: number;
        order: number;
      };
      type BindingScopes = Map<number, Map<string, Binding[]>>;
      const bindingCache = new Map<number, BindingScopes>();
      function bindings(
        root: Node,
        at: Node,
        name: string,
      ): { blocked: Set<string>; types: Map<string, ReceiverType> } {
        name = compact(name);
        let scopes = bindingCache.get(root.id);
        if (!scopes) {
          scopes = new Map();
          let order = 0;
          const add = (
            pattern: Node | null,
            type: Node | null,
            region: Node,
            start: number,
          ) => {
            if (!pattern) return;
            const ids =
              pattern.type === "identifier"
                ? [pattern]
                : pattern.descendantsOfType("identifier");
            const names =
              scopes!.get(region.id) ?? new Map<string, Binding[]>();
            for (const id of ids) {
              const list = names.get(compact(id.text)) ?? [];
              list.push({
                pattern,
                type: pattern.type === "identifier" ? type : null,
                start,
                order: order++,
              });
              names.set(compact(id.text), list);
            }
            scopes!.set(region.id, names);
          };
          function scan(n: Node, parameterRegion: Node) {
            if (
              n.id !== root.id &&
              ["function_item", "impl_item", "mod_item"].includes(n.type)
            )
              return;
            if (n.type === "closure_expression") parameterRegion = n;
            if (n.type === "parameter")
              add(field(n, "pattern"), field(n, "type"), parameterRegion, 0);
            if (n.type === "let_declaration" && n.parent)
              add(field(n, "pattern"), field(n, "type"), n.parent, n.endIndex);
            if (n.type === "let_condition" && n.parent)
              add(field(n, "pattern"), null, n.parent, 0);
            if (
              [
                "closure_expression",
                "for_expression",
                "match_arm",
                "if_expression",
                "while_expression",
              ].includes(n.type)
            ) {
              add(field(n, "pattern"), null, n, 0);
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
          bindingCache.set(root.id, scopes);
        }
        const blocked = new Set<string>();
        const types = new Map<string, ReceiverType>();
        let ancestor: Node | null = at;
        while (ancestor) {
          const list = scopes.get(ancestor.id)?.get(name);
          if (list) {
            let lo = 0,
              hi = list.length;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (list[mid]!.start <= at.startIndex) lo = mid + 1;
              else hi = mid;
            }
            const item = list[lo - 1];
            if (item) {
              blocked.add(name);
              const { pattern, type } = item;
              if (
                type &&
                /^(?:&(?:'\w+\s+)?(?:mut\s+)?)?[\w:]+(?:<[^>]*>)?$/.test(
                  type.text.replace(/\br#/g, ""),
                )
              )
                types.set(name, {
                  name: compact(
                    type.text.replace(/^&(?:'\w+\s+)?(?:mut\s+)?/, ""),
                  ),
                  scope: lexicalScopes.get(type.id) ?? "",
                  borrow: /^&(?:'\w+\s+)?mut\s/.test(
                    type.text.replace(/\br#/g, ""),
                  )
                    ? "mutable"
                    : type.text.startsWith("&")
                      ? "shared"
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
        return { blocked, types };
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
      function visit(
        n: Node,
        owner: string,
        scope: string,
        fn: Node | null,
        implType: string,
        moduleScope = "",
      ) {
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
            const attrs: string[] = [];
            let previous = n.previousNamedSibling;
            while (previous?.type === "attribute_item") {
              attrs.unshift(previous.text);
              previous = previous.previousNamedSibling;
            }
            result.symbols.push({
              key,
              name,
              kind: actualKind,
              identity,
              range: span(n),
              data: {
                scope,
                moduleScope,
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
                      arity:
                        field(n, "parameters")?.namedChildren.filter(
                          (c) =>
                            c.type === "parameter" ||
                            c.type === "self_parameter",
                        ).length ?? 0,
                      receiverKind:
                        field(n, "parameters")?.namedChildren.find(
                          (c) => c.type === "self_parameter",
                        )?.text ??
                        (field(n, "parameters")?.namedChildren.some(
                          (c) => field(c, "pattern")?.type === "self",
                        )
                          ? "unknown"
                          : "none"),
                      defaultBody: !!field(n, "body"),
                    }
                  : {}),
                visibility:
                  n.namedChildren.find((c) => c.type === "visibility_modifier")
                    ?.text ??
                  (n.type === "enum_variant" ||
                  n.parent?.parent?.type === "trait_item"
                    ? "inherited"
                    : "private"),
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
                      path:
                        attrs
                          .join("\n")
                          .match(/#\[\s*path\s*=\s*"([^"]+)"\s*\]/)?.[1] ?? "",
                    }
                  : {}),
                ...(n.type === "impl_item"
                  ? {
                      implType: type?.text ?? "",
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
        if (n.type === "use_declaration") {
          imports(field(n, "argument")!, "", owner, scope);
          return;
        }
        if (n.type === "macro_definition") return;
        if (n.type === "macro_invocation") {
          const m = field(n, "macro");
          if (m) link(m, owner, scope, "macros", compact(m.text));
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
                };
            if (f.type === "field_expression") {
              const receiver = field(f, "value")!;
              const method = field(f, "field")!;
              const receiverType =
                receiver.text === "self"
                  ? implType
                  : (b.types.get(compact(receiver.text))?.name ??
                    (receiver.type === "struct_expression"
                      ? (field(receiver, "name")?.text ?? "")
                      : ""));
              const selfParameter =
                fn &&
                field(fn, "parameters")?.namedChildren.find(
                  (c) => c.type === "self_parameter",
                );
              link(f, owner, scope, "calls", f.text.replace(/\br#/g, ""), {
                argumentCount:
                  field(n, "arguments")?.namedChildren.filter(
                    (c) => !c.type.endsWith("comment"),
                  ).length ?? 0,
                method: method.text,
                receiverType,
                receiverBorrow:
                  receiver.text === "self"
                    ? !selfParameter
                      ? "unknown"
                      : selfParameter.text.includes("&mut")
                        ? "mutable"
                        : selfParameter.text.includes("&")
                          ? "shared"
                          : "owned"
                    : (b.types.get(compact(receiver.text))?.borrow ?? "owned"),
                receiverMutable:
                  b.types.get(compact(receiver.text))?.mutable ?? false,
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
                argumentCount:
                  field(n, "arguments")?.namedChildren.filter(
                    (c) => !c.type.endsWith("comment"),
                  ).length ?? 0,
                blocked:
                  b.blocked.has(compact(f.text.split("::")[0]!)) ||
                  genericShadow(n, f.text.split("::")[0]!),
                implType,
                implScope,
              });
          }
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
          field(n.parent ?? n, "name")?.id !== n.id &&
          n.parent?.type !== "type_parameter"
        ) {
          let patternParent: Node | null = n.parent;
          let pattern = false;
          while (
            patternParent &&
            ![
              "parameter",
              "let_declaration",
              "match_arm",
              "function_item",
              "call_expression",
              "block",
            ].includes(patternParent.type)
          ) {
            if (patternParent.type.endsWith("_pattern")) pattern = true;
            patternParent = patternParent.parent;
          }
          link(
            n,
            nextOwner,
            scope,
            pattern ? "patterns" : "types",
            compact(n.text),
            {
              implType: nextImpl,
              implScope,
              blocked: genericShadow(n, n.text.split("::")[0]!),
            },
          );
        }
        for (const c of n.namedChildren)
          visit(
            c,
            nextOwner,
            nextScope,
            n.type === "mod_item" ? null : nextFn,
            n.type === "mod_item" ? "" : nextImpl,
            n.type === "mod_item" ? nextScope : moduleScope,
          );
      }
      for (const n of tree.rootNode.namedChildren)
        visit(n, "file", "", null, "");
    },
  });
  try {
    return helper.parse(text);
  } finally {
    helper.dispose();
  }
}
