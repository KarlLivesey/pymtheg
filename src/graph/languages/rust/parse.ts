import type { Node } from "web-tree-sitter";
import { createTagsParser, tagsFromPackage } from "../../tree-sitter.js";
import type { ParseResult, SourceInput } from "../../types.js";

const field = (n: Node, name: string) => n.childForFieldName(name);
const span = (n: Node) => ({ start: n.startIndex, end: n.endIndex });
const compact = (s: string) => s.replace(/\s+/g, "");
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
        extra: Record<string, string | boolean> = {},
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
      type ReceiverType = { name: string; scope: string };
      // Binding facts are conservative: patterns/closures/for bindings with an
      // unknown type suppress resolution too. Scope containment prevents leakage.
      function bindings(
        root: Node,
        at: Node,
      ): { blocked: Set<string>; types: Map<string, ReceiverType> } {
        const blocked = new Set<string>();
        const types = new Map<string, ReceiverType>();
        function add(pattern: Node | null, type: Node | null) {
          if (!pattern) return;
          const ids =
            pattern.type === "identifier"
              ? [pattern]
              : pattern.descendantsOfType("identifier");
          for (const id of ids) {
            blocked.add(id.text);
            types.delete(id.text);
          }
          if (
            pattern.type === "identifier" &&
            type &&
            /^(?:&(?:'\w+\s+)?(?:mut\s+)?)?[\w:]+(?:<[^>]*>)?$/.test(type.text)
          )
            types.set(pattern.text, {
              name: compact(type.text.replace(/^&(?:'\w+\s+)?(?:mut\s+)?/, "")),
              scope: lexicalScopes.get(type.id) ?? "",
            });
        }
        function scan(n: Node) {
          if (
            n.id !== root.id &&
            ["function_item", "impl_item", "mod_item"].includes(n.type)
          )
            return;
          if (
            ["closure_expression", "for_expression", "match_arm"].includes(
              n.type,
            ) &&
            !(n.startIndex <= at.startIndex && n.endIndex >= at.endIndex)
          )
            return;
          if (
            n.type === "let_condition" &&
            n.parent &&
            n.parent.startIndex <= at.startIndex &&
            n.parent.endIndex >= at.endIndex
          )
            add(field(n, "pattern"), null);
          if (n.type === "parameter")
            add(field(n, "pattern"), field(n, "type"));
          if (
            n.type === "let_declaration" &&
            n.endIndex <= at.startIndex &&
            n.parent &&
            n.parent.startIndex <= at.startIndex &&
            n.parent.endIndex >= at.endIndex
          )
            add(field(n, "pattern"), field(n, "type"));
          if (
            [
              "closure_expression",
              "for_expression",
              "match_arm",
              "if_expression",
              "while_expression",
            ].includes(n.type) &&
            n.startIndex <= at.startIndex &&
            n.endIndex >= at.endIndex
          ) {
            add(field(n, "pattern"), null);
            const ps = field(n, "parameters");
            if (ps)
              for (const p of ps.namedChildren)
                add(p.type === "parameter" ? field(p, "pattern") : p, null);
          }
          for (const c of n.namedChildren) scan(c);
        }
        scan(root);
        return { blocked, types };
      }
      const blockNumbers = new Map<string, number>();
      function genericShadow(n: Node, name: string): boolean {
        let parent: Node | null = n;
        while (parent) {
          const parameters = field(parent, "type_parameters");
          if (
            parameters?.namedChildren.some(
              (p) => field(p, "name")?.text === name || p.text === name,
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
              : nameNode?.text;
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
                        field(n, "type_parameters")?.namedChildren.map(
                          (p) => field(p, "name")?.text ?? p.text,
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
              ? bindings(fn, n)
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
                  : (b.types.get(receiver.text)?.name ??
                    (receiver.type === "struct_expression"
                      ? (field(receiver, "name")?.text ?? "")
                      : ""));
              link(f, owner, scope, "calls", f.text, {
                method: method.text,
                receiverType,
                typeScope:
                  receiver.text === "self"
                    ? implScope
                    : (b.types.get(receiver.text)?.scope ?? scope),
                implType,
                implScope,
                blocked:
                  !receiverType ||
                  genericShadow(n, receiverType.split("::")[0]!),
              });
            } else
              link(f, owner, scope, "calls", compact(f.text), {
                blocked:
                  b.blocked.has(f.text.split("::")[0]!) ||
                  genericShadow(n, f.text.split("::")[0]!),
                implType,
                implScope,
              });
          }
        }
        // Outermost type paths only; don't treat declaration names as references.
        if (
          ["type_identifier", "scoped_type_identifier"].includes(n.type) &&
          n.parent?.type !== "scoped_type_identifier" &&
          field(n.parent ?? n, "name")?.id !== n.id &&
          n.parent?.type !== "type_parameter"
        ) {
          link(n, nextOwner, scope, "types", compact(n.text), {
            implType: nextImpl,
            implScope,
            blocked: genericShadow(n, n.text.split("::")[0]!),
          });
        }
        for (const c of n.namedChildren)
          visit(c, nextOwner, nextScope, nextFn, nextImpl);
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
