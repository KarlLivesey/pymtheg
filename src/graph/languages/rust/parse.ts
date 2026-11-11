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
      const opaqueCrateAliases: string[] = [];
      const opaqueImplTypes: {
        name: string;
        scope: string;
        semantic?: boolean;
        variables?: string;
      }[] = [];
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
        if (
          targetName &&
          !(["types", "patterns"].includes(kind) && targetName === "_")
        )
          result.links.push({
            sourceKey: owner,
            kind,
            targetName,
            range: span(n),
            data: { scope, ...extra },
          });
      };
      function imports(
        n: Node,
        prefix: string,
        owner: string,
        scope: string,
        visibility: string,
      ) {
        if (n.type === "scoped_use_list") {
          const p = field(n, "path")?.text;
          imports(
            field(n, "list")!,
            prefix + (p ? compact(p) + "::" : ""),
            owner,
            scope,
            visibility,
          );
        } else if (n.type === "use_list") {
          for (const c of n.namedChildren)
            imports(c, prefix, owner, scope, visibility);
        } else {
          const rename = n.type === "use_as_clause";
          let name = prefix + compact(rename ? field(n, "path")!.text : n.text);
          if (name.endsWith("::self")) name = name.slice(0, -6);
          const alias = rename
            ? field(n, "alias")!.text
            : name.split("::").at(-1)!;
          link(n, owner, scope, "imports", name, {
            alias,
            visibility,
            glob: n.type === "use_wildcard",
          });
        }
      }
      const argumentSyntaxCache = new Map<number, string>();
      function argumentSyntax(type: Node | null): string {
        if (!type) return "[]";
        const cached = argumentSyntaxCache.get(type.id);
        if (cached !== undefined) return cached;
        function syntax(n: Node): unknown | null {
          if (
            n.hasError ||
            n.isMissing ||
            [
              "ERROR",
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
      const lexicalScopes = new Map<number, string>();
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
      };
      type BindingScopes = Map<number, Map<string, Binding[]>>;
      const bindingCache = new Map<number, BindingScopes>();
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
          .filter((c) => field(n, "type")?.id !== c.id)
          .flatMap(patternNames);
      }
      function bindings(
        root: Node,
        at: Node,
        name: string,
      ): {
        blocked: Set<string>;
        types: Map<string, ReceiverType>;
        invalidated: boolean;
      } {
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
            if (
              n.type === "macro_invocation" &&
              n.parent?.type === "expression_statement" &&
              n.parent.parent?.type === "block"
            ) {
              for (const token of n.namedChildren
                .filter((c) => c.type === "token_tree")
                .flatMap((c) => c.descendantsOfType(["identifier", "self"])))
                if (!["self", "Self"].includes(compact(token.text)))
                  add(token, null, n.parent.parent, n.endIndex, true);
              return;
            }
            if (n.type === "closure_expression") parameterRegion = n;
            if (n.type === "parameter")
              add(field(n, "pattern"), field(n, "type"), parameterRegion, 0);
            if (n.type === "let_declaration" && n.parent)
              add(field(n, "pattern"), field(n, "type"), n.parent, n.endIndex);
            if (n.type === "let_condition") {
              let control = n.parent;
              while (
                control &&
                !["if_expression", "while_expression"].includes(control.type)
              )
                control = control.parent;
              const region =
                control &&
                (field(control, "consequence") ?? field(control, "body"));
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
          bindingCache.set(root.id, scopes);
        }
        let invalidated = false;
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
              invalidated = item.macro === true;
              const { pattern, type } = item;
              const nominal =
                type?.type === "reference_type" ? field(type, "type") : type;
              if (
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
        return { blocked, types, invalidated };
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
      function visit(
        n: Node,
        owner: string,
        scope: string,
        fn: Node | null,
        implType: string,
        moduleScope = "",
        unsafe = false,
      ) {
        unsafe ||= n.type === "ERROR" || n.isMissing;
        if (kinds[n.type]) {
          const body = field(n, "body");
          if (body?.children.some((c) => c.isMissing && c.type === "}"))
            unsafe = true;
          unsafe ||= n.namedChildren.some(
            (c) => c.id !== body?.id && (c.hasError || c.isMissing),
          );
          if (["struct_item", "enum_item", "type_item"].includes(n.type))
            unsafe ||= n.hasError;
        }
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
            while (
              previous &&
              ["attribute_item", "line_comment", "block_comment"].includes(
                previous.type,
              )
            ) {
              if (previous.type === "attribute_item") {
                attrs.unshift(previous.text);
                unsafe ||= previous.hasError;
              }
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
                unsafe,
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
                      receiverSyntax: receiverInfo(n).syntax,
                      receiverType: receiverInfo(n).type,
                      receiverMutable: receiverInfo(n).mutable,
                      defaultBody: !!field(n, "body"),
                    }
                  : {}),
                visibility:
                  actualKind === "macro" &&
                  attrs.some((a) =>
                    /^#\[\s*macro_export(?:\s*\]|\s*\()/.test(a),
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
                      path:
                        attrs
                          .join("\n")
                          .match(/#\[\s*path\s*=\s*"([^"]+)"\s*\]/)?.[1] ?? "",
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
          const alias = field(n, "alias")?.text;
          if (
            alias &&
            ["std", "core"].includes(alias) &&
            field(n, "name")?.text !== alias
          )
            opaqueCrateAliases.push(alias);
        }
        if (n.type === "use_declaration") {
          if (n.hasError) {
            link(
              n,
              owner,
              scope,
              "imports",
              compact(field(n, "argument")?.text ?? n.text),
              { unsafe: true, alias: "*", glob: true },
            );
            return;
          }
          imports(
            field(n, "argument")!,
            "",
            owner,
            scope,
            n.namedChildren.find((c) => c.type === "visibility_modifier")
              ?.text ?? "private",
          );
          return;
        }
        if (n.type === "macro_definition") return;
        if (n.type === "macro_invocation") {
          const m = field(n, "macro");
          if (m) link(m, owner, scope, "macros", compact(m.text));
          if (!fn || n.parent?.type === "expression_statement")
            for (const t of n.namedChildren
              .filter((c) => c.type === "token_tree")
              .flatMap((c) =>
                c.descendantsOfType(["identifier", "type_identifier", "self"]),
              ))
              if (["self", "Self"].includes(compact(t.text))) {
                if (implType)
                  opaqueImplTypes.push({
                    name: compact(implType),
                    scope: implScope,
                    semantic: true,
                    variables: genericBindings(fn ?? n),
                  });
              } else opaqueImplTypes.push({ name: compact(t.text), scope });
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
                };
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
                  unsafe ||
                  !receiverType ||
                  genericShadow(n, receiverType.split("::")[0]!),
              });
            } else
              link(f, owner, scope, "calls", compact(f.text), {
                pathSyntax: f.text,
                pathArgumentSyntax: argumentSyntax(field(f, "path")),
                implArgumentSyntax: argumentSyntax(
                  implNode && field(implNode, "type"),
                ),
                genericBindings: genericBindings(fn ?? n),
                argumentCount: arity(field(n, "arguments")).maximum,
                argumentMinimum: arity(field(n, "arguments")).minimum,
                blocked:
                  unsafe ||
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
          link(n, owner, scope, "values", compact(n.text), {
            implType,
            implScope,
            blocked:
              n.type === "self" ||
              unsafe ||
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
              blocked: unsafe || genericShadow(n, n.text.split("::")[0]!),
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
            unsafe,
          );
      }
      for (const n of tree.rootNode.namedChildren)
        visit(n, "file", "", null, "");
      // A closed function/closure body cannot swallow surrounding declarations.
      // Everywhere else an error can hide an item; do not infer its text.
      function declarationLossy(n: Node, closedBody = false): boolean {
        if (n.isMissing && n.type === "}") return true;
        if ((n.type === "ERROR" || n.isMissing) && !closedBody) return true;
        const item =
          !!kinds[n.type] ||
          n.type.endsWith("_item") ||
          ["use_declaration", "extern_crate_declaration"].includes(n.type) ||
          (n.type === "macro_invocation" &&
            [
              "source_file",
              "declaration_list",
              "expression_statement",
            ].includes(n.parent?.type ?? ""));
        for (const c of n.children) {
          let protectedBody = item ? false : closedBody;
          if (
            c.type === "block" &&
            ["function_item", "closure_expression"].includes(n.type)
          ) {
            const close = c.children.at(-1);
            protectedBody = close?.type === "}" && !close.isMissing;
          }
          if (declarationLossy(c, protectedBody)) return true;
        }
        return false;
      }
      result.data = {
        opaqueCrateAliases,
        opaqueImplTypes,
        declarationLossy: declarationLossy(tree.rootNode),
      };
      // No fact recovered inside an error or an invalid declaration header may
      // be used as proof. Containment remains structural, not semantic support.
      const bad = result.symbols.filter(
        (s) => (s.data as Record<string, unknown>)?.unsafe,
      );
      for (const l of result.links)
        if (
          l.kind !== "contains" &&
          bad.some(
            (s) => s.range.start <= l.range.start && s.range.end >= l.range.end,
          )
        )
          l.data = {
            ...(l.data as Record<string, import("../../types.js").Json>),
            blocked: true,
          };
    },
  });
  try {
    return helper.parse(text);
  } finally {
    helper.dispose();
  }
}
