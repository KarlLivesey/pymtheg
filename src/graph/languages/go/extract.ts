// SPDX-License-Identifier: MIT
import { basename } from "node:path";
import type { Node } from "web-tree-sitter";
import type {
  Diagnostic,
  Json,
  LinkDraft,
  SourceRange,
  SymbolDraft,
} from "../../types.js";
import {
  BUILTIN_FUNCTIONS,
  KNOWN_GOARCH,
  KNOWN_GOOS,
  PREDECLARED_TYPES,
  PREDECLARED_VALUES,
  type Desc,
  type FileFact,
  type InterfaceMethodTerm,
  type StructFieldTerm,
  type TypeTerm,
  UNKNOWN_TERM,
  type ImportFact,
  type TypeRef,
} from "./model.js";
import { position } from "./failure.js";

/** Node types of the grammar's `_type` (a type, not a value, in that position). */
const TYPE_NODES = new Set([
  "type_identifier",
  "qualified_type",
  "generic_type",
  "pointer_type",
  "struct_type",
  "interface_type",
  "array_type",
  "implicit_length_array_type",
  "slice_type",
  "map_type",
  "channel_type",
  "function_type",
  "negated_type",
  "parenthesized_type",
]);
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
/** Identifiers, including `nil`/`true`/`false`/`iota`, which the grammar gives their own node kinds. */
const isName = (node: Node) =>
  node.type === "identifier" ||
  node.type === "nil" ||
  node.type === "true" ||
  node.type === "false" ||
  node.type === "iota";
const range = (node: Node): SourceRange => ({
  start: node.startIndex,
  end: node.endIndex,
});
const compact = (node: Node): string => {
  const text = node.text.replace(/\s+/g, "");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};
/**
 * Redundant parentheses around a type or an expression (`(T)`, `*(T)`,
 * `(x).M()`) mean nothing in Go. They are removed in ONE place: every child the
 * extractor reads goes through `named`, `fieldOf` or `fieldsOf`, which look
 * through them, so no switch on a node's type ever sees `parenthesized_type`
 * or `parenthesized_expression` with a single child.
 */
const unparen = (node: Node): Node => {
  let current = node;
  for (;;) {
    if (
      current.type !== "parenthesized_expression" &&
      current.type !== "parenthesized_type"
    )
      return current;
    const inner = current.namedChildren.filter(
      (child): child is Node => !!child && child.type !== "comment",
    );
    if (inner.length !== 1) return current;
    current = inner[0]!;
  }
};
const named = (node: Node | null | undefined): Node[] =>
  node
    ? node.namedChildren
        .filter((child): child is Node => !!child && child.type !== "comment")
        .map(unparen)
    : [];
/** A field child, without redundant parentheses. */
const fieldOf = (node: Node | null | undefined, name: string): Node | null => {
  const child = node?.childForFieldName(name);
  return child ? unparen(child) : null;
};
/** Every field child of a name, without redundant parentheses. */
const fieldsOf = (node: Node | null | undefined, name: string): Node[] =>
  (node?.childrenForFieldName(name) ?? [])
    .filter((child): child is Node => !!child)
    .map(unparen);
/**
 * An array length written as an integer literal, as a decimal string; null for
 * any other constant expression (not evaluated, so never compared equal).
 */
function arrayLength(node: Node | null): string | null {
  if (node?.type !== "int_literal") return null;
  const text = node.text.replace(/_/g, "");
  try {
    return /^0[0-7]+$/.test(text)
      ? BigInt(`0o${text.slice(1)}`).toString()
      : BigInt(text).toString();
  } catch {
    return null;
  }
}

/**
 * A struct tag's string value: "" when there is none; null when an interpreted
 * literal uses escapes this does not decode (never compared equal by spelling).
 */
function tagValue(node: Node | null): string | null {
  if (!node) return "";
  if (node.type === "raw_string_literal")
    return node.text.slice(1, -1).replace(/\r/g, "");
  if (node.type !== "interpreted_string_literal") return null;
  const body = node.text.slice(1, -1);
  if (/\\[^"\\nt]/.test(body)) return null;
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return null;
  }
}

/**
 * A channel type by the spec's rule, not the tree's shape: "the <- operator
 * associates with the leftmost chan possible", so `chan<- chan int` is a
 * send-only channel of `chan int` (tree-sitter nests it as `chan (<-chan int)`).
 * The prefixes are read from the tokens; the element is the node spanning from
 * the first non-prefix token to the end (a parenthesised element keeps its own
 * direction). Unknown when no such node exists.
 */
function channelTerm(node: Node, element: (node: Node) => TypeTerm): TypeTerm {
  const leaves: Node[] = [];
  const collect = (current: Node) => {
    if (current.type === "comment") return;
    if (current.childCount === 0) leaves.push(current);
    else for (const child of current.children) if (child) collect(child);
  };
  collect(node);
  const directions: ("b" | "s" | "r")[] = [];
  let index = 0;
  while (index < leaves.length) {
    const token = leaves[index]!.type;
    const next = leaves[index + 1]?.type;
    if (token === "<-" && next === "chan") {
      directions.push("r");
      index += 2;
    } else if (token === "chan" && next === "<-") {
      directions.push("s");
      index += 2;
    } else if (token === "chan") {
      directions.push("b");
      index += 1;
    } else break;
  }
  if (!directions.length || index >= leaves.length) return UNKNOWN_TERM;
  const start = leaves[index]!.startIndex;
  // The outermost node from that token to the end of the channel type.
  let found: Node | undefined;
  const queue: Node[] = [node];
  while (queue.length && !found) {
    const current = queue.shift()!;
    for (const child of current.namedChildren) {
      if (!child) continue;
      if (child.startIndex === start && child.endIndex === node.endIndex) {
        found = child;
        break;
      }
      queue.push(child);
    }
  }
  if (!found) return UNKNOWN_TERM;
  let term = element(found);
  for (const direction of directions.reverse())
    term = { k: "ch", d: direction, e: term };
  return term;
}

/** Syntax nesting walked for links; deeper fails the file. */
const MAX_WALK_DEPTH = 500;
/** Type terms deeper than this are unknown (no unbounded recursion). */
const MAX_TERM_DEPTH = 64;
/** Prefix of an anonymous struct's reference before its identity is known. */
const PENDING = "\u0000anon:";

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
  /** The declaring identifier: its name and span. */
  name?: { name: string; start: number; end: number };
  /** A parameter, result or receiver of the enclosing function or literal. */
  parameter?: boolean;
  /** Declared with a value (not a zero value); `literal` when it is a func literal. */
  initialized?: boolean;
  literal?: boolean;
  /** For each write, whether it assigns a func literal. */
  literalWrites: boolean[];
}
/** Facts of a declaration, for local calls (see `localCalls`). */
interface Declared {
  at?: Node;
  parameter?: boolean;
  initialized?: boolean;
  literal?: boolean;
}

/**
 * Extracts Go declarations and references from one file's syntax tree.
 * Pure function of the source text: no project, disk or toolchain access.
 */
export class GoExtractor {
  readonly symbols: SymbolDraft[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly links: LinkDraft[] = [];
  readonly fact: FileFact;
  private scopes: Map<string, Desc>[] = [];
  private byKey = new Map<string, SymbolDraft>();
  private owner = "file";
  /** Calls through a local binding, decided once every write is seen. */
  private localCalls: { link: LinkDraft; binding: Binding }[] = [];

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
    // Only valid files reach extraction (see `syntaxFailure`): one package
    // clause, no syntax error anywhere.
    let beforePackage = true;
    for (const child of root.namedChildren) {
      if (child.type === "comment") {
        if (beforePackage) this.buildLine(child.text, child.startPosition.row);
      } else if (child.type === "package_clause") {
        beforePackage = false;
        this.legacyBuild(child.startPosition.row);
        const name = named(child).find(
          (item) => item.type === "package_identifier",
        );
        if (name) {
          this.fact.package = name.text;
          this.fact.packageRange = range(name);
        }
      } else {
        beforePackage = false;
        this.declaration(child);
      }
    }
    // A call through a local binding, now that every write has been seen: a
    // binding provably holding exactly one func literal is the enclosing
    // function's own (`localBinding`, as Rust and TypeScript record it); a
    // call through a parameter, result or receiver (`localParameter`) is
    // left unresolved with the reason `local`: its value comes from the
    // caller.
    for (const { link, binding } of this.localCalls) {
      const data = link.data as { [key: string]: Json };
      if (binding.parameter && binding.name)
        data.localParameter = binding.name as unknown as Json;
      else if (binding.name && singleLiteral(binding))
        data.localBinding = binding.name as unknown as Json;
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
    // Only now is every anonymous struct's identity known.
    for (const item of [...this.symbols, ...this.links])
      if (item.data) item.data = this.anonymous(item.data) as typeof item.data;
  }

  /** A `//go:build` line was seen: it alone is the constraint, as in Go. */
  private modernBuild = false;
  /** Legacy `+build` lines before the package clause, with their rows. */
  private legacyLines: { text: string; row: number }[] = [];
  private buildLine(comment: string, row: number): void {
    const modern = /^\/\/go:build\s+(.+)$/.exec(comment.trim());
    if (modern) {
      this.fact.build = modern[1]!.trim();
      this.modernBuild = true;
    }
    const legacy = /^\/\/\s*\+build\s+(.+)$/.exec(comment.trim());
    if (legacy) this.legacyLines.push({ text: legacy[1]!.trim(), row });
  }
  /**
   * Without a `//go:build` line, every legacy `+build` line followed by a
   * blank line before the package clause applies (Go ANDs them; one directly
   * above `package`, with no blank line, is not a constraint): kept one per
   * line, each starting `+build `.
   */
  private legacyBuild(packageRow: number): void {
    if (this.modernBuild || !this.legacyLines.length) return;
    const rows = this.text.split("\n");
    let blank = -1;
    for (let row = 0; row < packageRow; row++)
      if (!rows[row]!.trim()) blank = row;
    const lines = this.legacyLines
      .filter((line) => line.row < blank)
      .map((line) => `+build ${line.text}`);
    if (lines.length) this.fact.build = lines.join("\n");
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
  private declare(name: string, desc: Desc, declared: Declared = {}): void {
    if (name === "_" || !this.scopes.length) return;
    const binding: Binding = {
      d: desc,
      writes: [],
      opaque: false,
      literalWrites: [],
      ...(declared.at ? { name: { name, ...range(declared.at) } } : {}),
      ...(declared.parameter ? { parameter: true } : {}),
      ...(declared.initialized ? { initialized: true } : {}),
      ...(declared.literal ? { literal: true } : {}),
    };
    this.scopes
      .at(-1)!
      .set(name, desc.k === "localtype" ? desc : { k: "ref", b: binding });
  }
  /** Records a write to a local variable; null means the written value is not knowable. */
  private write(name: string, desc: Desc | null, literal = false): void {
    const found = this.local(name);
    if (found?.k !== "ref") return;
    const binding = found.b as Binding;
    if (desc === null) binding.opaque = true;
    else {
      binding.writes.push(desc);
      binding.literalWrites.push(literal);
    }
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
      case "local":
        return desc.m || desc.f
          ? {
              k: "local",
              ...(desc.m ? { m: desc.m.map(next) } : {}),
              ...(desc.f
                ? {
                    f: desc.f.map((field) => ({
                      n: field.n,
                      d: next(field.d),
                    })),
                  }
                : {}),
              ...(desc.sym !== undefined ? { sym: desc.sym } : {}),
            }
          : desc;
      case "unknown":
        return desc.m ? { ...desc, m: desc.m.map(next) } : desc;
      case "call":
        return {
          k: "call",
          f: next(desc.f),
          i: desc.i,
          ...(desc.b ? { b: next(desc.b) } : {}),
        };
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
    // An anonymous struct value: its members resolve through its own symbol.
    if (desc.k === "local" && desc.sym !== undefined) return "struct";
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
        // Valid files only reach here (see `syntaxFailure`): every top-level
        // node is a package clause, a comment or a declaration above.
        return;
    }
  }

  private importSpec(spec: Node): void {
    const pathNode = fieldOf(spec, "path");
    if (!pathNode) return;
    const content = named(pathNode)[0];
    const path = content ? content.text : pathNode.text.slice(1, -1);
    if (!path) return;
    const nameNode = fieldOf(spec, "name");
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
      const constraint = named(fieldOf(declaration, "type"));
      const ref = constraint.length === 1 ? this.typeRef(constraint[0]!) : null;
      const desc: Desc =
        ref && ref.q !== ""
          ? { k: "localtype", tp: true, c: ref }
          : { k: "localtype", tp: true };
      for (const name of fieldsOf(declaration, "name"))
        if (name) scope.set(name.text, desc);
    }
    return scope;
  }
  private walkTypeParams(list: Node | null): void {
    for (const declaration of named(list)) {
      const type = fieldOf(declaration, "type");
      if (type) this.walk(type);
    }
  }

  private functionDeclaration(node: Node): void {
    const name = fieldOf(node, "name");
    if (!name) return this.within("file", () => this.walk(node));
    const parameters = fieldOf(node, "parameters");
    const result = fieldOf(node, "result");
    const typeParameters = fieldOf(node, "type_parameters");
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
        const body = fieldOf(node, "body");
        if (body) this.walk(body);
      }, scope),
    );
  }

  private methodDeclaration(node: Node): void {
    const name = fieldOf(node, "name");
    const receiver = fieldOf(node, "receiver");
    if (!name || !receiver) return this.within("file", () => this.walk(node));
    const declaration = named(receiver)[0];
    let typeNode = fieldOf(declaration, "type") ?? null;
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
      typeNode = fieldOf(typeNode, "type");
    }
    // Go 1.27 generic methods: the method's own type parameters
    // (`func (T) M[U any]()`) scope like a generic function's, after the
    // receiver's, so `U` never reads as a package-level type of that name.
    const typeParameters = fieldOf(node, "type_parameters");
    for (const [paramName, desc] of this.typeParams(typeParameters))
      scope.set(paramName, desc);
    const receiverType =
      typeNode?.type === "type_identifier" ? typeNode.text : "?";
    const identity = `(${pointer ? "*" : ""}${receiverType}).${name.text}`;
    const parameters = fieldOf(node, "parameters");
    const result = fieldOf(node, "result");
    const key = this.symbol("method", name.text, identity, range(node), {
      receiver: receiverType,
      pointer,
      ...this.signatureData(parameters, result, scope),
      ...(typeParameters ? { generic: true } : {}),
    });
    this.contains("file", key, range(node));
    this.within(key, () =>
      this.scoped(() => {
        if (typeNode?.type === "type_identifier")
          this.link("receiver", receiverType, range(typeNode), {
            t: { n: receiverType },
          });
        const receiverName = fieldOf(declaration, "name");
        if (receiverName && receiverType !== "?")
          this.declare(
            receiverName.text,
            { k: "val", t: { n: receiverType } },
            { at: receiverName, parameter: true },
          );
        this.walkTypeParams(typeParameters);
        this.parameters(parameters);
        this.parameters(result);
        const body = fieldOf(node, "body");
        if (body) this.walk(body);
      }, scope),
    );
  }

  private localIdentities = new Set<string>();
  /** A file-unique identity that already carries the file name. */
  private uniqueIdentity(scoped: string): string {
    let identity = scoped;
    for (let index = 2; this.localIdentities.has(identity); index++)
      identity = `${scoped}#${index}`;
    this.localIdentities.add(identity);
    return identity;
  }
  /** A file-unique identity for a function-local or anonymous type. */
  private localIdentity(base: string): string {
    // Unique per package: the file name, then the enclosing declaration, the local
    // name (or struct#n), and #2, #3, … for a repeated name in the same file.
    const scoped = `${basename(this.path)}:${base}`;
    let identity = scoped;
    for (let index = 2; this.localIdentities.has(identity); index++)
      identity = `${scoped}#${index}`;
    this.localIdentities.add(identity);
    return identity;
  }

  /**
   * A type declaration. `local` is the identity of a function-local type (its
   * symbol's name and identity, `data.local`); package-level types use their name.
   * An alias of a struct or interface literal records the literal's fields or
   * elements on the alias itself (`data.shape`), so its structure is known.
   */
  private typeSpec(spec: Node, local?: string): void {
    const name = fieldOf(spec, "name");
    const type = fieldOf(spec, "type");
    if (!name || !type) return this.within("file", () => this.walk(spec));
    const symbolName = local ?? name.text;
    const typeParameters = fieldOf(spec, "type_parameters");
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
    if (local !== undefined) data.local = true;
    const key = this.symbol(kind, symbolName, symbolName, range(spec), data);
    this.contains(local !== undefined ? this.owner : "file", key, range(spec));
    this.within(key, () =>
      this.scoped(() => {
        this.walkTypeParams(typeParameters);
        const literal = unparen(type);
        // An alias is its target: kept as the full type term that identity
        // compares (never a reduced base name). A generic alias is unknown.
        if (kind === "alias")
          data.target = (typeParameters
            ? UNKNOWN_TERM
            : this.typeTerm(type)) as unknown as Json;
        if (kind === "alias" || kind === "type") {
          const underlying = this.typeRef(type);
          if (underlying) data.underlying = { ...underlying };
          // A type literal (container, func, struct, interface): a value of
          // this type, described as the literal's values are (the failed-file
          // backstop follows it to a selected field's own type).
          else if (!typeParameters)
            data.v = this.typedValue(type) as unknown as Json;
          // `type P *T`: a defined pointer type has no methods of its own.
          if (underlying && literal.type === "pointer_type")
            data.underlyingPointer = true;
          // A named func type: its result types are written in its declaration.
          if (literal.type === "function_type")
            data.fn = this.resultDescs(
              fieldOf(literal, "result"),
            ) as unknown as Json[];
        }
        if (kind === "struct") this.structFields(symbolName, key, type);
        else if (kind === "interface")
          this.interfaceElements(symbolName, key, type, data);
        else if (kind === "alias" && literal.type === "struct_type") {
          data.shape = "struct";
          this.structFields(symbolName, key, literal);
        } else if (kind === "alias" && literal.type === "interface_type") {
          data.shape = "interface";
          this.interfaceElements(symbolName, key, literal, data);
        } else this.walk(type);
      }, scope),
    );
  }

  private structFields(
    owner: string,
    ownerKey: string,
    struct: Node,
    anonymous = false,
  ): void {
    for (const list of named(struct))
      for (const field of named(list)) {
        if (field.type !== "field_declaration") continue;
        const type = fieldOf(field, "type");
        if (!type) continue;
        const names = fieldsOf(field, "name").filter(
          (item): item is Node => !!item,
        );
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
                ...(anonymous ? { anonymous: true } : {}),
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
              ? (fieldOf(inner, "type") ?? inner)
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
              ...(anonymous ? { anonymous: true } : {}),
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
            const args = fieldOf(inner, "type_arguments");
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
        const name = fieldOf(element, "name");
        if (!name) continue;
        const parameters = fieldOf(element, "parameters");
        const result = fieldOf(element, "result");
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
      } else if (
        element.type === "type_elem" &&
        named(element).length === 1 &&
        unparen(named(element)[0]!).type === "interface_type"
      ) {
        // An embedded interface literal contributes its elements directly.
        this.interfaceElements(
          owner,
          ownerKey,
          unparen(named(element)[0]!),
          data,
        );
      } else if (element.type === "type_elem") {
        const parts = named(element);
        const only = parts.length === 1 ? parts[0]! : undefined;
        const ref = only ? this.typeRef(only) : null;
        if (only && ref && ref.q !== "" && only.type !== "pointer_type") {
          const base =
            only.type === "generic_type"
              ? (fieldOf(only, "type") ?? only)
              : only;
          this.link("embeds", compact(base), range(base), { t: { ...ref } });
          if (only.type === "generic_type") {
            const args = fieldOf(only, "type_arguments");
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
    const names = fieldsOf(spec, "name").filter((item): item is Node => !!item);
    const type = fieldOf(spec, "type");
    const values = named(fieldOf(spec, "value"));
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
      const type = fieldOf(parameter, "type");
      if (type) this.walk(type);
      if (!declare) continue;
      const value: Desc = type ? this.typedValue(type) : { k: "local" };
      const variadic = parameter.type === "variadic_parameter_declaration";
      for (const name of fieldsOf(parameter, "name"))
        if (name)
          this.declare(name.text, variadic ? { k: "cont", e: value } : value, {
            at: name,
            parameter: true,
          });
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
      return {
        results,
        sig: this.functionTerm(parameters, result) as unknown as Json,
      };
    } finally {
      this.scopes.pop();
    }
  }

  /**
   * A function signature as a type term (see `TypeTerm`): parameter and result
   * types expanded to their arity (grouped names count one each), names
   * dropped, the final `...T` parameter marked variadic.
   */
  private functionTerm(
    parameters: Node | null,
    result: Node | null,
    depth = 0,
  ): TypeTerm {
    const list = (node: Node | null): TypeTerm[] =>
      named(node).flatMap((parameter) => {
        const type = fieldOf(parameter, "type");
        const item = type ? this.typeTerm(type, depth + 1) : UNKNOWN_TERM;
        const term: TypeTerm =
          parameter.type === "variadic_parameter_declaration"
            ? { k: "sl", e: item }
            : item;
        return Array<TypeTerm>(
          Math.max(1, fieldsOf(parameter, "name").length),
        ).fill(term);
      });
    const variadic = named(parameters).some(
      (parameter) => parameter.type === "variadic_parameter_declaration",
    );
    return {
      k: "fn",
      p: list(parameters),
      r:
        result?.type === "parameter_list"
          ? list(result)
          : result
            ? [this.typeTerm(result, depth + 1)]
            : [],
      ...(variadic ? { v: true } : {}),
    };
  }

  /**
   * The written type as a structural term, for type identity at resolution
   * (`identical` in resolve.ts). Names are kept as written, with their
   * qualifier; the resolver binds them to declarations. Anything this cannot
   * represent exactly is `UNKNOWN_TERM`, never a guess.
   */
  private typeTerm(node: Node, depth = 0): TypeTerm {
    // Very deep (finite) nesting: unknown rather than unbounded recursion.
    if (depth > MAX_TERM_DEPTH) return UNKNOWN_TERM;
    const current = unparen(node);
    const field = (name: string) => fieldOf(current, name);
    const of = (child: Node | null): TypeTerm =>
      child ? this.typeTerm(child, depth + 1) : UNKNOWN_TERM;
    switch (current.type) {
      case "type_identifier": {
        const bound = this.local(current.text);
        // A function-local type: its package-unique identity.
        if (bound?.k === "localtype" && bound.sym && !bound.tp)
          return { k: "l", s: bound.sym };
        // A type parameter (or any other local binding): not compared.
        if (bound) return UNKNOWN_TERM;
        return PREDECLARED_TYPES.has(current.text)
          ? { k: "n", n: current.text, p: true }
          : { k: "n", n: current.text };
      }
      case "qualified_type":
        return {
          k: "n",
          q: field("package")?.text ?? "",
          n: field("name")?.text ?? "",
        };
      case "generic_type": {
        const base = of(field("type"));
        const args = named(field("type_arguments")).map((item) =>
          this.typeTerm(
            item.type === "type_elem" ? (named(item)[0] ?? item) : item,
            depth + 1,
          ),
        );
        return base.k === "n" ? { ...base, a: args } : UNKNOWN_TERM;
      }
      case "pointer_type":
        return { k: "ptr", e: of(named(current)[0] ?? null) };
      case "slice_type":
        return { k: "sl", e: of(field("element")) };
      case "array_type":
        return {
          k: "ar",
          len: arrayLength(field("length")),
          e: of(field("element")),
        };
      case "map_type":
        return { k: "map", key: of(field("key")), e: of(field("value")) };
      case "channel_type":
        return channelTerm(current, (element) =>
          this.typeTerm(element, depth + 1),
        );
      case "function_type":
        return this.functionTerm(
          field("parameters"),
          field("result"),
          depth + 1,
        );
      case "struct_type": {
        const fields: StructFieldTerm[] = [];
        const list = named(current).find(
          (child) => child.type === "field_declaration_list",
        );
        for (const declaration of named(list ?? null)) {
          if (declaration.type !== "field_declaration") return UNKNOWN_TERM;
          const type = fieldOf(declaration, "type");
          const tag = tagValue(fieldOf(declaration, "tag"));
          const names = fieldsOf(declaration, "name");
          const term = of(type);
          if (names.length)
            for (const name of names)
              fields.push({ n: name!.text, t: term, g: tag });
          else {
            // Embedded: the field name is the type name (without qualifier).
            const pointer = declaration.children.some(
              (child) => child?.type === "*",
            );
            const base = type ? unparen(type) : null;
            const name =
              base?.type === "qualified_type"
                ? (fieldOf(base, "name")?.text ?? "")
                : base?.type === "generic_type"
                  ? (fieldOf(base, "type")?.text ?? "")
                  : (base?.text ?? "");
            fields.push({
              n: name.replace(/^.*\./, ""),
              x: true,
              t: pointer ? { k: "ptr", e: term } : term,
              g: tag,
            });
          }
        }
        return { k: "st", f: fields };
      }
      case "interface_type": {
        const methods: InterfaceMethodTerm[] = [];
        const embeds: TypeTerm[] = [];
        for (const element of named(current)) {
          if (element.type === "method_elem") {
            const name = fieldOf(element, "name");
            if (!name) return UNKNOWN_TERM;
            methods.push({
              n: name.text,
              s: this.functionTerm(
                fieldOf(element, "parameters"),
                fieldOf(element, "result"),
                depth + 1,
              ),
            });
          } else if (element.type === "type_elem") {
            const parts = named(element);
            // A union or `~T` makes a type set: not compared.
            if (parts.length !== 1 || parts[0]!.type === "negated_type")
              return UNKNOWN_TERM;
            embeds.push(this.typeTerm(parts[0]!, depth + 1));
          } else if (element.type !== "comment") return UNKNOWN_TERM;
        }
        return { k: "if", m: methods, e: embeds };
      }
      default:
        return UNKNOWN_TERM;
    }
  }

  /** One value description per declared result. */
  private resultDescs(result: Node | null): Desc[] {
    if (!result) return [];
    if (result.type !== "parameter_list") return [this.typedValue(result)];
    return named(result).flatMap((parameter) => {
      const type = fieldOf(parameter, "type");
      const value: Desc = type ? this.typedValue(type) : { k: "local" };
      return Array<Desc>(Math.max(1, fieldsOf(parameter, "name").length)).fill(
        value,
      );
    });
  }

  private typedDepth = 0;
  /** What is known about a value of the written type (depth-bounded). */
  private typedValue(node: Node): Desc {
    if (this.typedDepth >= MAX_TERM_DEPTH) return { k: "local" };
    this.typedDepth++;
    try {
      return this.typedValueOf(node);
    } finally {
      this.typedDepth--;
    }
  }

  private typedValueOf(node: Node): Desc {
    const current = unparen(node);
    const field = (name: string) => fieldOf(current, name);
    const of = (child: Node | null): Desc =>
      child ? this.typedValue(child) : { k: "local" };
    switch (current.type) {
      case "pointer_type":
        return of(named(current)[0] ?? null);
      case "generic_type":
        // The base type; instantiation is not modelled.
        return of(field("type"));
      case "type_identifier": {
        const bound = this.local(current.text);
        if (bound?.k === "localtype")
          return bound.tp
            ? bound.c
              ? { k: "tval", c: { ...bound.c } }
              : { k: "tval" }
            : bound.sym !== undefined
              ? // A function-local type: its symbol (members resolve on it).
                { k: "val", t: { n: current.text, l: bound.sym } }
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
      case "struct_type": {
        // An anonymous struct: its named fields, and the types it embeds.
        const f: { n: string; d: Desc }[] = [];
        const m: Desc[] = [];
        const list = named(current).find(
          (child) => child.type === "field_declaration_list",
        );
        for (const declaration of named(list ?? null)) {
          if (declaration.type !== "field_declaration") continue;
          const type = fieldOf(declaration, "type");
          if (!type) continue;
          const names = fieldsOf(declaration, "name");
          if (names.length) {
            const d = this.typedValue(type);
            for (const name of names) if (name) f.push({ n: name.text, d });
          } else m.push(...this.mentioned(type));
        }
        return {
          k: "local",
          ...(m.length ? { m } : {}),
          ...(f.length ? { f } : {}),
          // Its symbol, named when the walk reaches it (see `anonymous`).
          ...(f.length || m.length
            ? { sym: `${PENDING}${current.startIndex}` }
            : {}),
        };
      }
      case "interface_type": {
        // An anonymous interface: its methods (as func values), and the types
        // it embeds.
        const f: { n: string; d: Desc }[] = [];
        const m: Desc[] = [];
        for (const item of named(current)) {
          if (item.type === "method_elem") {
            const name = fieldOf(item, "name");
            if (name)
              f.push({
                n: name.text,
                d: {
                  k: "func",
                  r: this.resultDescs(fieldOf(item, "result")),
                },
              });
          } else if (item.type !== "comment") m.push(...this.mentioned(item));
        }
        return {
          k: "local",
          ...(m.length ? { m } : {}),
          ...(f.length ? { f } : {}),
        };
      }
      default:
        return { k: "local" };
    }
  }

  /** Every named type written inside a type expression, as values of it. */
  private mentioned(node: Node): Desc[] {
    const found: Desc[] = [];
    const stack: Node[] = [node];
    while (stack.length && found.length < 64) {
      const current = stack.pop()!;
      if (
        current.type === "qualified_type" ||
        current.type === "type_identifier"
      ) {
        const ref = this.typeRef(current);
        if (ref && ref.q !== "") found.push({ k: "val", t: ref });
        continue;
      }
      for (const child of current.namedChildren) if (child) stack.push(child);
    }
    return found;
  }

  /** The named type of a type expression, or null for composite/unnamed types. Universe types use q "". */
  private typeRef(node: Node): TypeRef | null {
    let current = unparen(node);
    if (current.type === "pointer_type")
      current = unparen(named(current)[0] ?? current);
    if (current.type === "generic_type")
      current = fieldOf(current, "type") ?? current;
    if (current.type === "type_identifier") {
      const bound = this.local(current.text);
      // A function-local type: refer to its symbol (scope-aware).
      if (bound?.k === "localtype" && bound.sym)
        return { n: current.text, l: bound.sym };
      if (bound) return null;
      return PREDECLARED_TYPES.has(current.text)
        ? { q: "", n: current.text }
        : { n: current.text };
    }
    if (current.type === "qualified_type") {
      const pkg = fieldOf(current, "package");
      const name = fieldOf(current, "name");
      return pkg && name ? { q: pkg.text, n: name.text } : null;
    }
    return null;
  }

  // ---- expressions -------------------------------------------------------

  /** Syntactic description of an expression's value; never consults other files. */
  private descDepth = 0;
  /** An expression's description (depth-bounded: deeper is unknown). */
  private desc(node: Node): Desc {
    if (this.descDepth >= MAX_TERM_DEPTH) return { k: "unknown" };
    this.descDepth++;
    try {
      return this.descOf(node);
    } finally {
      this.descDepth--;
    }
  }

  private descOf(node: Node): Desc {
    const current = unparen(node);
    switch (current.type) {
      case "nil":
      case "true":
      case "false":
      case "iota":
      case "identifier": {
        const bound = this.local(current.text);
        if (bound?.k === "localtype") return { k: "opaque" };
        if (bound) return bound;
        return { k: "name", n: current.text };
      }
      case "selector_expression": {
        const operand = fieldOf(current, "operand");
        const field = fieldOf(current, "field");
        if (!operand || !field) return { k: "unknown" };
        return { k: "sel", x: this.desc(operand), n: field.text };
      }
      case "unary_expression": {
        const operator = current.child(0)?.text;
        const operand = fieldOf(current, "operand");
        if (!operand) return { k: "unknown" };
        if (operator === "&" || operator === "*") return this.desc(operand);
        if (operator === "<-") return { k: "elem", x: this.desc(operand) };
        return { k: "unknown" };
      }
      case "composite_literal":
      case "type_assertion_expression": {
        const type = fieldOf(current, "type");
        return type ? this.typedValue(type) : { k: "unknown" };
      }
      case "index_expression": {
        const operand = fieldOf(current, "operand");
        return operand
          ? { k: "elem", x: this.desc(operand) }
          : { k: "unknown" };
      }
      case "slice_expression": {
        const operand = fieldOf(current, "operand");
        return operand ? this.desc(operand) : { k: "unknown" };
      }
      case "func_literal":
        return {
          k: "func",
          r: this.resultDescs(fieldOf(current, "result")),
        };
      case "call_expression": {
        const fn = fieldOf(current, "function");
        if (!fn) return { k: "unknown" };
        const callee = unparen(fn);
        const args = named(fieldOf(current, "arguments"));
        if (callee.type === "identifier" && !this.local(callee.text)) {
          // new(T), make(T, …) and append(s, …) have syntactically evident results
          // only if the builtin is what is called. A package-level declaration in
          // any file may shadow it, so resolution decides: `b` is used only when
          // the name does not resolve to a declaration.
          // Go 1.26: `new(expr)` takes a value; the grammar keeps the type
          // reading whenever the argument also reads as a type, so an
          // expression node here is always a value, and the result points at
          // that value's type.
          const hint =
            callee.text === "new" &&
            args[0] &&
            !TYPE_NODES.has(unparen(args[0]).type)
              ? this.desc(args[0])
              : (callee.text === "new" || callee.text === "make") && args[0]
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
        // A callee not described (a parenthesized conversion type such as
        // `(*p.T)(x)`) keeps what is written in it.
        if (!f) return this.undescribed(callee);
        return { k: "call", f, i: 0 };
      }
      case "type_conversion_expression": {
        const type = fieldOf(current, "type");
        if (!type) return { k: "unknown" };
        const f = this.typeNameDesc(type);
        return f ? { k: "call", f, i: 0 } : this.typedValue(type);
      }
      default:
        return { k: "unknown" };
    }
  }
  /**
   * A callee that is not described: what is written in it, and for a name
   * under `*` (`(*T)(x)`, `(**p.T)(x)`) how many `*` there are.
   */
  private undescribed(callee: Node): Desc {
    let current = unparen(callee);
    let stars = 0;
    for (;;) {
      if (
        current.type === "unary_expression" &&
        current.child(0)?.text === "*"
      ) {
        const operand = fieldOf(current, "operand");
        if (!operand) break;
        current = unparen(operand);
      } else if (current.type === "pointer_type") {
        const inner = named(current)[0];
        if (!inner) break;
        current = unparen(inner);
      } else break;
      stars++;
    }
    const name = [
      "identifier",
      "selector_expression",
      "type_identifier",
      "qualified_type",
    ].includes(current.type);
    return {
      k: "unknown",
      m: [this.desc(callee)],
      ...(stars && name ? { p: stars } : {}),
    };
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
      const operand = fieldOf(callee, "operand");
      return operand ? this.calleeDesc(unparen(operand)) : null;
    }
    return null;
  }
  private typeNameDesc(type: Node): Desc | null {
    const current =
      type.type === "generic_type" ? (fieldOf(type, "type") ?? type) : type;
    if (current.type === "type_identifier") {
      if (this.local(current.text)) return null;
      if (PREDECLARED_TYPES.has(current.text)) return null;
      return { k: "name", n: current.text };
    }
    if (current.type === "qualified_type") {
      const pkg = fieldOf(current, "package");
      const name = fieldOf(current, "name");
      return pkg && name
        ? { k: "sel", x: { k: "name", n: pkg.text }, n: name.text }
        : null;
    }
    return null;
  }

  private walkChildren(node: Node): void {
    for (const child of node.namedChildren) if (child) this.walk(child);
  }

  private walkDepth = 0;
  /**
   * Set when nesting is deeper than `MAX_WALK_DEPTH`: the file cannot be read in
   * full, so it fails like a file with a syntax error (index.ts).
   */
  truncated: Diagnostic | undefined;

  private walk(node: Node): void {
    if (this.walkDepth >= MAX_WALK_DEPTH) {
      this.truncated ??= {
        message: `${position(this.text, node.startIndex)}: nesting deeper than ${MAX_WALK_DEPTH} levels`,
        range: range(node),
      };
      return;
    }
    this.walkDepth++;
    try {
      this.walkNode(node);
    } finally {
      this.walkDepth--;
    }
  }

  private walkNode(node: Node): void {
    if (SCOPES.has(node.type)) {
      this.scoped(() => this.walkChildren(node));
      return;
    }
    switch (node.type) {
      case "comment":
        return;
      case "short_var_declaration": {
        const left = named(fieldOf(node, "left"));
        const right = named(fieldOf(node, "right"));
        for (const value of right) this.walk(value);
        const descs = this.specDescs(left, null, right);
        left.forEach((name, index) => {
          if (!isName(name)) return;
          // `a, err := …` redeclares nothing already in this scope: it writes it.
          const literal = isFuncLiteral(right, left.length, index);
          if (this.scopes.at(-1)?.get(name.text)?.k === "ref")
            this.write(name.text, descs[index]!, literal);
          else
            this.declare(name.text, descs[index]!, {
              at: name,
              initialized: true,
              literal,
            });
        });
        return;
      }
      case "assignment_statement": {
        const left = named(fieldOf(node, "left"));
        const right = named(fieldOf(node, "right"));
        const operator = fieldOf(node, "operator")?.text ?? "=";
        for (const value of right) this.walk(value);
        const descs =
          operator === "=" ? this.specDescs(left, null, right) : undefined;
        left.forEach((target, index) => {
          const name = unparen(target);
          if (isName(name) && this.local(name.text)?.k === "ref")
            this.write(
              name.text,
              descs ? descs[index]! : null,
              !!descs && isFuncLiteral(right, left.length, index),
            );
          else this.walk(target);
        });
        return;
      }
      case "inc_statement":
      case "dec_statement": {
        const operand = named(node)[0];
        if (!operand) return;
        const name = unparen(operand);
        if (isName(name) && this.local(name.text)?.k === "ref")
          this.write(name.text, null);
        else this.walk(operand);
        return;
      }
      case "unary_expression": {
        const operand = fieldOf(node, "operand");
        const name = operand ? unparen(operand) : undefined;
        if (node.child(0)?.text === "&" && name?.type === "identifier")
          this.write(name.text, null);
        this.walkChildren(node);
        return;
      }
      case "range_clause":
      case "receive_statement": {
        const left = fieldOf(node, "left");
        const right = fieldOf(node, "right");
        if (right) this.walk(right);
        const defines = node.children.some((child) => child?.text === ":=");
        const source: Desc = right ? this.desc(right) : { k: "unknown" };
        const items = named(left);
        items.forEach((name, index) => {
          if (!isName(name)) return this.walk(name);
          // range: key then element; receive: the element.
          const value: Desc =
            node.type === "range_clause" && index === 0 && items.length > 1
              ? { k: "key", x: source }
              : node.type === "range_clause"
                ? items.length > 1
                  ? { k: "elem", x: source }
                  : { k: "key", x: source }
                : source;
          if (defines)
            this.declare(name.text, value, { at: name, initialized: true });
          else if (this.local(name.text)?.k === "ref")
            this.write(name.text, null);
          else this.walk(name);
        });
        return;
      }
      case "type_switch_statement":
        this.scoped(() => {
          const value = fieldOf(node, "value");
          const initializer = fieldOf(node, "initializer");
          if (initializer) this.walk(initializer);
          if (value) this.walk(value);
          // The switch variable has its case's type: one type → that type;
          // several types or default → the switched operand's own description.
          const alias = named(fieldOf(node, "alias")).filter((name) =>
            isName(name),
          );
          const operand: Desc = value
            ? this.desc(
                value.type === "type_assertion_expression"
                  ? (fieldOf(value, "operand") ?? value)
                  : value,
              )
            : { k: "unknown" };
          for (const child of named(node)) {
            if (child.type !== "type_case" && child.type !== "default_case")
              continue;
            const types = fieldsOf(child, "type").filter(
              (item): item is Node => !!item && item.isNamed,
            );
            this.scoped(() => {
              for (const type of types) this.walk(type);
              const single =
                types.length === 1 && types[0]!.text !== "nil"
                  ? this.typedValue(types[0]!)
                  : operand;
              for (const name of alias)
                this.declare(name.text, single, {
                  at: name,
                  initialized: true,
                });
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
          const names = fieldsOf(spec, "name").filter(
            (item): item is Node => !!item,
          );
          const type = fieldOf(spec, "type");
          const values = named(fieldOf(spec, "value"));
          if (type) this.walk(type);
          for (const value of values) this.walk(value);
          const descs = this.specDescs(names, type, values);
          names.forEach((name, index) =>
            this.declare(name.text, descs[index]!, {
              at: name,
              initialized: values.length > 0,
              literal: isFuncLiteral(values, names.length, index),
            }),
          );
        }
        return;
      case "type_declaration":
        for (const spec of named(node)) {
          if (spec.type !== "type_spec" && spec.type !== "type_alias") continue;
          const name = fieldOf(spec, "name");
          if (!name) {
            this.walk(spec);
            continue;
          }
          // A local type is in scope from its declaration to the end of its block,
          // shadows outer names, and is a distinct type per declaration.
          const enclosing = this.byKey.get(this.owner)?.identity ?? "file";
          const identity = this.localIdentity(`${enclosing}.${name.text}`);
          this.declare(name.text, { k: "localtype", sym: identity });
          this.typeSpec(spec, identity);
        }
        return;
      case "struct_type":
        // An anonymous struct type (literal, field or variable type).
        return this.localStruct(node);
      case "func_literal":
        this.scoped(() => {
          this.parameters(fieldOf(node, "parameters"));
          this.parameters(fieldOf(node, "result"));
          const body = fieldOf(node, "body");
          if (body) this.walk(body);
        });
        return;
      case "parameter_declaration":
      case "variadic_parameter_declaration": {
        const type = fieldOf(node, "type");
        if (type) this.walk(type);
        return;
      }
      case "field_declaration": {
        const type = fieldOf(node, "type");
        if (type) this.walk(type);
        return;
      }
      case "keyed_element": {
        const key = fieldOf(node, "key");
        const value = fieldOf(node, "value");
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
      case "nil":
      case "true":
      case "false":
      case "iota":
        // Separate node kinds in the grammar; still shadowable names.
        return this.predeclared(node, "value");
      case "type_identifier":
        return this.typeIdentifier(node);
      case "qualified_type": {
        const pkg = fieldOf(node, "package");
        const name = fieldOf(node, "name");
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
    const fn = fieldOf(node, "function");
    const typeArguments = fieldOf(node, "type_arguments");
    const args = fieldOf(node, "arguments");
    if (fn) {
      const callee = unparen(fn);
      if (callee.type === "index_expression") {
        // F[int](x) instantiates a generic function; handlers["a"]() calls an element.
        // The grammar cannot tell; resolution can: only function operands are called.
        const operand = fieldOf(callee, "operand");
        this.link("calls", compact(callee), range(callee), {
          expr: (operand
            ? { k: "inst", x: this.desc(operand) }
            : { k: "unknown" }) as unknown as Json,
        });
        // The container (or generic function) itself is referenced.
        this.walk(callee);
      } else if (callee.type === "func_literal") this.walk(callee);
      else if (isName(callee)) {
        const bound = this.local(callee.text);
        if (
          !bound &&
          (PREDECLARED_TYPES.has(callee.text) ||
            PREDECLARED_VALUES.has(callee.text))
        ) {
          // Conversion to a predeclared type such as string(b): not a call, unless
          // a package declaration named `string` shadows it.
          this.predeclared(callee, "call");
        } else {
          this.link("calls", callee.text, range(callee), {
            expr: (bound ?? { k: "name", n: callee.text }) as unknown as Json,
            // Stable parse fact; `analyze` sets `builtin` only when no package
            // declaration of this name shadows the builtin.
            ...(!bound && BUILTIN_FUNCTIONS.has(callee.text)
              ? { builtinName: true }
              : {}),
          });
          if (bound?.k === "ref")
            this.localCalls.push({
              link: this.links.at(-1)!,
              binding: bound.b as Binding,
            });
        }
      } else if (callee.type === "selector_expression") {
        const operand = fieldOf(callee, "operand");
        this.link("calls", compact(callee), range(callee), {
          expr: this.desc(callee) as unknown as Json,
        });
        if (operand && unparen(operand).type !== "identifier")
          this.walk(operand);
      } else {
        // Not described (`(*p.T)(x)`, `f()()`): keeps what is written in it.
        this.link("calls", compact(callee), range(callee), {
          expr: this.undescribed(callee) as unknown as Json,
        });
        this.walk(callee);
      }
    }
    if (typeArguments) this.walk(typeArguments);
    if (args) this.walk(args);
  }

  private conversion(node: Node): void {
    const type = fieldOf(node, "type");
    const operand = fieldOf(node, "operand");
    const f = type ? this.typeNameDesc(type) : null;
    if (type && f) {
      // T(x) is a conversion, F[int](x) a generic call: the grammar cannot tell; resolution can.
      const base =
        type.type === "generic_type" ? (fieldOf(type, "type") ?? type) : type;
      this.link("calls", compact(base), range(base), {
        expr: f as unknown as Json,
      });
      if (type.type === "generic_type") {
        const args = fieldOf(type, "type_arguments");
        if (args) this.walk(args);
      }
    } else if (type) this.walk(type);
    if (operand) this.walk(operand);
  }

  private selector(node: Node): void {
    const operand = fieldOf(node, "operand");
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

  private localStructs = new Map<string, number>();
  private fieldStructs = new Map<string, number>();
  /** Identity of each anonymous struct symbol, by the start offset of its type. */
  private anonymousStructs = new Map<number, string>();
  /**
   * A function-local or anonymous struct type with at least one field. It
   * becomes a struct symbol (`data.local`) with its fields and `embeds` links,
   * like a package-level struct, so selectors on its values resolve to its
   * fields and promoted members. Its identity is anchored to the declaration
   * that owns it when the walk reaches it (a variable, a field, a type, or the
   * enclosing function): `<owner>.struct#<n>` for one that embeds something
   * (the 0.1.0 identity, numbered among those), `<owner>.anon#<n>` for one with
   * named fields only (numbered among those). `struct{}` is not a symbol.
   */
  private localStruct(node: Node): void {
    const fields = named(named(node)[0]).filter(
      (field) => field.type === "field_declaration",
    );
    if (!fields.length) return this.walkChildren(node);
    const embeds = fields.some((field) => !fieldsOf(field, "name").length);
    const enclosing = this.byKey.get(this.owner)?.identity ?? "file";
    let name: string;
    const outer = this.legacyOwner;
    if (embeds) {
      // The 0.1.0 identity: owned by the nearest declaration that is not
      // inside a field-only anonymous struct (those were not symbols then).
      const owner = outer ?? enclosing;
      const count = (this.localStructs.get(owner) ?? 0) + 1;
      this.localStructs.set(owner, count);
      name = this.localIdentity(`${owner}.struct#${count}`);
      // Its own fields own what is inside it, as in 0.1.0.
      this.legacyOwner = undefined;
    } else {
      const count = (this.fieldStructs.get(enclosing) ?? 0) + 1;
      this.fieldStructs.set(enclosing, count);
      // An owner inside this file already carries the file name.
      const prefix = `${basename(this.path)}:`;
      name = enclosing.startsWith(prefix)
        ? this.uniqueIdentity(`${enclosing}.anon#${count}`)
        : this.localIdentity(`${enclosing}.anon#${count}`);
      this.legacyOwner = outer ?? enclosing;
    }
    this.anonymousStructs.set(node.startIndex, name);
    // `anonymous`: generated, not a name in the source; listed after named
    // declarations by search and file listings.
    const key = this.symbol("struct", name, name, range(node), {
      local: true,
      anonymous: true,
    });
    this.contains(this.owner, key, range(node));
    try {
      this.within(key, () => this.structFields(name, key, node, true));
    } finally {
      this.legacyOwner = outer;
    }
  }
  /**
   * While inside a field-only anonymous struct: the owner an embedding
   * anonymous struct had in 0.1.0, when such structs were not symbols.
   */
  private legacyOwner: string | undefined;
  /**
   * Replaces each anonymous struct's pending reference (`local.sym`) in the
   * file's facts by its identity; one the walk never reached loses it.
   */
  private anonymous(value: Json): Json {
    if (Array.isArray(value)) return value.map((item) => this.anonymous(item));
    if (!value || typeof value !== "object") return value;
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      if (
        key === "sym" &&
        typeof item === "string" &&
        item.startsWith(PENDING)
      ) {
        const identity = this.anonymousStructs.get(
          Number(item.slice(PENDING.length)),
        );
        if (identity !== undefined) out[key] = identity;
      } else out[key] = this.anonymous(item as Json);
    }
    return out;
  }

  /** A use of a predeclared name: a link only if a package declaration shadows it. */
  private predeclared(node: Node, kind: "value" | "type" | "call"): void {
    // A local of that name is in scope: not the predeclared identifier, not linked.
    if (this.local(node.text)) return;
    (this.fact.predeclared ??= []).push({
      n: node.text,
      k: kind,
      s: node.startIndex,
      e: node.endIndex,
      src: this.owner,
    });
  }

  private identifier(node: Node): void {
    const name = node.text;
    if (name === "_" || this.local(name)) return;
    if (
      PREDECLARED_VALUES.has(name) ||
      PREDECLARED_TYPES.has(name) ||
      BUILTIN_FUNCTIONS.has(name)
    )
      return this.predeclared(node, "value");
    this.link("references", name, range(node), {
      expr: { k: "name", n: name },
    });
  }

  private typeIdentifier(node: Node): void {
    const name = node.text;
    if (this.local(name)) return;
    if (PREDECLARED_TYPES.has(name) || PREDECLARED_VALUES.has(name))
      return this.predeclared(node, "type");
    this.link("references", name, range(node), { t: { n: name } });
  }
}

/** Whether `values[index]`, the value assigned to the `index`th of `count` names, is a func literal. */
function isFuncLiteral(
  values: readonly Node[],
  count: number,
  index: number,
): boolean {
  if (values.length !== count) return false;
  const value = values[index];
  return !!value && unparen(value).type === "func_literal";
}

/**
 * A binding that can hold only one func literal: declared with it and never
 * written, or declared without a value and written exactly once, with a func
 * literal. A write the extractor cannot see (address taken, op-assignment)
 * proves nothing.
 */
function singleLiteral(binding: Binding): boolean {
  if (binding.opaque) return false;
  if (binding.initialized)
    return !!binding.literal && binding.writes.length === 0;
  return binding.writes.length === 1 && binding.literalWrites[0] === true;
}
