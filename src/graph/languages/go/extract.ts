import { basename } from "node:path";
import type { Node } from "web-tree-sitter";
import type { Json, LinkDraft, SourceRange, SymbolDraft } from "../../types.js";
import {
  BUILTIN_FUNCTIONS,
  KNOWN_GOARCH,
  KNOWN_GOOS,
  PREDECLARED_TYPES,
  PREDECLARED_VALUES,
  type Desc,
  type FileFact,
  type ImportFact,
  type TypeRef,
} from "./model.js";

/** Scope nodes: each opens a lexical block whose declarations end with it. */
const SCOPES = new Set([
  "block",
  "for_statement",
  "if_statement",
  "expression_switch_statement",
  "select_statement",
  "expression_case",
  "type_case",
  "default_case",
  "communication_case",
]);
const range = (node: Node): SourceRange => ({
  start: node.startIndex,
  end: node.endIndex,
});
const compact = (node: Node): string => {
  const text = node.text.replace(/\s+/g, "");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};
const named = (node: Node | null | undefined): Node[] =>
  node ? node.namedChildren.filter((child) => child.type !== "comment") : [];
const unparen = (node: Node): Node => {
  let current = node;
  while (
    (current.type === "parenthesized_expression" ||
      current.type === "parenthesized_type") &&
    named(current).length === 1
  )
    current = named(current)[0]!;
  return current;
};

export function fileFacts(path: string): FileFact {
  const fact: FileFact = { imports: [], test: path.endsWith("_test.go") };
  const parts = basename(path, ".go").split("_");
  if (fact.test) parts.pop();
  const last = parts.at(-1);
  const previous = parts.at(-2);
  if (parts.length > 1 && last !== undefined) {
    if (KNOWN_GOARCH.has(last)) {
      fact.goarch = last;
      if (
        parts.length > 2 &&
        previous !== undefined &&
        KNOWN_GOOS.has(previous)
      )
        fact.goos = previous;
    } else if (KNOWN_GOOS.has(last)) fact.goos = last;
  }
  return fact;
}

/** A local variable during extraction: its declared value and every later write. */
interface Binding {
  d: Desc;
  writes: Desc[];
  /** Some write is not knowable (address taken, op-assignment, range/receive `=`). */
  opaque: boolean;
}

/**
 * Extracts Go declarations and references from one file's syntax tree.
 * Pure function of the source text: no project, disk or toolchain access.
 */
export class GoExtractor {
  readonly symbols: SymbolDraft[] = [];
  readonly links: LinkDraft[] = [];
  readonly fact: FileFact;
  private scopes: Map<string, Desc>[] = [];
  private byKey = new Map<string, SymbolDraft>();
  private owner = "file";
  /** Inside a declaration with a syntax error: no call/reference links (see W2-B.md). */
  private quiet = false;

  constructor(
    private readonly path: string,
    private readonly text: string,
  ) {
    this.fact = fileFacts(path);
  }

  run(root: Node): void {
    const fileData: { [key: string]: Json } = {};
    this.symbols.push({
      key: "file",
      name: basename(this.path),
      kind: "file",
      identity: basename(this.path),
      range: { start: 0, end: this.text.length },
      data: fileData,
    });
    let beforePackage = true;
    for (const child of root.namedChildren) {
      if (child.type === "comment") {
        if (beforePackage) this.buildLine(child.text);
      } else if (child.type === "package_clause") {
        beforePackage = false;
        const name = named(child).find(
          (item) => item.type === "package_identifier",
        );
        if (name) {
          this.fact.package = name.text;
          this.fact.packageRange = range(name);
        }
      } else {
        beforePackage = false;
        this.topLevel(child);
      }
    }
    // Live local bindings become plain JSON only now that every write has been seen.
    for (const link of this.links) {
      const expr = (link.data as { expr?: Desc } | undefined)?.expr;
      if (expr && link.data && typeof link.data === "object")
        (link.data as { [key: string]: Json }).expr = this.finalize(
          expr,
        ) as unknown as Json;
    }
    fileData.test = this.fact.test;
    if (this.fact.package !== undefined) fileData.package = this.fact.package;
    if (this.fact.build !== undefined) fileData.build = this.fact.build;
    if (this.fact.goos !== undefined) fileData.goos = this.fact.goos;
    if (this.fact.goarch !== undefined) fileData.goarch = this.fact.goarch;
  }

  private buildLine(comment: string): void {
    const modern = /^\/\/go:build\s+(.+)$/.exec(comment.trim());
    if (modern) this.fact.build = modern[1]!.trim();
    const legacy = /^\/\/\s*\+build\s+(.+)$/.exec(comment.trim());
    if (legacy && this.fact.build === undefined)
      this.fact.build = `+build ${legacy[1]!.trim()}`;
  }

  // ---- symbols and links -------------------------------------------------

  private symbol(
    kind: string,
    name: string,
    identity: string,
    span: SourceRange,
    data?: { [key: string]: Json },
  ): string {
    const key = `${kind}:${span.start}:${identity}`;
    const symbol: SymbolDraft = {
      key,
      name,
      kind,
      identity,
      range: span,
      ...(data ? { data } : {}),
    };
    this.symbols.push(symbol);
    this.byKey.set(key, symbol);
    return key;
  }
  private link(
    kind: string,
    targetName: string,
    span: SourceRange,
    data?: { [key: string]: Json },
    source = this.owner,
  ): void {
    if (this.quiet && (kind === "calls" || kind === "references")) return;
    this.links.push({
      sourceKey: source,
      kind,
      targetName,
      range: span,
      ...(data ? { data } : {}),
    });
  }
  private contains(parent: string, child: string, span: SourceRange): void {
    const symbol = this.byKey.get(child)!;
    this.link("contains", symbol.identity, span, { child }, parent);
  }
  private within(owner: string, action: () => void): void {
    const previous = this.owner;
    this.owner = owner;
    try {
      action();
    } finally {
      this.owner = previous;
    }
  }
  private scoped(action: () => void, initial?: Map<string, Desc>): void {
    this.scopes.push(initial ?? new Map());
    try {
      action();
    } finally {
      this.scopes.pop();
    }
  }
  /** Declares a local in the innermost scope; variables become live bindings. */
  private declare(name: string, desc: Desc): void {
    if (name === "_" || !this.scopes.length) return;
    const binding: Binding = { d: desc, writes: [], opaque: false };
    this.scopes
      .at(-1)!
      .set(name, desc.k === "localtype" ? desc : { k: "ref", b: binding });
  }
  /** Records a write to a local variable; null means the written value is not knowable. */
  private write(name: string, desc: Desc | null): void {
    const found = this.local(name);
    if (found?.k !== "ref") return;
    const binding = found.b as Binding;
    if (desc === null) binding.opaque = true;
    else binding.writes.push(desc);
  }
  /** Replaces live bindings with plain descriptions. Cycles and deep chains become `local`. */
  private finalize(desc: Desc, stack: Binding[] = []): Desc {
    const next = (item: Desc) => this.finalize(item, stack);
    switch (desc.k) {
      case "ref": {
        const binding = desc.b as Binding;
        if (stack.includes(binding) || stack.length > 6) return { k: "local" };
        const inner = [...stack, binding];
        const d = this.finalize(binding.d, inner);
        if (!binding.writes.length && !binding.opaque) return d;
        if (binding.opaque) return { k: "var", d };
        return {
          k: "var",
          d,
          alts: [
            d,
            ...binding.writes.map((write) => this.finalize(write, inner)),
          ],
        };
      }
      case "sel":
        return { k: "sel", x: next(desc.x), n: desc.n };
      case "inst":
        return { k: "inst", x: next(desc.x) };
      case "call":
        return desc.b
          ? { k: "call", f: next(desc.f), i: desc.i, b: next(desc.b) }
          : { k: "call", f: next(desc.f), i: desc.i };
      case "elem":
      case "key":
        return { k: desc.k, x: next(desc.x) };
      case "cont":
        return {
          k: "cont",
          e: next(desc.e),
          ...(desc.key ? { key: next(desc.key) } : {}),
          ...(desc.ch ? { ch: true } : {}),
        };
      case "func":
        return { k: "func", r: desc.r.map(next) };
      case "var":
        return desc.alts
          ? { k: "var", d: next(desc.d), alts: desc.alts.map(next) }
          : { k: "var", d: next(desc.d) };
      default:
        return desc;
    }
  }
  /** The innermost operand of a selector/call chain, looking through bindings. */
  private rootKind(desc: Desc, depth = 0): string {
    if (depth > 12) return "unknown";
    if (desc.k === "ref")
      return this.rootKind((desc.b as Binding).d, depth + 1);
    if (desc.k === "sel" || desc.k === "elem" || desc.k === "key")
      return this.rootKind(desc.x, depth + 1);
    if (desc.k === "call") return this.rootKind(desc.f, depth + 1);
    return desc.k;
  }
  private local(name: string): Desc | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index--) {
      const found = this.scopes[index]!.get(name);
      if (found) return found;
    }
    return undefined;
  }

  // ---- declarations ------------------------------------------------------

  private topLevel(node: Node): void {
    if (node.type === "ERROR") return;
    const previous = this.quiet;
    this.quiet = node.hasError;
    try {
      this.declaration(node);
    } finally {
      this.quiet = previous;
    }
  }

  private declaration(node: Node): void {
    switch (node.type) {
      case "import_declaration":
        for (const spec of node.descendantsOfType("import_spec"))
          if (spec) this.importSpec(spec);
        return;
      case "function_declaration":
        return this.functionDeclaration(node);
      case "method_declaration":
        return this.methodDeclaration(node);
      case "type_declaration":
        for (const spec of named(node))
          if (spec.type === "type_spec" || spec.type === "type_alias")
            this.typeSpec(spec);
        return;
      case "var_declaration":
      case "const_declaration":
        for (const spec of this.valueSpecs(node))
          this.packageValue(spec, node.type === "var_declaration");
        return;
      default:
        // Recovered stray fragments outside ERROR nodes still yield references.
        this.within("file", () => this.walk(node));
    }
  }

  private importSpec(spec: Node): void {
    const pathNode = spec.childForFieldName("path");
    if (!pathNode) return;
    const content = named(pathNode)[0];
    const path = content ? content.text : pathNode.text.slice(1, -1);
    if (!path) return;
    const nameNode = spec.childForFieldName("name");
    const fact: ImportFact = { path };
    if (nameNode) fact.alias = nameNode.text;
    this.fact.imports.push(fact);
    this.link(
      "imports",
      path,
      range(spec),
      fact.alias === undefined ? { path } : { path, alias: fact.alias },
      "file",
    );
  }

  /** Type parameters with their constraint when it is a single named (non-predeclared) type. */
  private typeParams(list: Node | null): Map<string, Desc> {
    const scope = new Map<string, Desc>();
    for (const declaration of named(list)) {
      const constraint = named(declaration.childForFieldName("type"));
      const ref = constraint.length === 1 ? this.typeRef(constraint[0]!) : null;
      const desc: Desc =
        ref && ref.q !== ""
          ? { k: "localtype", tp: true, c: ref }
          : { k: "localtype", tp: true };
      for (const name of declaration.childrenForFieldName("name"))
        if (name) scope.set(name.text, desc);
    }
    return scope;
  }
  private walkTypeParams(list: Node | null): void {
    for (const declaration of named(list)) {
      const type = declaration.childForFieldName("type");
      if (type) this.walk(type);
    }
  }

  private functionDeclaration(node: Node): void {
    const name = node.childForFieldName("name");
    if (!name) return this.within("file", () => this.walk(node));
    const parameters = node.childForFieldName("parameters");
    const result = node.childForFieldName("result");
    const typeParameters = node.childForFieldName("type_parameters");
    const scope = this.typeParams(typeParameters);
    const key = this.symbol("function", name.text, name.text, range(node), {
      ...this.signatureData(parameters, result, scope),
      ...(scope.size ? { generic: true } : {}),
    });
    this.contains("file", key, range(node));
    this.within(key, () =>
      this.scoped(() => {
        this.walkTypeParams(typeParameters);
        this.parameters(parameters);
        this.parameters(result);
        const body = node.childForFieldName("body");
        if (body) this.walk(body);
      }, scope),
    );
  }

  private methodDeclaration(node: Node): void {
    const name = node.childForFieldName("name");
    const receiver = node.childForFieldName("receiver");
    if (!name || !receiver) return this.within("file", () => this.walk(node));
    const declaration = named(receiver)[0];
    let typeNode = declaration?.childForFieldName("type") ?? null;
    let pointer = false;
    const scope = new Map<string, Desc>();
    if (typeNode && unparen(typeNode).type === "pointer_type") {
      pointer = true;
      typeNode = named(unparen(typeNode))[0] ?? null;
    }
    if (typeNode && typeNode.type === "generic_type") {
      for (const argument of typeNode.descendantsOfType("type_identifier"))
        if (argument && argument.parent?.type !== "generic_type")
          scope.set(argument.text, { k: "localtype", tp: true });
      typeNode = typeNode.childForFieldName("type");
    }
    const receiverType =
      typeNode?.type === "type_identifier" ? typeNode.text : "?";
    const identity = `(${pointer ? "*" : ""}${receiverType}).${name.text}`;
    const parameters = node.childForFieldName("parameters");
    const result = node.childForFieldName("result");
    const key = this.symbol("method", name.text, identity, range(node), {
      receiver: receiverType,
      pointer,
      ...this.signatureData(parameters, result, scope),
    });
    this.contains("file", key, range(node));
    this.within(key, () =>
      this.scoped(() => {
        if (typeNode?.type === "type_identifier")
          this.link("receiver", receiverType, range(typeNode), {
            t: { n: receiverType },
          });
        const receiverName = declaration?.childForFieldName("name");
        if (receiverName && receiverType !== "?")
          this.declare(receiverName.text, {
            k: "val",
            t: { n: receiverType },
          });
        this.parameters(parameters);
        this.parameters(result);
        const body = node.childForFieldName("body");
        if (body) this.walk(body);
      }, scope),
    );
  }

  private typeSpec(spec: Node): void {
    const name = spec.childForFieldName("name");
    const type = spec.childForFieldName("type");
    if (!name || !type) return this.within("file", () => this.walk(spec));
    const typeParameters = spec.childForFieldName("type_parameters");
    const scope = this.typeParams(typeParameters);
    const kind =
      spec.type === "type_alias"
        ? "alias"
        : type.type === "struct_type"
          ? "struct"
          : type.type === "interface_type"
            ? "interface"
            : "type";
    const data: { [key: string]: Json } = {};
    if (scope.size) data.generic = true;
    const key = this.symbol(kind, name.text, name.text, range(spec), data);
    this.contains("file", key, range(spec));
    this.within(key, () =>
      this.scoped(() => {
        this.walkTypeParams(typeParameters);
        if (kind === "alias" || kind === "type") {
          const underlying = this.typeRef(type);
          if (underlying) data.underlying = { ...underlying };
          // A named func type: its result types are written in its declaration.
          if (unparen(type).type === "function_type")
            data.fn = this.resultDescs(
              unparen(type).childForFieldName("result"),
            ) as unknown as Json[];
        }
        if (kind === "struct") this.structFields(name.text, key, type);
        else if (kind === "interface")
          this.interfaceElements(name.text, key, type, data);
        else this.walk(type);
      }, scope),
    );
  }

  private structFields(owner: string, ownerKey: string, struct: Node): void {
    for (const list of named(struct))
      for (const field of named(list)) {
        if (field.type !== "field_declaration") continue;
        const type = field.childForFieldName("type");
        if (!type) continue;
        const names = field
          .childrenForFieldName("name")
          .filter((item): item is Node => !!item);
        const ref = this.typeRef(type);
        if (names.length) {
          let first: string | undefined;
          for (const name of names) {
            const key = this.symbol(
              "field",
              name.text,
              `${owner}.${name.text}`,
              { start: name.startIndex, end: field.endIndex },
              {
                owner,
                ...(ref ? { t: { ...ref } } : {}),
                v: this.typedValue(type) as unknown as Json,
              },
            );
            this.contains(ownerKey, key, {
              start: name.startIndex,
              end: field.endIndex,
            });
            first ??= key;
          }
          this.within(first!, () => this.walk(type));
        } else {
          // Embedded field: its name is the type's name; an `embeds` link replaces the type reference.
          let inner = unparen(type);
          if (inner.type === "pointer_type") inner = named(inner)[0] ?? inner;
          const base =
            inner.type === "generic_type"
              ? (inner.childForFieldName("type") ?? inner)
              : inner;
          if (!ref) {
            this.within(ownerKey, () => this.walk(type));
            continue;
          }
          // The grammar puts the `*` of an embedded `*T` beside the type, not in a pointer_type.
          const embeddedPointer =
            unparen(type).type === "pointer_type" ||
            field.children.some(
              (child) => !!child && !child.isNamed && child.type === "*",
            );
          const key = this.symbol(
            "field",
            ref.n,
            `${owner}.${ref.n}`,
            range(field),
            {
              owner,
              t: { ...ref },
              embedded: true,
              pointer: embeddedPointer,
            },
          );
          this.contains(ownerKey, key, range(field));
          this.link(
            "embeds",
            compact(base),
            range(base),
            { t: { ...ref }, pointer: embeddedPointer },
            ownerKey,
          );
          if (inner.type === "generic_type") {
            const args = inner.childForFieldName("type_arguments");
            if (args) this.within(key, () => this.walk(args));
          }
        }
      }
  }

  private interfaceElements(
    owner: string,
    ownerKey: string,
    iface: Node,
    data: { [key: string]: Json },
  ): void {
    for (const element of named(iface)) {
      if (element.type === "method_elem") {
        const name = element.childForFieldName("name");
        if (!name) continue;
        const parameters = element.childForFieldName("parameters");
        const result = element.childForFieldName("result");
        const key = this.symbol(
          "method",
          name.text,
          `${owner}.${name.text}`,
          range(element),
          {
            owner,
            interface: true,
            ...this.signatureData(parameters, result, new Map()),
          },
        );
        this.contains(ownerKey, key, range(element));
        this.within(key, () => {
          this.parameters(parameters, false);
          this.parameters(result, false);
        });
      } else if (element.type === "type_elem") {
        const parts = named(element);
        const only = parts.length === 1 ? parts[0]! : undefined;
        const ref = only ? this.typeRef(only) : null;
        if (only && ref && ref.q !== "" && only.type !== "pointer_type") {
          const base =
            only.type === "generic_type"
              ? (only.childForFieldName("type") ?? only)
              : only;
          this.link("embeds", compact(base), range(base), { t: { ...ref } });
          if (only.type === "generic_type") {
            const args = only.childForFieldName("type_arguments");
            if (args) this.walk(args);
          }
        } else {
          // Union or approximation element: a type-set constraint, not a method set.
          data.constraint = true;
          this.walk(element);
        }
      } else this.walk(element);
    }
  }

  private valueSpecs(declaration: Node): Node[] {
    const specs: Node[] = [];
    for (const child of named(declaration))
      if (child.type === "var_spec" || child.type === "const_spec")
        specs.push(child);
      else if (
        child.type === "var_spec_list" ||
        child.type === "const_spec_list"
      )
        specs.push(
          ...named(child).filter(
            (item) => item.type === "var_spec" || item.type === "const_spec",
          ),
        );
    return specs;
  }

  /** Descriptions of each name's value: declared type, matching initializer or multi-value call. */
  private specDescs(names: Node[], type: Node | null, values: Node[]): Desc[] {
    const declared = type ? this.typedValue(type) : null;
    return names.map((_, index): Desc => {
      if (declared) return declared;
      if (values.length === names.length) return this.desc(values[index]!);
      if (values.length === 1) {
        const value = values[0]!;
        const whole = this.desc(value);
        if (whole.k === "call") return { ...whole, i: index };
        if (index === 0) return whole;
      }
      return { k: "local" };
    });
  }

  private packageValue(spec: Node, variable: boolean): void {
    const names = spec
      .childrenForFieldName("name")
      .filter((item): item is Node => !!item);
    const type = spec.childForFieldName("type");
    const values = named(spec.childForFieldName("value"));
    const descs = this.specDescs(names, type, values);
    const keys = names.map((name, index) =>
      name.text === "_"
        ? "file"
        : this.symbol(
            variable ? "var" : "const",
            name.text,
            name.text,
            { start: name.startIndex, end: spec.endIndex },
            { d: descs[index]! as unknown as Json },
          ),
    );
    for (const key of keys)
      if (key !== "file")
        this.contains("file", key, {
          start: this.byKey.get(key)!.range.start,
          end: spec.endIndex,
        });
    const first = keys.find((key) => key !== "file") ?? "file";
    if (type) this.within(first, () => this.walk(type));
    values.forEach((value, index) =>
      this.within(values.length === names.length ? keys[index]! : first, () =>
        this.walk(value),
      ),
    );
  }

  /** Declares parameters in the current scope (when `declare`) and links their types. */
  private parameters(list: Node | null, declare = true): void {
    if (!list) return;
    if (list.type !== "parameter_list") {
      // A single unnamed result type.
      this.walk(list);
      return;
    }
    for (const parameter of named(list)) {
      const type = parameter.childForFieldName("type");
      if (type) this.walk(type);
      if (!declare) continue;
      const value: Desc = type ? this.typedValue(type) : { k: "local" };
      const variadic = parameter.type === "variadic_parameter_declaration";
      for (const name of parameter.childrenForFieldName("name"))
        if (name)
          this.declare(name.text, variadic ? { k: "cont", e: value } : value);
    }
  }

  private signatureData(
    parameters: Node | null,
    result: Node | null,
    scope: Map<string, Desc>,
  ): { [key: string]: Json } {
    this.scopes.push(scope);
    try {
      const results = this.resultDescs(result) as unknown as Json[];
      const list = (node: Node | null): string[] =>
        named(node).flatMap((parameter) => {
          const type = parameter.childForFieldName("type");
          const text =
            (parameter.type === "variadic_parameter_declaration" ? "..." : "") +
            (type ? this.template(type) : "?");
          return Array(
            Math.max(1, parameter.childrenForFieldName("name").length),
          ).fill(text);
        });
      const resultText =
        result?.type === "parameter_list"
          ? list(result).join(",")
          : result
            ? this.template(result)
            : "";
      return {
        results,
        sig: `(${list(parameters).join(",")})(${resultText})`,
      };
    } finally {
      this.scopes.pop();
    }
  }

  /** Type text with named types marked for package-qualified comparison during resolution. */
  private template(node: Node): string {
    if (node.type === "type_identifier") {
      if (this.local(node.text)) return `?${node.text}`;
      return PREDECLARED_TYPES.has(node.text)
        ? node.text
        : `\u0001${node.text}\u0003`;
    }
    if (node.type === "qualified_type") {
      const pkg = node.childForFieldName("package")?.text ?? "";
      const name = node.childForFieldName("name")?.text ?? "";
      return `\u0002${pkg}.${name}\u0003`;
    }
    if (
      node.type === "parameter_declaration" ||
      node.type === "variadic_parameter_declaration"
    ) {
      const type = node.childForFieldName("type");
      return (
        (node.type === "variadic_parameter_declaration" ? "..." : "") +
        (type ? this.template(type) : "?")
      );
    }
    if (node.childCount === 0) return node.text;
    const parts: string[] = [];
    for (const child of node.children)
      if (child && child.type !== "comment")
        parts.push(child.isNamed ? this.template(child) : child.text);
    return parts.join(" ");
  }

  /** One value description per declared result. */
  private resultDescs(result: Node | null): Desc[] {
    if (!result) return [];
    if (result.type !== "parameter_list") return [this.typedValue(result)];
    return named(result).flatMap((parameter) => {
      const type = parameter.childForFieldName("type");
      const value: Desc = type ? this.typedValue(type) : { k: "local" };
      return Array<Desc>(
        Math.max(1, parameter.childrenForFieldName("name").length),
      ).fill(value);
    });
  }

  /** What is known about a value of the written type. */
  private typedValue(node: Node): Desc {
    const current = unparen(node);
    const field = (name: string) => current.childForFieldName(name);
    const of = (child: Node | null): Desc =>
      child ? this.typedValue(child) : { k: "local" };
    switch (current.type) {
      case "pointer_type":
        return of(named(current)[0] ?? null);
      case "generic_type":
        return of(field("type"));
      case "type_identifier": {
        const bound = this.local(current.text);
        if (bound?.k === "localtype")
          return bound.tp
            ? bound.c
              ? { k: "tval", c: { ...bound.c } }
              : { k: "tval" }
            : { k: "opaque" };
        if (bound) return { k: "local" };
        return PREDECLARED_TYPES.has(current.text)
          ? { k: "val", t: { q: "", n: current.text } }
          : { k: "val", t: { n: current.text } };
      }
      case "qualified_type": {
        const ref = this.typeRef(current);
        return ref ? { k: "val", t: ref } : { k: "local" };
      }
      case "slice_type":
      case "array_type":
      case "implicit_length_array_type":
        return { k: "cont", e: of(field("element")) };
      case "map_type":
        return { k: "cont", e: of(field("value")), key: of(field("key")) };
      case "channel_type":
        return { k: "cont", e: of(field("value")), ch: true };
      case "function_type":
        return { k: "func", r: this.resultDescs(field("result")) };
      default:
        return { k: "local" };
    }
  }

  /** The named type of a type expression, or null for composite/unnamed types. Universe types use q "". */
  private typeRef(node: Node): TypeRef | null {
    let current = unparen(node);
    if (current.type === "pointer_type")
      current = unparen(named(current)[0] ?? current);
    if (current.type === "generic_type")
      current = current.childForFieldName("type") ?? current;
    if (current.type === "type_identifier") {
      if (this.local(current.text)) return null;
      return PREDECLARED_TYPES.has(current.text)
        ? { q: "", n: current.text }
        : { n: current.text };
    }
    if (current.type === "qualified_type") {
      const pkg = current.childForFieldName("package");
      const name = current.childForFieldName("name");
      return pkg && name ? { q: pkg.text, n: name.text } : null;
    }
    return null;
  }

  // ---- expressions -------------------------------------------------------

  /** Syntactic description of an expression's value; never consults other files. */
  private desc(node: Node): Desc {
    const current = unparen(node);
    switch (current.type) {
      case "identifier": {
        const bound = this.local(current.text);
        if (bound?.k === "localtype") return { k: "opaque" };
        if (bound) return bound;
        return { k: "name", n: current.text };
      }
      case "selector_expression": {
        const operand = current.childForFieldName("operand");
        const field = current.childForFieldName("field");
        if (!operand || !field) return { k: "unknown" };
        return { k: "sel", x: this.desc(operand), n: field.text };
      }
      case "unary_expression": {
        const operator = current.child(0)?.text;
        const operand = current.childForFieldName("operand");
        if (!operand) return { k: "unknown" };
        if (operator === "&" || operator === "*") return this.desc(operand);
        if (operator === "<-") return { k: "elem", x: this.desc(operand) };
        return { k: "unknown" };
      }
      case "composite_literal":
      case "type_assertion_expression": {
        const type = current.childForFieldName("type");
        return type ? this.typedValue(type) : { k: "unknown" };
      }
      case "index_expression": {
        const operand = current.childForFieldName("operand");
        return operand
          ? { k: "elem", x: this.desc(operand) }
          : { k: "unknown" };
      }
      case "slice_expression": {
        const operand = current.childForFieldName("operand");
        return operand ? this.desc(operand) : { k: "unknown" };
      }
      case "func_literal":
        return {
          k: "func",
          r: this.resultDescs(current.childForFieldName("result")),
        };
      case "call_expression": {
        const fn = current.childForFieldName("function");
        if (!fn) return { k: "unknown" };
        const callee = unparen(fn);
        const args = named(current.childForFieldName("arguments"));
        if (callee.type === "identifier" && !this.local(callee.text)) {
          // new(T), make(T, …) and append(s, …) have syntactically evident results
          // only if the builtin is what is called. A package-level declaration in
          // any file may shadow it, so resolution decides: `b` is used only when
          // the name does not resolve to a declaration.
          const hint =
            (callee.text === "new" || callee.text === "make") && args[0]
              ? this.typedValue(args[0])
              : callee.text === "append" && args[0]
                ? this.desc(args[0])
                : undefined;
          if (hint)
            return {
              k: "call",
              f: { k: "name", n: callee.text },
              i: 0,
              b: hint,
            };
        }
        const f = this.calleeDesc(callee);
        return f ? { k: "call", f, i: 0 } : { k: "unknown" };
      }
      case "type_conversion_expression": {
        const type = current.childForFieldName("type");
        if (!type) return { k: "unknown" };
        const f = this.typeNameDesc(type);
        return f ? { k: "call", f, i: 0 } : this.typedValue(type);
      }
      default:
        return { k: "unknown" };
    }
  }
  private calleeDesc(callee: Node): Desc | null {
    if (
      callee.type === "identifier" ||
      callee.type === "selector_expression" ||
      callee.type === "func_literal" ||
      callee.type === "call_expression"
    )
      return this.desc(callee);
    if (callee.type === "index_expression") {
      const operand = callee.childForFieldName("operand");
      return operand ? this.calleeDesc(unparen(operand)) : null;
    }
    return null;
  }
  private typeNameDesc(type: Node): Desc | null {
    const current =
      type.type === "generic_type"
        ? (type.childForFieldName("type") ?? type)
        : type;
    if (current.type === "type_identifier") {
      if (this.local(current.text)) return null;
      if (PREDECLARED_TYPES.has(current.text)) return null;
      return { k: "name", n: current.text };
    }
    if (current.type === "qualified_type") {
      const pkg = current.childForFieldName("package");
      const name = current.childForFieldName("name");
      return pkg && name
        ? { k: "sel", x: { k: "name", n: pkg.text }, n: name.text }
        : null;
    }
    return null;
  }

  private walkChildren(node: Node): void {
    for (const child of node.namedChildren) if (child) this.walk(child);
  }

  private walk(node: Node): void {
    if (SCOPES.has(node.type)) {
      this.scoped(() => this.walkChildren(node));
      return;
    }
    switch (node.type) {
      case "comment":
      case "ERROR":
        // Misparsed regions yield no facts: their identifiers cannot be trusted.
        return;
      case "short_var_declaration": {
        const left = named(node.childForFieldName("left"));
        const right = named(node.childForFieldName("right"));
        for (const value of right) this.walk(value);
        const descs = this.specDescs(left, null, right);
        left.forEach((name, index) => {
          if (name.type !== "identifier") return;
          // `a, err := …` redeclares nothing already in this scope: it writes it.
          if (this.scopes.at(-1)?.get(name.text)?.k === "ref")
            this.write(name.text, descs[index]!);
          else this.declare(name.text, descs[index]!);
        });
        return;
      }
      case "assignment_statement": {
        const left = named(node.childForFieldName("left"));
        const right = named(node.childForFieldName("right"));
        const operator = node.childForFieldName("operator")?.text ?? "=";
        for (const value of right) this.walk(value);
        const descs =
          operator === "=" ? this.specDescs(left, null, right) : undefined;
        left.forEach((target, index) => {
          const name = unparen(target);
          if (name.type === "identifier" && this.local(name.text)?.k === "ref")
            this.write(name.text, descs ? descs[index]! : null);
          else this.walk(target);
        });
        return;
      }
      case "inc_statement":
      case "dec_statement": {
        const operand = named(node)[0];
        if (!operand) return;
        const name = unparen(operand);
        if (name.type === "identifier" && this.local(name.text)?.k === "ref")
          this.write(name.text, null);
        else this.walk(operand);
        return;
      }
      case "unary_expression": {
        const operand = node.childForFieldName("operand");
        const name = operand ? unparen(operand) : undefined;
        if (node.child(0)?.text === "&" && name?.type === "identifier")
          this.write(name.text, null);
        this.walkChildren(node);
        return;
      }
      case "range_clause":
      case "receive_statement": {
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        if (right) this.walk(right);
        const defines = node.children.some((child) => child?.text === ":=");
        const source: Desc = right ? this.desc(right) : { k: "unknown" };
        const items = named(left);
        items.forEach((name, index) => {
          if (name.type !== "identifier") return this.walk(name);
          // range: key then element; receive: the element.
          const value: Desc =
            node.type === "range_clause" && index === 0 && items.length > 1
              ? { k: "key", x: source }
              : node.type === "range_clause"
                ? items.length > 1
                  ? { k: "elem", x: source }
                  : { k: "key", x: source }
                : source;
          if (defines) this.declare(name.text, value);
          else if (this.local(name.text)?.k === "ref")
            this.write(name.text, null);
          else this.walk(name);
        });
        return;
      }
      case "type_switch_statement":
        this.scoped(() => {
          const value = node.childForFieldName("value");
          const initializer = node.childForFieldName("initializer");
          if (initializer) this.walk(initializer);
          if (value) this.walk(value);
          // The switch variable has its case's type: one type → that type;
          // several types or default → the switched operand's own description.
          const alias = named(node.childForFieldName("alias")).filter(
            (name) => name.type === "identifier",
          );
          const operand: Desc = value
            ? this.desc(
                value.type === "type_assertion_expression"
                  ? (value.childForFieldName("operand") ?? value)
                  : value,
              )
            : { k: "unknown" };
          for (const child of named(node)) {
            if (child.type !== "type_case" && child.type !== "default_case")
              continue;
            const types = child
              .childrenForFieldName("type")
              .filter((item): item is Node => !!item && item.isNamed);
            this.scoped(() => {
              for (const type of types) this.walk(type);
              const single =
                types.length === 1 && types[0]!.text !== "nil"
                  ? this.typedValue(types[0]!)
                  : operand;
              for (const name of alias) this.declare(name.text, single);
              // Tree-sitter returns a new wrapper per access: compare positions.
              for (const item of named(child))
                if (
                  !types.some(
                    (type) =>
                      type.startIndex === item.startIndex &&
                      type.endIndex === item.endIndex,
                  )
                )
                  this.walk(item);
            });
          }
        });
        return;
      case "var_declaration":
      case "const_declaration":
        for (const spec of this.valueSpecs(node)) {
          const names = spec
            .childrenForFieldName("name")
            .filter((item): item is Node => !!item);
          const type = spec.childForFieldName("type");
          const values = named(spec.childForFieldName("value"));
          if (type) this.walk(type);
          for (const value of values) this.walk(value);
          const descs = this.specDescs(names, type, values);
          names.forEach((name, index) =>
            this.declare(name.text, descs[index]!),
          );
        }
        return;
      case "type_declaration":
        for (const spec of named(node)) {
          const name = spec.childForFieldName("name");
          if (name) this.declare(name.text, { k: "localtype" });
          const typeParameters = spec.childForFieldName("type_parameters");
          this.scoped(() => {
            this.walkTypeParams(typeParameters);
            const type = spec.childForFieldName("type");
            if (type) this.walk(type);
          }, this.typeParams(typeParameters));
        }
        return;
      case "func_literal":
        this.scoped(() => {
          this.parameters(node.childForFieldName("parameters"));
          this.parameters(node.childForFieldName("result"));
          const body = node.childForFieldName("body");
          if (body) this.walk(body);
        });
        return;
      case "parameter_declaration":
      case "variadic_parameter_declaration": {
        const type = node.childForFieldName("type");
        if (type) this.walk(type);
        return;
      }
      case "field_declaration": {
        const type = node.childForFieldName("type");
        if (type) this.walk(type);
        return;
      }
      case "keyed_element": {
        const key = node.childForFieldName("key");
        const value = node.childForFieldName("value");
        const keyParts = named(key);
        // `Field: value` keys name struct fields of a type not known here; not linked.
        if (
          key &&
          !(keyParts.length === 1 && keyParts[0]!.type === "identifier")
        )
          this.walk(key);
        if (value) this.walk(value);
        return;
      }
      case "call_expression":
        return this.call(node);
      case "type_conversion_expression":
        return this.conversion(node);
      case "selector_expression":
        return this.selector(node);
      case "identifier":
        return this.identifier(node);
      case "type_identifier":
        return this.typeIdentifier(node);
      case "qualified_type": {
        const pkg = node.childForFieldName("package");
        const name = node.childForFieldName("name");
        if (pkg && name)
          this.link("references", `${pkg.text}.${name.text}`, range(node), {
            t: { q: pkg.text, n: name.text },
          });
        return;
      }
      default:
        this.walkChildren(node);
    }
  }

  private call(node: Node): void {
    const fn = node.childForFieldName("function");
    const typeArguments = node.childForFieldName("type_arguments");
    const args = node.childForFieldName("arguments");
    if (fn) {
      const callee = unparen(fn);
      if (callee.type === "index_expression") {
        // F[int](x) instantiates a generic function; handlers["a"]() calls an element.
        // The grammar cannot tell; resolution can: only function operands are called.
        const operand = callee.childForFieldName("operand");
        this.link("calls", compact(callee), range(callee), {
          expr: (operand
            ? { k: "inst", x: this.desc(operand) }
            : { k: "unknown" }) as unknown as Json,
        });
        // The container (or generic function) itself is referenced.
        this.walk(callee);
      } else if (callee.type === "func_literal") this.walk(callee);
      else if (callee.type === "identifier") {
        const bound = this.local(callee.text);
        if (!bound && PREDECLARED_TYPES.has(callee.text)) {
          // Conversion to a predeclared type such as string(b): not a call.
        } else
          this.link("calls", callee.text, range(callee), {
            expr: (bound ?? { k: "name", n: callee.text }) as unknown as Json,
            // Stable parse fact; `analyze` sets `builtin` only when no package
            // declaration of this name shadows the builtin.
            ...(!bound && BUILTIN_FUNCTIONS.has(callee.text)
              ? { builtinName: true }
              : {}),
          });
      } else if (callee.type === "selector_expression") {
        const operand = callee.childForFieldName("operand");
        this.link("calls", compact(callee), range(callee), {
          expr: this.desc(callee) as unknown as Json,
        });
        if (operand && unparen(operand).type !== "identifier")
          this.walk(operand);
      } else {
        this.link("calls", compact(callee), range(callee), {
          expr: { k: "unknown" },
        });
        this.walk(callee);
      }
    }
    if (typeArguments) this.walk(typeArguments);
    if (args) this.walk(args);
  }

  private conversion(node: Node): void {
    const type = node.childForFieldName("type");
    const operand = node.childForFieldName("operand");
    const f = type ? this.typeNameDesc(type) : null;
    if (type && f) {
      // T(x) is a conversion, F[int](x) a generic call: the grammar cannot tell; resolution can.
      const base =
        type.type === "generic_type"
          ? (type.childForFieldName("type") ?? type)
          : type;
      this.link("calls", compact(base), range(base), {
        expr: f as unknown as Json,
      });
      if (type.type === "generic_type") {
        const args = type.childForFieldName("type_arguments");
        if (args) this.walk(args);
      }
    } else if (type) this.walk(type);
    if (operand) this.walk(operand);
  }

  private selector(node: Node): void {
    const operand = node.childForFieldName("operand");
    if (!operand) return this.walkChildren(node);
    const desc = this.desc(node);
    const root = this.rootKind(desc);
    // Field/method values on values of unknown type are not linked (see docs/changes/W2-B.md).
    if (!["local", "unknown", "localtype", "opaque"].includes(root))
      this.link("references", compact(node), range(node), {
        expr: desc as unknown as Json,
      });
    if (unparen(operand).type !== "identifier") this.walk(operand);
  }

  private identifier(node: Node): void {
    const name = node.text;
    if (
      name === "_" ||
      this.local(name) ||
      PREDECLARED_VALUES.has(name) ||
      PREDECLARED_TYPES.has(name) ||
      BUILTIN_FUNCTIONS.has(name)
    )
      return;
    this.link("references", name, range(node), {
      expr: { k: "name", n: name },
    });
  }

  private typeIdentifier(node: Node): void {
    const name = node.text;
    if (
      this.local(name) ||
      PREDECLARED_TYPES.has(name) ||
      PREDECLARED_VALUES.has(name)
    )
      return;
    this.link("references", name, range(node), { t: { n: name } });
  }
}
