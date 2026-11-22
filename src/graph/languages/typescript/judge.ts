// SPDX-License-Identifier: MIT
import ts from "typescript";
import {
  aliasChain,
  causesOfSymbol,
  taintUnknown,
  type Taint,
} from "./taint.js";

/**
 * The structural judgement (P-E, default-deny; docs/changes/W2-D.md, "The
 * structural rule"): what a receiver's type is, derived from the source,
 * never from the route its value took and never from whatever the checker
 * found. It runs when a receiver's chain is tainted at any depth. Every step
 * is trusted only through an EXPLICIT case below; an expression kind, a
 * declaration (member) kind, a type-node kind, a contextual position, an
 * iterable, an awaited value or a callee this module has no case for is
 * FAILED (the `default` of each table, `unhandled`).
 *
 * Substitution is explicit: a type node is interpreted under an environment
 * that maps each type parameter in scope (the owner's, the method's, the
 * alias's) to the judgement of its argument; a type parameter is tainted
 * only if its argument is. `this` denotes the receiver's own judged type.
 * Alias references expand under the environment of their arguments, with a
 * visited set and no depth limit.
 */
export type Judged =
  | { k: "clean" }
  | { k: "failed"; why: string }
  /** An instance of a class or interface: its member set is its own. */
  | { k: "object"; symbol: ts.Symbol; env: Env; self?: Judged | undefined }
  | {
      k: "literal";
      node: ts.TypeLiteralNode;
      env: Env;
      self?: Judged | undefined;
    }
  | { k: "objectLiteral"; node: ts.ObjectLiteralExpression }
  | {
      k: "function";
      decls: readonly ts.SignatureDeclaration[];
      env: Env;
      self?: Judged | undefined;
      /** `fn.call` / `fn.apply` / `fn.bind` of the function. */
      relay?: "call" | "apply" | "bind" | undefined;
    }
  /** A class, namespace or module as a value. */
  | { k: "static"; symbol: ts.Symbol }
  | { k: "union"; parts: Judged[] }
  | { k: "tuple"; elements: Judged[]; rest?: Judged | undefined }
  /** A type the checker derived from inputs that are all untainted (R-2). */
  | { k: "checked"; type: ts.Type }
  /**
   * A computation over untainted inputs whose instantiation cannot be
   * derived here: not tainted, but any use of it is unhandled (FAILED).
   */
  | { k: "opaque"; why: string };
export type Env = ReadonlyMap<ts.Symbol, () => Judged>;

// Mutation switches (each default can be turned into KEEP for a mutation).
const DENY_EXPRESSION = true;
const DENY_TYPE = true;
const DENY_DECLARATION = true;
const DENY_CONTEXTUAL = true;
const DENY_ELEMENT = true;
const DENY_AWAIT = true;
const DENY_CALL = true;
/** Alias expansion depth limit; 0 means none (mutation: reintroduce one). */
const ALIAS_LIMIT = 0;
/** How a type parameter is judged: by its argument (mutations: all / none). */
const TYPE_PARAMETERS = "argument" as "argument" | "all" | "none";
/** `this` denotes the receiver (mutation: drop the environment). */
const THIS_ENVIRONMENT = true;
/** O2: overloads whose parameter types depend on a failed file. */
const FAILED_PARAMETER_OVERLOADS = true;
/** R-1: overloads that all return one class keep its member set. */
const SAME_CLASS_OVERLOADS = true;

const CLEAN: Judged = { k: "clean" };
const EMPTY: Env = new Map();
const NONE: ReadonlySet<ts.Node> = new Set();
const failed = (why: string): Judged => ({ k: "failed", why });

export interface JudgeInput {
  checker: ts.TypeChecker;
  program: ts.Program;
  taint: Taint;
  failedNames: ReadonlyMap<string, readonly string[]>;
  /** The failed captured file a module specifier resolves to, if any. */
  failedModule: (specifier: ts.Expression) => string | undefined;
  /** Whether a class or interface's member set reaches a failed file. */
  memberSetTainted: (symbol: ts.Symbol) => boolean;
}

export interface Judge {
  expression(node: ts.Expression | ts.QualifiedName): Judged;
  tainted(judged: Judged): boolean;
  /** O2: the failed files a signature's parameter or constraint types depend on. */
  signatureDependsOnFailed(signature: ts.SignatureDeclaration): string[];
  /**
   * The gate (i): the failed files a node reaches at any depth, through
   * every name in it to its declarations (types, initialisers, bodies).
   */
  reaches(node: ts.Node): string[];
}

type Handler<T extends ts.Node, C> = (node: T, context: C) => Judged;
const table = <T extends ts.Node, C>(
  entries: Record<string, Handler<T, C>>,
): Map<ts.SyntaxKind, Handler<T, C>> => {
  const map = new Map<ts.SyntaxKind, Handler<T, C>>();
  for (const [name, handler] of Object.entries(entries)) {
    const kind = ts.SyntaxKind[name as keyof typeof ts.SyntaxKind];
    if (kind === undefined) throw new Error(`no syntax kind ${name}`);
    map.set(kind, handler);
  }
  return map;
};
const kindName = (kind: ts.SyntaxKind): string => {
  for (const [name, value] of Object.entries(ts.SyntaxKind))
    if (value === kind && !/^(First|Last)/.test(name)) return name;
  return String(kind);
};

const LIBRARY_ITERABLES = new Set([
  "Array",
  "ReadonlyArray",
  "ConcatArray",
  "Set",
  "ReadonlySet",
]);
const LIBRARY_ENTRIES = new Set(["Map", "ReadonlyMap"]);
const PROMISES = new Set(["Promise", "PromiseLike"]);
const FUNCTION_MEMBERS = new Set([
  "length",
  "name",
  "toString",
  "arguments",
  "caller",
]);

interface TypeContext {
  env: Env;
  self?: Judged | undefined;
  visiting: ReadonlySet<ts.Node>;
  /** The expression whose checker type is this node's instantiation. */
  at?: ts.Node | undefined;
}

/** The kinds each table handles (asserted by a test, visible in review). */
export const HANDLED: Record<string, readonly string[]> = {};

export function createJudge(input: JudgeInput): Judge {
  const { checker, program, taint, failedNames } = input;
  const library = (node: ts.Node) =>
    program.isSourceFileDefaultLibrary(node.getSourceFile());
  const symbolAt = (node: ts.Node): ts.Symbol | undefined => {
    try {
      return checker.getSymbolAtLocation(node);
    } catch {
      return undefined;
    }
  };
  const unknownSymbol = (symbol: ts.Symbol) =>
    !symbol.declarations?.length && !(symbol.flags & ts.SymbolFlags.Alias);
  const resolved = (symbol: ts.Symbol): ts.Symbol => {
    if (!(symbol.flags & ts.SymbolFlags.Alias)) return symbol;
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  };
  const seed = (symbol: ts.Symbol): boolean =>
    aliasChain(checker, symbol).some(
      (step) => (taint.seeds.get(step)?.size ?? 0) > 0,
    );
  const unread = (name: string) => (failedNames.get(name)?.length ?? 0) > 0;
  const unhandled = (deny: boolean, which: string, what: string): Judged =>
    deny ? failed(`unhandled ${which} ${what} (default)`) : CLEAN;

  function join(parts: readonly Judged[]): Judged {
    const flat: Judged[] = [];
    for (const part of parts) {
      if (part.k === "failed") return part;
      if (part.k === "union") flat.push(...part.parts);
      else if (part.k !== "clean") flat.push(part);
    }
    if (!flat.length) return CLEAN;
    return flat.length === 1 ? flat[0]! : { k: "union", parts: flat };
  }
  // A judgement that met a cycle (a value that depends on itself) is not
  // memoised, so no answer depends on the order of evaluation.
  let cycles = 0;
  function lazy(compute: () => Judged): () => Judged {
    let state = 0;
    let value: Judged = CLEAN;
    return () => {
      if (state === 2) return value;
      if (state === 1) {
        cycles++;
        return failed("a type that depends on itself");
      }
      state = 1;
      const before = cycles;
      const computed = compute();
      if (cycles === before) {
        value = computed;
        state = 2;
      } else state = 0;
      return computed;
    };
  }
  const typeParametersOf = (
    symbol: ts.Symbol,
  ): readonly ts.TypeParameterDeclaration[] => {
    for (const declaration of symbol.declarations ?? [])
      if (
        (ts.isClassLike(declaration) ||
          ts.isInterfaceDeclaration(declaration) ||
          ts.isTypeAliasDeclaration(declaration)) &&
        declaration.typeParameters?.length
      )
        return declaration.typeParameters;
    return [];
  };
  function bind(
    parameters: readonly ts.TypeParameterDeclaration[],
    args: readonly ts.TypeNode[] | undefined,
    context: TypeContext,
    base: Env,
  ): Env {
    const env = new Map(base);
    parameters.forEach((parameter, index) => {
      const symbol = symbolAt(parameter.name);
      if (!symbol) return;
      const argument = args?.[index];
      env.set(
        symbol,
        lazy(() =>
          argument
            ? type(argument, { ...context, at: undefined })
            : parameter.default
              ? type(parameter.default, {
                  env,
                  self: context.self,
                  visiting: context.visiting,
                })
              : CLEAN,
        ),
      );
    });
    return env;
  }
  const failedAll = (symbol: ts.Symbol, why: string): Env => {
    const env = new Map<ts.Symbol, () => Judged>();
    for (const parameter of typeParametersOf(symbol)) {
      const parameterSymbol = symbolAt(parameter.name);
      if (parameterSymbol) env.set(parameterSymbol, () => failed(why));
    }
    return env;
  };
  const globals = new Map<string, ts.Symbol | undefined>();
  function globalInterface(name: string): ts.Symbol | undefined {
    if (globals.has(name)) return globals.get(name);
    let found: ts.Symbol | undefined;
    // program-reader: default-lib (scoped.ts PROGRAM_READERS)
    for (const source of program.getSourceFiles()) {
      if (!program.isSourceFileDefaultLibrary(source)) continue;
      for (const statement of source.statements)
        if (
          ts.isInterfaceDeclaration(statement) &&
          statement.name.text === name
        )
          found ??= symbolAt(statement.name);
      if (found) break;
    }
    globals.set(name, found);
    return found;
  }
  const container = (name: string, element: () => Judged): Judged => {
    const symbol = globalInterface(name);
    if (!symbol) return unhandled(DENY_TYPE, "type", `missing ${name}`);
    const parameter = typeParametersOf(symbol)[0];
    const parameterSymbol = parameter && symbolAt(parameter.name);
    const env = new Map<ts.Symbol, () => Judged>();
    if (parameterSymbol) env.set(parameterSymbol, lazy(element));
    return { k: "object", symbol, env };
  };
  const firstArgument = (judged: Judged & { k: "object" }): Judged => {
    const parameter = typeParametersOf(judged.symbol)[0];
    const symbol = parameter && symbolAt(parameter.name);
    return (symbol && judged.env.get(symbol)?.()) ?? CLEAN;
  };

  // ---------------- taint of a judgement ----------------
  function tainted(judged: Judged, seen = new Set<Judged>()): boolean {
    if (seen.has(judged)) return false;
    seen.add(judged);
    switch (judged.k) {
      case "clean":
      case "checked":
      case "opaque":
        return false;
      case "failed":
        return true;
      case "object":
        return (
          input.memberSetTainted(judged.symbol) ||
          typeParametersOf(judged.symbol).some((parameter) => {
            const symbol = symbolAt(parameter.name);
            const value = symbol && judged.env.get(symbol);
            return !!value && tainted(value(), seen);
          })
        );
      case "literal":
        return judged.node.members.some((member) =>
          typeNodesOf(member).some((node) =>
            tainted(
              type(node, {
                env: judged.env,
                self: judged.self,
                visiting: NONE,
              }),
              seen,
            ),
          ),
        );
      case "function":
        return judged.decls.some((declaration) =>
          typeNodesOf(declaration).some((node) =>
            tainted(
              type(node, {
                env: judged.env,
                self: judged.self,
                visiting: NONE,
              }),
              seen,
            ),
          ),
        );
      case "objectLiteral":
        return judged.node.properties.some((property) =>
          tainted(declaration(property, EMPTY, undefined), seen),
        );
      case "static":
        return input.memberSetTainted(judged.symbol) || seed(judged.symbol);
      case "union":
        return judged.parts.some((part) => tainted(part, seen));
      case "tuple":
        return [...judged.elements, judged.rest ?? CLEAN].some((element) =>
          tainted(element, seen),
        );
    }
  }
  /** The declared type nodes of a member or signature. */
  function typeNodesOf(node: ts.Node): ts.TypeNode[] {
    const nodes: ts.TypeNode[] = [];
    const add = (part: ts.TypeNode | undefined) => {
      if (part) nodes.push(part);
    };
    if (ts.isPropertySignature(node) || ts.isIndexSignatureDeclaration(node))
      add(node.type);
    if (ts.isFunctionLike(node)) {
      add(node.type);
      for (const parameter of node.parameters) add(parameter.type);
      for (const parameter of node.typeParameters ?? [])
        add(parameter.constraint);
    }
    return nodes;
  }

  // ---------------- dependence on a failed file, at any depth ----------------
  /**
   * A dependency graph over symbols, built lazily and once per program:
   * each symbol's direct failed files and the symbols its declarations name
   * (which parts of a declaration count is `partsOf`). Failed files are
   * propagated to dependents over reverse edges by a worklist, so every
   * answer is the complete union over everything reachable, whatever the
   * order of the questions.
   */
  function dependenceGraph(partsOf: (symbol: ts.Symbol) => ts.Node[]) {
    const explored = new Map<ts.Symbol, Set<string>>();
    const dependents = new Map<ts.Symbol, ts.Symbol[]>();
    /** The failed files and symbols a node names directly. */
    const direct = (
      node: ts.Node,
      files: Set<string>,
      symbols: Set<ts.Symbol>,
    ) => {
      const visit = (child: ts.Node): void => {
        const specifier =
          ts.isCallExpression(child) &&
          (child.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(child.expression) &&
              child.expression.text === "require"))
            ? child.arguments[0]
            : ts.isImportTypeNode(child) && ts.isLiteralTypeNode(child.argument)
              ? child.argument.literal
              : undefined;
        const module = specifier && input.failedModule(specifier);
        if (module) files.add(module);
        // `this` and `super` name their class (its heritage and members).
        if (
          child.kind === ts.SyntaxKind.ThisKeyword ||
          child.kind === ts.SyntaxKind.SuperKeyword
        ) {
          const owner = ts.findAncestor(child.parent, ts.isClassLike);
          const symbol = owner?.name ? symbolAt(owner.name) : undefined;
          if (symbol) symbols.add(symbol);
          return;
        }
        if (ts.isShorthandPropertyAssignment(child)) {
          const value = checker.getShorthandAssignmentValueSymbol(child);
          if (value) symbols.add(resolved(value));
        }
        if (ts.isIdentifier(child) || ts.isPrivateIdentifier(child)) {
          const symbol0 = symbolAt(child);
          if (!symbol0 || unknownSymbol(symbol0)) {
            if (ts.isIdentifier(child))
              for (const file of failedNames.get(child.text) ?? [])
                files.add(file);
            return;
          }
          for (const step of aliasChain(checker, symbol0))
            for (const file of [
              ...(taint.seeds.get(step) ?? []),
              ...causesOfSymbol(taint.all, step),
              ...causesOfSymbol(taint.weak, step),
            ])
              files.add(file);
          symbols.add(resolved(symbol0));
          return;
        }
        ts.forEachChild(child, visit);
      };
      visit(node);
    };
    /** Explores everything reachable from `roots` (iteratively), then propagates. */
    function explore(roots: Iterable<ts.Symbol>): void {
      const stack = [...roots];
      const fresh: ts.Symbol[] = [];
      // Already explored symbols that gained a dependent: their files must
      // reach it.
      const touched = new Set<ts.Symbol>();
      while (stack.length) {
        const symbol = stack.pop()!;
        if (explored.has(symbol)) continue;
        const files = new Set<string>();
        const symbols = new Set<ts.Symbol>();
        if ((symbol.declarations ?? []).some((d) => !library(d)))
          for (const part of partsOf(symbol)) direct(part, files, symbols);
        explored.set(symbol, files);
        fresh.push(symbol);
        for (const next of symbols) {
          if (next === symbol) continue;
          const list = dependents.get(next) ?? [];
          list.push(symbol);
          dependents.set(next, list);
          if (explored.has(next)) touched.add(next);
          else stack.push(next);
        }
      }
      const queue = [...fresh, ...touched];
      while (queue.length) {
        const symbol = queue.pop()!;
        const files = explored.get(symbol)!;
        if (!files.size) continue;
        for (const dependent of dependents.get(symbol) ?? []) {
          const target = explored.get(dependent)!;
          let grew = false;
          for (const file of files)
            if (!target.has(file)) {
              target.add(file);
              grew = true;
            }
          if (grew) queue.push(dependent);
        }
      }
    }
    return (node: ts.Node, extra: ts.Node[] = []): string[] => {
      const files = new Set<string>();
      const symbols = new Set<ts.Symbol>();
      for (const part of [node, ...extra]) direct(part, files, symbols);
      explore(symbols);
      for (const symbol of symbols)
        for (const file of explored.get(symbol) ?? []) files.add(file);
      return [...files].sort();
    };
  }
  /** Everything a symbol's value can depend on (the gate (i)). */
  function valueParts(symbol: ts.Symbol): ts.Node[] {
    const parts: ts.Node[] = [];
    for (const declaration of symbol.declarations ?? []) {
      if (library(declaration)) continue;
      parts.push(declaration);
      // A destructured name: the whole declaration it comes from.
      let root: ts.Node = declaration;
      while (
        ts.isBindingElement(root) ||
        ts.isObjectBindingPattern(root) ||
        ts.isArrayBindingPattern(root)
      )
        root = root.parent;
      if (root !== declaration) parts.push(root);
      // A `for … of` / `for … in` variable: the iterated expression.
      const loop = ts.isVariableDeclaration(root)
        ? root.parent?.parent
        : undefined;
      if (loop && (ts.isForOfStatement(loop) || ts.isForInStatement(loop)))
        parts.push(loop.expression);
      // An untyped callback parameter: what types it contextually (the
      // call, variable or property its function is given to).
      if (
        ts.isParameter(root) &&
        !root.type &&
        (ts.isArrowFunction(root.parent) ||
          ts.isFunctionExpression(root.parent) ||
          (ts.isMethodDeclaration(root.parent) &&
            ts.isObjectLiteralExpression(root.parent.parent)))
      ) {
        let holder: ts.Node = root.parent.parent;
        while (
          ts.isParenthesizedExpression(holder) ||
          ts.isPropertyAssignment(holder) ||
          ts.isObjectLiteralExpression(holder) ||
          ts.isArrayLiteralExpression(holder) ||
          ts.isSpreadElement(holder) ||
          ts.isConditionalExpression(holder) ||
          ts.isBinaryExpression(holder)
        )
          holder = holder.parent;
        parts.push(holder);
      }
    }
    return parts;
  }
  /** The type-level parts of a class, interface or alias (O2). */
  function typeParts(symbol: ts.Symbol): ts.Node[] {
    if (
      !(
        symbol.flags &
        (ts.SymbolFlags.Class |
          ts.SymbolFlags.Interface |
          ts.SymbolFlags.TypeAlias |
          ts.SymbolFlags.TypeParameter)
      )
    )
      return [];
    const parts: ts.Node[] = [];
    for (const declaration of symbol.declarations ?? []) {
      if (library(declaration)) continue;
      if (ts.isTypeAliasDeclaration(declaration)) parts.push(declaration.type);
      if (ts.isTypeParameterDeclaration(declaration)) {
        if (declaration.constraint) parts.push(declaration.constraint);
        if (declaration.default) parts.push(declaration.default);
      }
      if (
        ts.isClassLike(declaration) ||
        ts.isInterfaceDeclaration(declaration)
      ) {
        parts.push(...(declaration.heritageClauses ?? []));
        for (const member of declaration.members)
          parts.push(...typeNodesOf(member));
      }
      for (const parameter of (
        declaration as { typeParameters?: ts.NodeArray<ts.Node> }
      ).typeParameters ?? [])
        parts.push(parameter);
    }
    return parts;
  }
  // Under an unknown taint (the walk stopped at its budget) these graphs are
  // not explored, for cost: on microsoft/TypeScript one exploration from
  // the global `Object` exhausted the heap (docs/changes/C-26.md). A link
  // whose receiver reaches a failed file only at depth is then
  // `taint-budget-exhausted` without a cause, where an explored graph gives
  // `invalid-code` with one; links that bind a failed file directly are
  // still answered from the direct causes. Within the budget, unchanged.
  const unknown = taintUnknown(taint);
  const reachesGraph = unknown ? () => [] : dependenceGraph(valueParts);
  const typesGraph = unknown ? () => [] : dependenceGraph(typeParts);
  function reaches(node: ts.Node): string[] {
    return reachesGraph(node);
  }
  function signatureDependsOnFailed(
    signature: ts.SignatureDeclaration,
  ): string[] {
    const parts: ts.Node[] = [
      ...signature.parameters.flatMap((parameter) =>
        parameter.type ? [parameter.type] : [],
      ),
      ...(signature.typeParameters ?? []),
    ];
    const [first, ...rest] = parts;
    return first ? typesGraph(first, rest) : [];
  }

  // ---------------- types ----------------
  function type(node: ts.TypeNode, context: TypeContext): Judged {
    const handler = TYPES.get(node.kind);
    return handler
      ? handler(node, context)
      : unhandled(DENY_TYPE, "type", kindName(node.kind));
  }
  const keyword = () => CLEAN;
  const inner = (
    node: ts.TypeNode & { type: ts.TypeNode },
    context: TypeContext,
  ) => type(node.type, context);
  const TYPES = table<ts.TypeNode, TypeContext>({
    AnyKeyword: keyword,
    UnknownKeyword: keyword,
    NumberKeyword: keyword,
    BigIntKeyword: keyword,
    BooleanKeyword: keyword,
    StringKeyword: keyword,
    SymbolKeyword: keyword,
    VoidKeyword: keyword,
    UndefinedKeyword: keyword,
    NeverKeyword: keyword,
    ObjectKeyword: keyword,
    IntrinsicKeyword: keyword,
    LiteralType: keyword,
    TypePredicate: keyword,
    ThisType: (node, context) =>
      THIS_ENVIRONMENT && context.self ? context.self : thisOf(node),
    TypeReference: (node, context) => {
      const reference = node as ts.TypeReferenceNode;
      return referenceType(
        reference.typeName,
        reference.typeArguments,
        context,
      );
    },
    ExpressionWithTypeArguments: (node, context) => {
      const reference = node as ts.ExpressionWithTypeArguments;
      return ts.isIdentifier(reference.expression) ||
        ts.isPropertyAccessExpression(reference.expression)
        ? referenceType(
            reference.expression as ts.EntityNameExpression,
            reference.typeArguments,
            context,
          )
        : unhandled(DENY_TYPE, "type", "heritage expression");
    },
    ArrayType: (node, context) =>
      container(isReadonly(node) ? "ReadonlyArray" : "Array", () =>
        type((node as ts.ArrayTypeNode).elementType, {
          ...context,
          at: undefined,
        }),
      ),
    TupleType: (node, context) => {
      // From the first rest element on, every index has the rest's type.
      const elements: Judged[] = [];
      let rest: Judged | undefined;
      for (const element of (node as ts.TupleTypeNode).elements) {
        const isRest =
          ts.isRestTypeNode(element) ||
          (ts.isNamedTupleMember(element) && !!element.dotDotDotToken);
        const judged = type(element, { ...context, at: undefined });
        if (isRest || rest)
          rest = join([rest ?? CLEAN, isRest ? elementOf(judged) : judged]);
        else elements.push(judged);
      }
      return { k: "tuple", elements, rest };
    },
    NamedTupleMember: (node, context) =>
      inner(node as ts.NamedTupleMember, context),
    OptionalType: (node, context) =>
      inner(node as ts.OptionalTypeNode, context),
    RestType: (node, context) => inner(node as ts.RestTypeNode, context),
    ParenthesizedType: (node, context) =>
      inner(node as ts.ParenthesizedTypeNode, context),
    FunctionType: (node, context) => ({
      k: "function",
      decls: [node as ts.FunctionTypeNode],
      env: context.env,
      self: context.self,
    }),
    ConstructorType: (node, context) => ({
      k: "function",
      decls: [node as ts.ConstructorTypeNode],
      env: context.env,
      self: context.self,
    }),
    TypeLiteral: (node, context) => ({
      k: "literal",
      node: node as ts.TypeLiteralNode,
      env: context.env,
      self: context.self,
    }),
    UnionType: (node, context) =>
      join(
        (node as ts.UnionTypeNode).types.map((part) =>
          type(part, { ...context, at: undefined }),
        ),
      ),
    IntersectionType: (node, context) =>
      join(
        (node as ts.IntersectionTypeNode).types.map((part) =>
          type(part, { ...context, at: undefined }),
        ),
      ),
    TypeOperator: (node, context) => {
      const operator = node as ts.TypeOperatorNode;
      return operator.operator === ts.SyntaxKind.ReadonlyKeyword
        ? type(operator.type, context)
        : computation(node, context);
    },
    ConditionalType: computationHandler,
    MappedType: computationHandler,
    IndexedAccessType: computationHandler,
    InferType: computationHandler,
    TemplateLiteralType: computationHandler,
    TypeQuery: computationHandler,
    ImportType: (node, context) => {
      const imported = node as ts.ImportTypeNode;
      const argument = ts.isLiteralTypeNode(imported.argument)
        ? imported.argument.literal
        : undefined;
      if (argument && input.failedModule(argument))
        return failed("an import type of the failed file");
      return computation(node, context);
    },
  });
  HANDLED.types = [...TYPES.keys()].map(kindName);
  function isReadonly(node: ts.Node): boolean {
    return (
      ts.isTypeOperatorNode(node.parent) &&
      node.parent.operator === ts.SyntaxKind.ReadonlyKeyword
    );
  }
  function computationHandler(node: ts.TypeNode, context: TypeContext) {
    return computation(node, context);
  }
  /**
   * (iii) A computation is FAILED iff a type parameter or type reference
   * anywhere inside it is tainted under the environment; otherwise its
   * inputs are clean and the checker's answer stands (R-2).
   */
  function computation(node: ts.TypeNode, context: TypeContext): Judged {
    let found = false;
    const inside = { ...context, at: undefined };
    const visit = (child: ts.Node): void => {
      if (found) return;
      if (
        ts.isTypeReferenceNode(child) ||
        ts.isExpressionWithTypeArguments(child)
      ) {
        found = tainted(type(child, inside));
        return;
      }
      if (ts.isTypeQueryNode(child)) {
        found = tainted(expression(child.exprName));
        if (!found) child.typeArguments?.forEach(visit);
        return;
      }
      if (ts.isImportTypeNode(child)) {
        const argument = ts.isLiteralTypeNode(child.argument)
          ? child.argument.literal
          : undefined;
        found = !!argument && !!input.failedModule(argument);
        if (!found && child.qualifier) {
          const symbol0 = symbolAt(child.qualifier);
          found = !!symbol0 && seed(symbol0);
        }
        if (!found) child.typeArguments?.forEach(visit);
        return;
      }
      if (child.kind === ts.SyntaxKind.ThisType) {
        found = tainted(
          THIS_ENVIRONMENT && context.self ? context.self : thisOf(child),
        );
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    if (found) return failed("a type-level computation over a tainted input");
    // Clean inputs: the checker's own derivation stands.
    if (context.at) return fromType(typeAt(context.at));
    if (!mentionsTypeParameter(node, context)) {
      try {
        return fromType(checker.getTypeFromTypeNode(node));
      } catch {
        return unhandled(DENY_TYPE, "type", "computation without a type");
      }
    }
    return {
      k: "opaque",
      why: "a computation over substituted type parameters, not at an expression",
    };
  }
  function mentionsTypeParameter(node: ts.Node, context: TypeContext): boolean {
    let found = false;
    const visit = (child: ts.Node): void => {
      if (found) return;
      if (child.kind === ts.SyntaxKind.ThisType) found = !!context.self;
      else if (ts.isTypeReferenceNode(child)) {
        const symbol = symbolAt(
          ts.isQualifiedName(child.typeName)
            ? child.typeName.right
            : child.typeName,
        );
        if (
          symbol &&
          symbol.flags & ts.SymbolFlags.TypeParameter &&
          context.env.has(symbol)
        )
          found = true;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  }
  function typeAt(node: ts.Node): ts.Type {
    return checker.getTypeAtLocation(node);
  }
  function referenceType(
    name: ts.EntityName | ts.EntityNameExpression,
    args: readonly ts.TypeNode[] | undefined,
    context: TypeContext,
  ): Judged {
    const right = ts.isIdentifier(name)
      ? name
      : ts.isQualifiedName(name)
        ? name.right
        : (name as ts.PropertyAccessExpression).name;
    const leftmost = (node: ts.Node): ts.Identifier | undefined =>
      ts.isIdentifier(node)
        ? node
        : ts.isQualifiedName(node)
          ? leftmost(node.left)
          : ts.isPropertyAccessExpression(node)
            ? leftmost(node.expression)
            : undefined;
    const symbol0 = symbolAt(right);
    const left = leftmost(name);
    if (!symbol0 || unknownSymbol(symbol0)) {
      const leftSymbol = left && symbolAt(left);
      if (left && leftSymbol && seed(leftSymbol))
        return failed(`binding ${leftSymbol.name}`);
      return (left && unread(left.text)) || unread(right.text)
        ? failed(`name ${right.text} declared in the failed file`)
        : CLEAN;
    }
    if (seed(symbol0)) return failed(`binding ${symbol0.name}`);
    const symbol = resolved(symbol0);
    if (!symbol.declarations?.length)
      return unread(right.text)
        ? failed(`name ${right.text} declared in the failed file`)
        : CLEAN;
    if (symbol.flags & ts.SymbolFlags.TypeParameter)
      return typeParameter(symbol, context);
    const alias = symbol.declarations.find(ts.isTypeAliasDeclaration);
    if (alias) {
      if (context.visiting.has(alias))
        return [...context.env.values()].some((value) => tainted(value()))
          ? failed("a recursive type alias over a tainted input")
          : CLEAN;
      if (ALIAS_LIMIT && context.visiting.size >= ALIAS_LIMIT) return CLEAN;
      const env = bind(alias.typeParameters ?? [], args, context, context.env);
      return type(alias.type, {
        env,
        self: context.self,
        visiting: new Set(context.visiting).add(alias),
        at: context.at,
      });
    }
    if (symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface))
      return {
        k: "object",
        symbol,
        env: bind(typeParametersOf(symbol), args, context, EMPTY),
      };
    if (symbol.flags & (ts.SymbolFlags.Enum | ts.SymbolFlags.EnumMember))
      return CLEAN;
    return unhandled(DENY_TYPE, "type", `reference to ${symbol.name}`);
  }
  const resolvingParameters = new Set<ts.Symbol>();
  function typeParameter(symbol: ts.Symbol, context: TypeContext): Judged {
    if (TYPE_PARAMETERS === "all") return failed("a type parameter");
    if (TYPE_PARAMETERS === "none") return CLEAN;
    const bound = context.env.get(symbol);
    if (bound) return bound();
    // Unbound (abstract, as inside its own declaration): its constraint.
    // Re-entered through its own constraint: that occurrence adds no input
    // the outer one does not already have (not memoised: a cycle).
    if (resolvingParameters.has(symbol)) {
      cycles++;
      return CLEAN;
    }
    const declaration = symbol.declarations?.find(
      ts.isTypeParameterDeclaration,
    );
    const constraint =
      declaration &&
      (declaration.constraint ??
        ts.getEffectiveConstraintOfTypeParameter(declaration));
    if (!constraint) return CLEAN;
    resolvingParameters.add(symbol);
    try {
      return type(constraint, { ...context, at: undefined });
    } finally {
      resolvingParameters.delete(symbol);
    }
  }
  /** A type the checker derived from untainted inputs. */
  function fromType(target: ts.Type): Judged {
    const primitive =
      ts.TypeFlags.Any |
      ts.TypeFlags.Unknown |
      ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.Void |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Null |
      ts.TypeFlags.Never |
      ts.TypeFlags.EnumLike |
      ts.TypeFlags.NonPrimitive |
      ts.TypeFlags.TypeParameter |
      ts.TypeFlags.Index;
    if (target.flags & primitive) return CLEAN;
    if (target.isUnionOrIntersection())
      return join(target.types.map((part) => fromType(part)));
    if (target.flags & ts.TypeFlags.Object) {
      if (checker.isTupleType(target))
        return {
          k: "tuple",
          elements: checker
            .getTypeArguments(target as ts.TypeReference)
            .map((part) => fromType(part)),
        };
      const symbol = target.getSymbol();
      const objectFlags = (target as ts.ObjectType).objectFlags;
      if (
        symbol &&
        symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface) &&
        !(objectFlags & ts.ObjectFlags.Anonymous)
      ) {
        const args =
          objectFlags & ts.ObjectFlags.Reference
            ? checker.getTypeArguments(target as ts.TypeReference)
            : [];
        const env = new Map<ts.Symbol, () => Judged>();
        typeParametersOf(symbol).forEach((parameter, index) => {
          const parameterSymbol = symbolAt(parameter.name);
          const argument = args[index];
          if (parameterSymbol)
            env.set(
              parameterSymbol,
              lazy(() => (argument ? fromType(argument) : CLEAN)),
            );
        });
        return { k: "object", symbol, env };
      }
      if (symbol && symbol.flags & ts.SymbolFlags.Class)
        return { k: "static", symbol };
      return { k: "checked", type: target };
    }
    return { k: "checked", type: target };
  }
  function thisOf(node: ts.Node): Judged {
    for (let at = node.parent; at; at = at.parent) {
      if (ts.isClassLike(at) || ts.isInterfaceDeclaration(at)) {
        const symbol = at.name ? symbolAt(at.name) : undefined;
        return symbol
          ? { k: "object", symbol, env: EMPTY }
          : unhandled(DENY_TYPE, "type", "this of an anonymous class");
      }
      if (ts.isTypeLiteralNode(at))
        return { k: "literal", node: at, env: EMPTY };
    }
    return unhandled(DENY_TYPE, "type", "this outside a class");
  }

  // ---------------- expressions ----------------
  const expressions = new Map<ts.Node, Judged>();
  const inProgress = new Set<ts.Node>();
  function expression(node: ts.Expression | ts.QualifiedName): Judged {
    const known = expressions.get(node);
    if (known) return known;
    if (inProgress.has(node)) {
      cycles++;
      return failed("an expression that depends on itself");
    }
    inProgress.add(node);
    const before = cycles;
    try {
      const handler = EXPRESSIONS.get(node.kind);
      const judged = handler
        ? handler(node, undefined)
        : unhandled(DENY_EXPRESSION, "expression", kindName(node.kind));
      if (cycles === before) expressions.set(node, judged);
      return judged;
    } finally {
      inProgress.delete(node);
    }
  }
  const clean = () => CLEAN;
  const through = (node: ts.Node) =>
    expression(
      (node as ts.Expression & { expression: ts.Expression }).expression,
    );
  const EXPRESSIONS = table<ts.Node, undefined>({
    Identifier: (node) => identifier(node as ts.Identifier),
    ThisKeyword: (node) => thisKeyword(node),
    SuperKeyword: (node) => superKeyword(node),
    QualifiedName: (node) => {
      const name = node as ts.QualifiedName;
      return member(expression(name.left), name.right, name.right.text, name);
    },
    PropertyAccessExpression: (node) => {
      const access = node as ts.PropertyAccessExpression;
      return member(
        expression(access.expression),
        access.name,
        access.name.text,
        access,
      );
    },
    ElementAccessExpression: (node) =>
      elementAccess(node as ts.ElementAccessExpression),
    CallExpression: (node) => callExpression(node as ts.CallExpression),
    NewExpression: (node) => newExpression(node as ts.NewExpression),
    TaggedTemplateExpression: (node) => {
      const tagged = node as ts.TaggedTemplateExpression;
      return invoke(expression(tagged.tag), tagged, false);
    },
    AwaitExpression: (node) => awaited(through(node)),
    ParenthesizedExpression: through,
    NonNullExpression: through,
    // The asserted type replaces the expression's: it alone decides.
    AsExpression: (node) => asserted(node as ts.AsExpression),
    TypeAssertionExpression: (node) => asserted(node as ts.TypeAssertion),
    // `e satisfies T` has e's own type.
    SatisfiesExpression: through,
    ConditionalExpression: (node) => {
      const conditional = node as ts.ConditionalExpression;
      return join([
        expression(conditional.whenTrue),
        expression(conditional.whenFalse),
      ]);
    },
    BinaryExpression: (node) => binary(node as ts.BinaryExpression),
    ArrayLiteralExpression: (node) =>
      arrayLiteral(node as ts.ArrayLiteralExpression),
    ObjectLiteralExpression: (node) => ({
      k: "objectLiteral",
      node: node as ts.ObjectLiteralExpression,
    }),
    FunctionExpression: (node) => ({
      k: "function",
      decls: [node as ts.FunctionExpression],
      env: EMPTY,
    }),
    ArrowFunction: (node) => ({
      k: "function",
      decls: [node as ts.ArrowFunction],
      env: EMPTY,
    }),
    ClassExpression: (node) => {
      const symbol = symbolAt(node) ?? (node as { symbol?: ts.Symbol }).symbol;
      return symbol
        ? { k: "static", symbol }
        : unhandled(DENY_EXPRESSION, "expression", "anonymous class");
    },
    StringLiteral: clean,
    NumericLiteral: clean,
    BigIntLiteral: clean,
    NoSubstitutionTemplateLiteral: clean,
    TemplateExpression: clean,
    RegularExpressionLiteral: clean,
    TrueKeyword: clean,
    FalseKeyword: clean,
    NullKeyword: clean,
    // An operator's result type follows its operand's (`-x` is `bigint` or
    // `number`): only a plain clean operand keeps.
    PrefixUnaryExpression: (node) =>
      operands([(node as ts.PrefixUnaryExpression).operand]),
    PostfixUnaryExpression: (node) =>
      operands([(node as ts.PostfixUnaryExpression).operand]),
    TypeOfExpression: clean,
    VoidExpression: clean,
    DeleteExpression: clean,
    MetaProperty: clean,
  });
  HANDLED.expressions = [...EXPRESSIONS.keys()].map(kindName);
  function identifier(node: ts.Identifier): Judged {
    const symbol0 = symbolAt(node);
    if (!symbol0 || unknownSymbol(symbol0))
      return unread(node.text)
        ? failed(`name ${node.text} declared in the failed file`)
        : CLEAN;
    if (seed(symbol0)) return failed(`binding ${symbol0.name}`);
    const symbol = resolved(symbol0);
    if (!symbol.declarations?.length)
      return unread(node.text)
        ? failed(`name ${node.text} declared in the failed file`)
        : CLEAN;
    return valueOf(symbol, EMPTY, undefined, node);
  }
  function valueOf(
    symbol: ts.Symbol,
    env: Env,
    self: Judged | undefined,
    at: ts.Node | undefined,
  ): Judged {
    if (symbol.flags & ts.SymbolFlags.Class) return { k: "static", symbol };
    if (symbol.flags & ts.SymbolFlags.Enum) return CLEAN;
    if (symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Method)) {
      const decls = (symbol.declarations ?? []).filter(
        ts.isFunctionLike,
      ) as ts.SignatureDeclaration[];
      if (decls.length) return { k: "function", decls, env, self };
    }
    if (
      symbol.flags & ts.SymbolFlags.Module &&
      !(symbol.flags & ts.SymbolFlags.Variable)
    )
      return { k: "static", symbol };
    const declared = symbol.valueDeclaration ?? symbol.declarations?.[0];
    return declared
      ? declaration(declared, env, self, at)
      : unhandled(DENY_DECLARATION, "declaration", "none");
  }
  function asserted(node: ts.AsExpression | ts.TypeAssertion): Judged {
    if (
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      node.type.typeName.text === "const"
    )
      return expression(node.expression);
    return type(node.type, { env: EMPTY, visiting: NONE, at: node });
  }
  /** An operator's result: clean only when every operand is plainly clean. */
  function operands(nodes: readonly ts.Expression[]): Judged {
    const judged = join(nodes.map((node) => expression(node)));
    return judged.k === "clean"
      ? CLEAN
      : judged.k === "failed"
        ? judged
        : failed("an operator over an operand that is not plainly clean");
  }
  function binary(node: ts.BinaryExpression): Judged {
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.BarBarToken:
      case ts.SyntaxKind.QuestionQuestionToken:
      case ts.SyntaxKind.AmpersandAmpersandToken:
      case ts.SyntaxKind.BarBarEqualsToken:
      case ts.SyntaxKind.QuestionQuestionEqualsToken:
      case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
        return join([expression(node.left), expression(node.right)]);
      case ts.SyntaxKind.CommaToken:
      case ts.SyntaxKind.EqualsToken:
        return expression(node.right);
      default:
        // Arithmetic, comparison, `instanceof`, `in`, bitwise and their
        // assignments: a primitive whose type follows the operands' (`any +
        // 1` is `any`), so only plain clean operands keep.
        return operands([node.left, node.right]);
    }
  }
  function arrayLiteral(node: ts.ArrayLiteralExpression): Judged {
    const elements = node.elements.map((element) =>
      ts.isSpreadElement(element)
        ? elementOf(expression(element.expression))
        : ts.isOmittedExpression(element)
          ? CLEAN
          : expression(element),
    );
    let tuple = false;
    try {
      tuple = checker.isTupleType(typeAt(node));
    } catch {
      tuple = false;
    }
    return tuple
      ? { k: "tuple", elements }
      : container("Array", () => join(elements));
  }
  function thisKeyword(node: ts.Node): Judged {
    for (let at = node.parent; at; at = at.parent) {
      if (ts.isArrowFunction(at)) continue;
      if (ts.isFunctionDeclaration(at) || ts.isFunctionExpression(at)) {
        const first = at.parameters[0];
        if (
          first &&
          ts.isIdentifier(first.name) &&
          first.name.text === "this" &&
          first.type
        )
          return type(first.type, { env: EMPTY, visiting: NONE });
        return unhandled(DENY_EXPRESSION, "expression", "this in a function");
      }
      if (
        ts.isMethodDeclaration(at) ||
        ts.isConstructorDeclaration(at) ||
        ts.isGetAccessorDeclaration(at) ||
        ts.isSetAccessorDeclaration(at) ||
        ts.isPropertyDeclaration(at) ||
        ts.isClassStaticBlockDeclaration(at)
      ) {
        const owner = at.parent;
        if (ts.isObjectLiteralExpression(owner))
          return { k: "objectLiteral", node: owner };
        const symbol =
          ts.isClassLike(owner) && owner.name
            ? symbolAt(owner.name)
            : (owner as { symbol?: ts.Symbol }).symbol;
        if (!symbol)
          return unhandled(
            DENY_EXPRESSION,
            "expression",
            "this of an anonymous class",
          );
        const isStatic =
          ts.isClassStaticBlockDeclaration(at) ||
          (ts.canHaveModifiers(at) &&
            !!ts
              .getModifiers(at)
              ?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
              ));
        return isStatic
          ? { k: "static", symbol }
          : { k: "object", symbol, env: EMPTY };
      }
      if (ts.isSourceFile(at) || ts.isModuleDeclaration(at)) return CLEAN;
    }
    return CLEAN;
  }
  function superKeyword(node: ts.Node): Judged {
    const self = thisKeyword(node);
    for (let at = node.parent; at; at = at.parent)
      if (ts.isClassLike(at)) {
        const heritage = at.heritageClauses?.find(
          (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
        )?.types[0];
        if (!heritage)
          return unhandled(
            DENY_EXPRESSION,
            "expression",
            "super without a base",
          );
        const base0 = symbolAt(heritage.expression);
        if (!base0) return CLEAN;
        if (seed(base0)) return failed(`binding ${base0.name}`);
        const base = resolved(base0);
        if (self.k === "static") return { k: "static", symbol: base };
        return {
          k: "object",
          symbol: base,
          env: bind(
            typeParametersOf(base),
            heritage.typeArguments,
            { env: EMPTY, visiting: NONE, self },
            EMPTY,
          ),
          self,
        };
      }
    return unhandled(DENY_EXPRESSION, "expression", "super outside a class");
  }
  function elementAccess(node: ts.ElementAccessExpression): Judged {
    const object = expression(node.expression);
    const key = node.argumentExpression;
    // A computed key keeps only when the key itself is plainly clean.
    if (
      !ts.isStringLiteralLike(key) &&
      !ts.isNumericLiteral(key) &&
      expression(key).k !== "clean"
    )
      return failed("element access with a key that is not plainly clean");
    if (!ts.isStringLiteralLike(key) && !ts.isNumericLiteral(key))
      return object.k === "clean" || object.k === "checked"
        ? object.k === "clean"
          ? CLEAN
          : fromType(typeAt(node))
        : failed("element access with a computed key");
    if (ts.isNumericLiteral(key) && object.k === "tuple")
      return tupleElement(object, Number(key.text));
    const property = symbolAt(key);
    if (property?.declarations?.length)
      return member(object, key, key.text, node, property);
    // No property of that name: the index signature that answers it.
    let declarations: ts.Declaration[] = [];
    try {
      const infos = checker.getIndexInfosOfType(typeAt(node.expression));
      const wanted = ts.isNumericLiteral(key)
        ? [ts.TypeFlags.NumberLike, ts.TypeFlags.StringLike]
        : [ts.TypeFlags.StringLike];
      for (const flags of wanted) {
        const info = infos.find((candidate) => candidate.keyType.flags & flags);
        if (info?.declaration) {
          declarations = [info.declaration];
          break;
        }
      }
    } catch {
      declarations = [];
    }
    return memberOf(object, declarations, key.text, node);
  }
  function tupleElement(tuple: Judged & { k: "tuple" }, index: number): Judged {
    return (
      tuple.elements[index] ??
      tuple.rest ??
      failed(`no element ${index} of the tuple`)
    );
  }
  function member(
    object: Judged,
    name: ts.Node,
    text: string,
    at: ts.Node,
    known?: ts.Symbol,
  ): Judged {
    if (object.k === "failed" || object.k === "clean") return object;
    const symbol = known ?? symbolAt(name);
    return memberOf(object, symbol?.declarations ?? [], text, at);
  }
  /** The owner (class, interface or type literal) a member is declared in. */
  function ownerOf(declaration: ts.Node): ts.Symbol | undefined {
    const parent = declaration.parent;
    if (!parent) return undefined;
    if (
      (ts.isClassLike(parent) || ts.isInterfaceDeclaration(parent)) &&
      parent.name
    )
      return symbolAt(parent.name);
    return (parent as { symbol?: ts.Symbol }).symbol;
  }
  /** The environment of a base `owner` reached from `object` through heritage. */
  function envFor(
    object: Judged & { k: "object" },
    owner: ts.Symbol | undefined,
  ): Env | undefined {
    if (!owner) return undefined;
    if (owner === object.symbol) return object.env;
    const self = object.self ?? object;
    const seen = new Set<ts.Symbol>([object.symbol]);
    const queue: [ts.Symbol, Env][] = [[object.symbol, object.env]];
    while (queue.length) {
      const [symbol, env] = queue.shift()!;
      for (const declaration of symbol.declarations ?? []) {
        if (
          !ts.isClassLike(declaration) &&
          !ts.isInterfaceDeclaration(declaration)
        )
          continue;
        for (const clause of declaration.heritageClauses ?? [])
          for (const heritage of clause.types) {
            const base0 = symbolAt(heritage.expression);
            if (!base0 || seed(base0)) continue;
            const base = resolved(base0);
            if (seen.has(base)) continue;
            seen.add(base);
            const baseEnv = bind(
              typeParametersOf(base),
              heritage.typeArguments,
              { env, self, visiting: NONE },
              EMPTY,
            );
            if (base === owner) return baseEnv;
            queue.push([base, baseEnv]);
          }
      }
    }
    return undefined;
  }
  function memberOf(
    object: Judged,
    declarations: readonly ts.Declaration[],
    name: string,
    at: ts.Node,
  ): Judged {
    switch (object.k) {
      case "failed":
      case "clean":
        return object;
      case "opaque":
        return unhandled(DENY_TYPE, "type", `member of ${object.why}`);
      case "checked": {
        const property = checker.getPropertyOfType(object.type, name);
        return property
          ? fromType(checker.getTypeOfSymbol(property))
          : failed(`no member ${name}`);
      }
      case "union": {
        const parts: Judged[] = [];
        for (const part of object.parts) {
          const own = declarations.filter((declaration) =>
            belongs(part, declaration),
          );
          if (
            part.k === "checked" ||
            part.k === "function" ||
            part.k === "opaque" ||
            part.k === "tuple"
          )
            parts.push(memberOf(part, own, name, at));
          else if (own.length) parts.push(memberOf(part, own, name, at));
        }
        return parts.length ? join(parts) : failed(`no member ${name}`);
      }
      case "tuple":
        if (/^\d+$/.test(name)) return tupleElement(object, Number(name));
        return memberOf(
          container("Array", () =>
            join([...object.elements, object.rest ?? CLEAN]),
          ),
          declarations,
          name,
          at,
        );
      case "function":
        if (name === "call" || name === "apply" || name === "bind")
          return { ...object, relay: name };
        if (FUNCTION_MEMBERS.has(name)) return CLEAN;
        return declarations[0] && declarations.length === 1
          ? declaration(declarations[0], EMPTY, undefined, at)
          : failed(`no member ${name}`);
      case "static": {
        if (name === "prototype")
          return { k: "object", symbol: object.symbol, env: EMPTY };
        if (!declarations.length) return failed(`no member ${name}`);
        return memberValue(declarations, EMPTY, object, at);
      }
      case "objectLiteral": {
        const own = declarations.filter(
          (declaration) => declaration.parent === object.node,
        );
        return own.length
          ? memberValue(own, EMPTY, object, at)
          : failed(`no member ${name} of the object literal`);
      }
      case "literal": {
        const own = declarations.filter(
          (declaration) => declaration.parent === object.node,
        );
        return own.length
          ? memberValue(own, object.env, object.self ?? object, at)
          : failed(`no member ${name} of the type literal`);
      }
      case "object": {
        if (!declarations.length)
          return failed(`no member ${name} of ${object.symbol.name}`);
        const owners = new Set(declarations.map(ownerOf));
        const own = owners.size === 1 && owners.has(object.symbol);
        // O1: through a member set that reaches a failed file, only members
        // declared directly in the receiver's own declarations stand.
        if (!own && input.memberSetTainted(object.symbol))
          return failed(
            `inherited member ${name} of ${object.symbol.name}, whose member set reaches the failed file`,
          );
        const owner = [...owners][0];
        const env = owners.size === 1 ? envFor(object, owner) : undefined;
        if (!env)
          return failed(
            `member ${name} of ${object.symbol.name} whose owner is not reached`,
          );
        return memberValue(declarations, env, object.self ?? object, at);
      }
    }
  }
  function belongs(part: Judged, declaration: ts.Declaration): boolean {
    switch (part.k) {
      case "object":
        return !!envFor(part, ownerOf(declaration));
      case "literal":
      case "objectLiteral":
        return declaration.parent === part.node;
      case "static":
        return ownerOf(declaration) === part.symbol;
      default:
        return false;
    }
  }
  function memberValue(
    declarations: readonly ts.Declaration[],
    env: Env,
    self: Judged,
    at: ts.Node,
  ): Judged {
    const functions = declarations.filter(
      (declaration) =>
        ts.isMethodDeclaration(declaration) ||
        ts.isMethodSignature(declaration) ||
        ts.isFunctionDeclaration(declaration),
    ) as ts.SignatureDeclaration[];
    if (functions.length && functions.length === declarations.length)
      return { k: "function", decls: functions, env, self };
    return declarations[0]
      ? declaration(declarations[0], env, self, at)
      : failed("no member declaration");
  }

  // ---------------- declarations ----------------
  interface DeclarationContext {
    env: Env;
    self?: Judged | undefined;
    at?: ts.Node | undefined;
  }
  function declaration(
    node: ts.Node,
    env: Env,
    self: Judged | undefined,
    at?: ts.Node,
  ): Judged {
    const handler = DECLARATIONS.get(node.kind);
    return handler
      ? handler(node, { env, self, at })
      : unhandled(DENY_DECLARATION, "declaration", kindName(node.kind));
  }
  const declaredType = (
    node: ts.Node & { type?: ts.TypeNode | undefined },
    context: DeclarationContext,
  ): Judged | undefined => {
    const annotation = node.type ?? ts.getJSDocType(node);
    return annotation
      ? type(annotation, {
          env: context.env,
          self: context.self,
          visiting: NONE,
          at: context.at,
        })
      : undefined;
  };
  const functionValue = (
    node: ts.Node,
    context: DeclarationContext,
  ): Judged => {
    const symbol =
      (node as { symbol?: ts.Symbol }).symbol ??
      ((node as unknown as { name?: ts.Node }).name &&
        symbolAt((node as unknown as { name: ts.Node }).name));
    const decls = (symbol?.declarations?.filter(ts.isFunctionLike) ?? [
      node,
    ]) as ts.SignatureDeclaration[];
    return { k: "function", decls, env: context.env, self: context.self };
  };
  const DECLARATIONS = table<ts.Node, DeclarationContext>({
    VariableDeclaration: (node, context) => {
      const variable = node as ts.VariableDeclaration;
      const declared = declaredType(variable, context);
      if (declared) return declared;
      if (variable.initializer) return expression(variable.initializer);
      const statement = variable.parent?.parent;
      if (statement && ts.isForOfStatement(statement))
        return elementOf(expression(statement.expression));
      if (statement && ts.isForInStatement(statement)) return CLEAN;
      if (ts.isCatchClause(variable.parent)) return CLEAN;
      return unhandled(
        DENY_DECLARATION,
        "declaration",
        "VariableDeclaration without a type or initialiser",
      );
    },
    Parameter: (node, context) => {
      const parameter = node as ts.ParameterDeclaration;
      const declared = declaredType(parameter, context);
      if (declared) return declared;
      if (parameter.initializer) return expression(parameter.initializer);
      if (parameter.dotDotDotToken) return CLEAN;
      return contextual(parameter);
    },
    BindingElement: (node) => bindingElement(node as ts.BindingElement),
    PropertyDeclaration: (node, context) => {
      const property = node as ts.PropertyDeclaration;
      return (
        declaredType(property, context) ??
        (property.initializer ? expression(property.initializer) : CLEAN)
      );
    },
    PropertySignature: (node, context) =>
      declaredType(node as ts.PropertySignature, context) ?? CLEAN,
    PropertyAssignment: (node) =>
      expression((node as ts.PropertyAssignment).initializer),
    ShorthandPropertyAssignment: (node) => {
      const symbol = checker.getShorthandAssignmentValueSymbol(node);
      return symbol ? valueOf(resolved(symbol), EMPTY, undefined, node) : CLEAN;
    },
    MethodDeclaration: functionValue,
    MethodSignature: functionValue,
    FunctionDeclaration: functionValue,
    FunctionExpression: functionValue,
    ArrowFunction: functionValue,
    GetAccessor: (node, context) => {
      const accessor = node as ts.GetAccessorDeclaration;
      return declaredType(accessor, context) ?? returnsOf(accessor);
    },
    IndexSignature: (node, context) =>
      declaredType(node as ts.IndexSignatureDeclaration, context) ?? CLEAN,
    EnumMember: () => CLEAN,
    EnumDeclaration: () => CLEAN,
    ClassDeclaration: (node) => {
      const symbol = (node as { symbol?: ts.Symbol }).symbol;
      return symbol ? { k: "static", symbol } : CLEAN;
    },
    ClassExpression: (node) => {
      const symbol = (node as { symbol?: ts.Symbol }).symbol;
      return symbol ? { k: "static", symbol } : CLEAN;
    },
    ModuleDeclaration: (node) => {
      const symbol = (node as { symbol?: ts.Symbol }).symbol;
      return symbol ? { k: "static", symbol } : CLEAN;
    },
    SourceFile: (node) => {
      const symbol = (node as { symbol?: ts.Symbol }).symbol;
      return symbol ? { k: "static", symbol } : CLEAN;
    },
  });
  HANDLED.declarations = [...DECLARATIONS.keys()].map(kindName);
  function bindingElement(node: ts.BindingElement): Judged {
    const pattern = node.parent;
    const holder = pattern.parent;
    const source = ts.isBindingElement(holder)
      ? bindingElement(holder)
      : declaration(holder, EMPTY, undefined);
    let value: Judged;
    if (ts.isObjectBindingPattern(pattern)) {
      if (node.dotDotDotToken)
        return source.k === "clean" ? CLEAN : failed("an object rest pattern");
      const key = node.propertyName ?? node.name;
      if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key))
        return failed("a computed destructuring key");
      let declarations: readonly ts.Declaration[] = [];
      try {
        declarations =
          checker.getPropertyOfType(typeAt(pattern), key.text)?.declarations ??
          [];
      } catch {
        declarations = [];
      }
      value = memberOf(source, declarations, key.text, node);
    } else {
      const index = pattern.elements.indexOf(node);
      value = node.dotDotDotToken
        ? source
        : source.k === "tuple"
          ? tupleElement(source, index)
          : elementOf(source);
    }
    return node.initializer
      ? join([value, expression(node.initializer)])
      : value;
  }

  // ---------------- contextual parameters ----------------
  function contextual(parameter: ts.ParameterDeclaration): Judged {
    const fn = parameter.parent;
    const index = fn.parameters.indexOf(parameter);
    if (!ts.isFunctionExpression(fn) && !ts.isArrowFunction(fn))
      // A declared function's or class method's own parameters are not
      // contextually typed (implicitly any); an object literal's method's are.
      return ts.isFunctionDeclaration(fn) ||
        (ts.isMethodDeclaration(fn) &&
          !ts.isObjectLiteralExpression(fn.parent)) ||
        ts.isConstructorDeclaration(fn) ||
        ts.isAccessor(fn)
        ? CLEAN
        : unhandled(DENY_CONTEXTUAL, "contextual", kindName(fn.kind));
    let holder: ts.Node = fn.parent;
    let child: ts.Node = fn;
    while (ts.isParenthesizedExpression(holder)) {
      child = holder;
      holder = holder.parent;
    }
    const handler = CONTEXTS.get(holder.kind);
    return handler
      ? handler(holder, { index, child })
      : unhandled(DENY_CONTEXTUAL, "contextual", kindName(holder.kind));
  }
  interface ContextualContext {
    index: number;
    child?: ts.Node | undefined;
  }
  const callContext = (node: ts.Node, context: ContextualContext): Judged => {
    const call = node as ts.CallExpression | ts.NewExpression;
    const argumentIndex = (
      (call.arguments ?? []) as readonly ts.Node[]
    ).indexOf(context.child as ts.Node);
    if (argumentIndex < 0)
      return unhandled(DENY_CONTEXTUAL, "contextual", "callee position");
    const parameterType = parameterTypeAt(call, argumentIndex);
    return parameterOf(parameterType, context.index);
  };
  const CONTEXTS = table<ts.Node, ContextualContext>({
    CallExpression: callContext,
    NewExpression: callContext,
    VariableDeclaration: (node, context) => {
      const variable = node as ts.VariableDeclaration;
      if (!variable.type) return CLEAN; // no contextual type: implicitly any
      return parameterOf(
        type(variable.type, { env: EMPTY, visiting: NONE }),
        context.index,
      );
    },
    PropertyDeclaration: (node, context) => {
      const property = node as ts.PropertyDeclaration;
      if (!property.type) return CLEAN;
      return parameterOf(
        type(property.type, { env: EMPTY, visiting: NONE }),
        context.index,
      );
    },
    ExpressionStatement: () => CLEAN,
  });
  HANDLED.contextual = [...CONTEXTS.keys()].map(kindName);
  function parameterOf(fn: Judged, index: number): Judged {
    switch (fn.k) {
      case "failed":
      case "clean":
        return fn;
      case "function": {
        const signature = fn.decls[0];
        if (!signature)
          return unhandled(DENY_CONTEXTUAL, "contextual", "no signature");
        const parameter =
          signature.parameters[index] ??
          (signature.parameters.at(-1)?.dotDotDotToken
            ? signature.parameters.at(-1)
            : undefined);
        if (!parameter?.type) return CLEAN;
        const judged = type(parameter.type, {
          env: fn.env,
          self: fn.self,
          visiting: NONE,
        });
        return parameter.dotDotDotToken ? elementOf(judged) : judged;
      }
      case "union": {
        const callable = fn.parts.filter(
          (part) =>
            part.k === "function" ||
            part.k === "failed" ||
            ((part.k === "object" || part.k === "literal") &&
              !!callSignatures(part).length),
        );
        return callable.length
          ? join(callable.map((part) => parameterOf(part, index)))
          : unhandled(DENY_CONTEXTUAL, "contextual", "no function type");
      }
      case "object":
      case "literal": {
        const signatures = callSignatures(fn);
        return signatures.length
          ? parameterOf(
              {
                k: "function",
                decls: signatures,
                env: fn.env,
                self: fn,
              },
              index,
            )
          : unhandled(DENY_CONTEXTUAL, "contextual", `object ${fn.k}`);
      }
      default:
        return unhandled(DENY_CONTEXTUAL, "contextual", fn.k);
    }
  }
  function callSignatures(
    judged: Judged & { k: "object" | "literal" },
  ): ts.SignatureDeclaration[] {
    if (judged.k === "literal")
      return judged.node.members.filter(ts.isCallSignatureDeclaration);
    return (judged.symbol.declarations ?? []).flatMap((declaration) =>
      ts.isInterfaceDeclaration(declaration)
        ? declaration.members.filter(ts.isCallSignatureDeclaration)
        : [],
    );
  }

  // ---------------- calls ----------------
  interface Prepared {
    decl: ts.SignatureDeclaration;
    env: Env;
    self?: Judged | undefined;
  }
  const prepared = new Map<ts.Node, Prepared | Judged>();
  function callExpression(node: ts.CallExpression): Judged {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier && input.failedModule(specifier))
        return failed("a dynamic import of the failed file");
      return fromType(typeAt(node));
    }
    return invoke(expression(node.expression), node, false);
  }
  function newExpression(node: ts.NewExpression): Judged {
    return invoke(expression(node.expression), node, true);
  }
  type Call =
    | ts.CallExpression
    | ts.NewExpression
    | ts.TaggedTemplateExpression;
  const argumentsOf = (call: Call): readonly ts.Expression[] =>
    ts.isTaggedTemplateExpression(call) ? [] : (call.arguments ?? []);
  function invoke(callee: Judged, call: Call, construct: boolean): Judged {
    const prepared = prepare(callee, call, construct);
    if (!("decl" in prepared)) return prepared;
    return returnOf(prepared, call, construct);
  }
  /** The signature a call takes and its environment, or the call's judgement. */
  function prepare(
    callee: Judged,
    call: Call,
    construct: boolean,
  ): Prepared | Judged {
    const known = prepared.get(call);
    if (known) return known;
    const before = cycles;
    const result = prepareUncached(callee, call, construct);
    if (cycles === before) prepared.set(call, result);
    return result;
  }
  function prepareUncached(
    callee: Judged,
    call: Call,
    construct: boolean,
  ): Prepared | Judged {
    switch (callee.k) {
      case "failed":
      case "clean":
        return callee;
      case "checked": {
        try {
          const signature = checker.getResolvedSignature(
            call as ts.CallLikeExpression,
          );
          return signature
            ? fromType(checker.getReturnTypeOfSignature(signature))
            : unhandled(DENY_CALL, "call", "checked type without a signature");
        } catch {
          return unhandled(DENY_CALL, "call", "checked type");
        }
      }
      case "function":
        return chooseSignature(callee, call, callee.decls);
      case "static": {
        if (!construct || !(callee.symbol.flags & ts.SymbolFlags.Class))
          return unhandled(DENY_CALL, "call", "a class or module called");
        return newClass(callee.symbol, call as ts.NewExpression);
      }
      case "object":
      case "literal": {
        const signatures = construct
          ? constructSignatures(callee)
          : callSignatures(callee);
        if (!signatures.length)
          return unhandled(DENY_CALL, "call", `object ${callee.k}`);
        return chooseSignature(
          {
            k: "function",
            decls: signatures,
            env: callee.env,
            self: callee,
          },
          call,
          signatures,
        );
      }
      case "union":
        return join(callee.parts.map((part) => invoke(part, call, construct)));
      default:
        return unhandled(DENY_CALL, "call", callee.k);
    }
  }
  function constructSignatures(
    judged: Judged & { k: "object" | "literal" },
  ): ts.SignatureDeclaration[] {
    if (judged.k === "literal")
      return judged.node.members.filter(ts.isConstructSignatureDeclaration);
    return (judged.symbol.declarations ?? []).flatMap((declaration) =>
      ts.isInterfaceDeclaration(declaration)
        ? declaration.members.filter(ts.isConstructSignatureDeclaration)
        : [],
    );
  }
  /** Overloads: implementation signatures do not count when overloads exist. */
  const overloadsOf = (
    decls: readonly ts.SignatureDeclaration[],
  ): readonly ts.SignatureDeclaration[] =>
    decls.length > 1
      ? decls.filter((decl) => !(decl as { body?: ts.Node }).body)
      : decls;
  function chooseSignature(
    fn: Judged & { k: "function" },
    call: Call,
    decls: readonly ts.SignatureDeclaration[],
  ): Prepared | Judged {
    if (fn.relay === "bind") return { ...fn, relay: undefined };
    const signatures = overloadsOf(decls);
    const args = argumentsOf(call);
    if (signatures.length > 1) {
      const argumentTaint =
        fn.relay === undefined &&
        args.some((argument) => tainted(expression(argument)));
      const parameterTaint =
        FAILED_PARAMETER_OVERLOADS &&
        signatures.some(
          (signature) => signatureDependsOnFailed(signature).length > 0,
        );
      if (argumentTaint || parameterTaint || fn.relay) {
        const why = parameterTaint
          ? "the result of an overloaded callee whose parameter types depend on the failed file"
          : fn.relay
            ? `the result of ${fn.relay} on an overloaded function`
            : "the result of an overloaded callee with a tainted argument";
        const shared = SAME_CLASS_OVERLOADS
          ? sharedClass(signatures)
          : undefined;
        return shared
          ? { k: "object", symbol: shared, env: failedAll(shared, why) }
          : failed(why);
      }
      let chosen: ts.Declaration | undefined;
      try {
        chosen = checker.getResolvedSignature(
          call as ts.CallLikeExpression,
        )?.declaration;
      } catch {
        chosen = undefined;
      }
      const decl = signatures.find((signature) => signature === chosen);
      if (!decl) return failed("an overload the compiler did not choose");
      return { decl, env: fn.env, self: fn.self };
    }
    const decl = signatures[0];
    if (!decl) return unhandled(DENY_CALL, "call", "no signature");
    return { decl, env: fn.env, self: fn.self };
  }
  /** R-1: every overload's declared return type is one class or interface. */
  function sharedClass(
    signatures: readonly ts.SignatureDeclaration[],
  ): ts.Symbol | undefined {
    let shared: ts.Symbol | undefined;
    for (const signature of signatures) {
      const returned = ts.isConstructorDeclaration(signature)
        ? signature.parent.name
        : signature.type && ts.isTypeReferenceNode(signature.type)
          ? signature.type.typeName
          : undefined;
      const symbol0 =
        returned &&
        symbolAt(ts.isQualifiedName(returned) ? returned.right : returned);
      if (!symbol0 || seed(symbol0)) return undefined;
      const symbol = resolved(symbol0);
      if (
        !(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) ||
        (shared && shared !== symbol)
      )
        return undefined;
      shared = symbol;
    }
    return shared;
  }
  function newClass(
    symbol: ts.Symbol,
    call: ts.NewExpression,
  ): Prepared | Judged {
    const declarationOf = symbol.declarations?.find(ts.isClassLike);
    if (!declarationOf)
      return unhandled(DENY_CALL, "call", "a class without a declaration");
    const constructors = declarationOf.members.filter(
      ts.isConstructorDeclaration,
    );
    const parameters = typeParametersOf(symbol);
    const instance = (env: Env): Judged => ({ k: "object", symbol, env });
    if (!constructors.length)
      return instance(
        bind(
          parameters,
          call.typeArguments,
          { env: EMPTY, visiting: NONE },
          EMPTY,
        ),
      );
    const chosen = chooseSignature(
      { k: "function", decls: constructors, env: EMPTY },
      call,
      constructors,
    );
    if (!("decl" in chosen)) return chosen;
    const env = new Map<ts.Symbol, () => Judged>();
    parameters.forEach((parameter, index) => {
      const parameterSymbol = symbolAt(parameter.name);
      if (!parameterSymbol) return;
      const explicit = call.typeArguments?.[index];
      env.set(
        parameterSymbol,
        lazy(() =>
          explicit
            ? type(explicit, { env: EMPTY, visiting: NONE })
            : inferred(parameter, chosen.decl, argumentsOf(call), env),
        ),
      );
    });
    return instance(env);
  }
  function returnOf(
    prepared: Prepared,
    call: Call,
    construct: boolean,
  ): Judged {
    const { decl, self } = prepared;
    const args = argumentsOf(call);
    const env = new Map(prepared.env);
    const explicit = call.typeArguments;
    (decl.typeParameters ?? []).forEach((parameter, index) => {
      const symbol = symbolAt(parameter.name);
      if (!symbol) return;
      const given = explicit?.[index];
      env.set(
        symbol,
        lazy(() =>
          given
            ? type(given, { env: EMPTY, visiting: NONE })
            : inferred(parameter, decl, args, env),
        ),
      );
    });
    const declaredReturn = decl.type ?? ts.getJSDocReturnType(decl);
    if (declaredReturn)
      return type(declaredReturn, { env, self, visiting: NONE, at: call });
    if (construct && ts.isConstructSignatureDeclaration(decl)) return CLEAN;
    if ((decl as { body?: ts.Node }).body) {
      if (
        decl.typeParameters?.length &&
        args.some((argument) => tainted(expression(argument)))
      )
        return failed(
          "a generic function without a declared return type, with a tainted argument",
        );
      return returnsOf(decl);
    }
    return CLEAN;
  }
  /** A function's value when called: its returned expressions, never other statements. */
  function returnsOf(decl: ts.SignatureDeclaration): Judged {
    const body = (decl as { body?: ts.Node }).body;
    if (!body) return CLEAN;
    if ((decl as { asteriskToken?: ts.Node }).asteriskToken)
      return unhandled(DENY_CALL, "call", "a generator");
    const values: Judged[] = [];
    if (!ts.isBlock(body)) values.push(expression(body as ts.Expression));
    else {
      const visit = (node: ts.Node): void => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression)
          values.push(expression(node.expression));
        ts.forEachChild(node, visit);
      };
      visit(body);
    }
    const value = join(values);
    const isAsync =
      (ts.getCombinedModifierFlags(decl as ts.Declaration) &
        ts.ModifierFlags.Async) !==
      0;
    return isAsync ? container("Promise", () => awaited(value)) : value;
  }
  /** A type argument the call does not give: from the arguments (O1). */
  function inferred(
    parameter: ts.TypeParameterDeclaration,
    decl: ts.SignatureDeclaration,
    args: readonly ts.Expression[],
    env: Env,
  ): Judged {
    const symbol = symbolAt(parameter.name);
    const parts: Judged[] = [];
    const refersTo = (node: ts.TypeNode | undefined): boolean => {
      while (node && ts.isParenthesizedTypeNode(node)) node = node.type;
      return (
        !!node &&
        ts.isTypeReferenceNode(node) &&
        !node.typeArguments &&
        symbolAt(
          ts.isQualifiedName(node.typeName)
            ? node.typeName.right
            : node.typeName,
        ) === symbol
      );
    };
    const mentions = (node: ts.Node): boolean => {
      let found = false;
      const visit = (child: ts.Node): void => {
        if (found) return;
        if (ts.isIdentifier(child) && symbolAt(child) === symbol) found = true;
        else ts.forEachChild(child, visit);
      };
      visit(node);
      return found;
    };
    decl.parameters.forEach((declared, index) => {
      const annotation = declared.type;
      if (!annotation) return;
      const given = declared.dotDotDotToken
        ? args.slice(index)
        : args[index]
          ? [args[index]]
          : [];
      for (const argument of given) {
        if (refersTo(annotation)) parts.push(expression(argument));
        else if (
          declared.dotDotDotToken &&
          ts.isArrayTypeNode(annotation) &&
          refersTo(annotation.elementType)
        )
          parts.push(expression(argument));
        else if (
          ts.isArrayTypeNode(annotation) &&
          refersTo(annotation.elementType)
        )
          parts.push(elementOf(expression(argument)));
        else if (
          ts.isFunctionTypeNode(annotation) &&
          refersTo(annotation.type) &&
          (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
        )
          parts.push(
            argument.type
              ? type(argument.type, { env: EMPTY, visiting: NONE })
              : returnsOf(argument),
          );
        else if (mentions(annotation) && tainted(expression(argument)))
          parts.push(
            failed(
              `the type argument ${parameter.name.text} inferred from a tainted argument`,
            ),
          );
        else if (
          mentions(annotation) &&
          (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
          tainted(returnsOf(argument))
        )
          parts.push(
            failed(
              `the type argument ${parameter.name.text} inferred from a tainted callback`,
            ),
          );
      }
    });
    // The constraint bounds whatever is inferred (an `any` argument gives
    // the constraint itself), so it is always part of the judgement.
    if (parameter.constraint)
      parts.push(type(parameter.constraint, { env, visiting: NONE }));
    if (parts.length) return join(parts);
    return parameter.default
      ? type(parameter.default, { env, visiting: NONE })
      : CLEAN;
  }
  /** The parameter type a call gives argument `index` (for a callback's parameters). */
  function parameterTypeAt(
    call: ts.CallExpression | ts.NewExpression,
    index: number,
  ): Judged {
    const callee = expression(call.expression);
    const chosen = prepare(callee, call, ts.isNewExpression(call));
    let decl: ts.SignatureDeclaration;
    let env: Env;
    let self: Judged | undefined;
    if ("decl" in chosen) {
      ({ decl, env, self } = chosen);
    } else if (chosen.k === "object" && ts.isNewExpression(call)) {
      // A constructed class: its chosen constructor under the instance's environment.
      const constructors =
        chosen.symbol.declarations
          ?.find(ts.isClassLike)
          ?.members.filter(ts.isConstructorDeclaration) ?? [];
      const overloads = overloadsOf(constructors);
      let picked: ts.Declaration | undefined;
      try {
        picked = checker.getResolvedSignature(call)?.declaration;
      } catch {
        picked = undefined;
      }
      const found = overloads.find((signature) => signature === picked);
      if (!found)
        return failed("a constructor overload that cannot be trusted");
      decl = found;
      env = chosen.env;
      self = chosen;
    } else return chosen;
    const fullEnv = new Map(env);
    const explicit = call.typeArguments;
    (decl.typeParameters ?? []).forEach((parameter, at) => {
      const symbol = symbolAt(parameter.name);
      if (!symbol) return;
      const given = explicit?.[at];
      fullEnv.set(
        symbol,
        lazy(() =>
          given
            ? type(given, { env: EMPTY, visiting: NONE })
            : inferred(parameter, decl, argumentsOf(call), fullEnv),
        ),
      );
    });
    const parameter =
      decl.parameters[index] ??
      (decl.parameters.at(-1)?.dotDotDotToken
        ? decl.parameters.at(-1)
        : undefined);
    if (!parameter?.type) return CLEAN;
    const judged = type(parameter.type, { env: fullEnv, self, visiting: NONE });
    return parameter.dotDotDotToken ? elementOf(judged) : judged;
  }

  // ---------------- iteration and await ----------------
  function elementOf(judged: Judged): Judged {
    switch (judged.k) {
      case "failed":
      case "clean":
        return judged;
      case "union":
        return join(judged.parts.map(elementOf));
      case "tuple":
        return join([...judged.elements, judged.rest ?? CLEAN]);
      case "checked": {
        const element = checker.getIndexTypeOfType(
          judged.type,
          ts.IndexKind.Number,
        );
        return element
          ? fromType(element)
          : unhandled(DENY_ELEMENT, "element", "checked type");
      }
      case "object": {
        const name = judged.symbol.name;
        const isLibrary = (judged.symbol.declarations ?? []).every(library);
        if (isLibrary && LIBRARY_ITERABLES.has(name))
          return firstArgument(judged);
        if (isLibrary && LIBRARY_ENTRIES.has(name)) {
          const [key, value] = typeParametersOf(judged.symbol).map(
            (parameter) => {
              const symbol = symbolAt(parameter.name);
              return (symbol && judged.env.get(symbol)?.()) ?? CLEAN;
            },
          );
          return { k: "tuple", elements: [key ?? CLEAN, value ?? CLEAN] };
        }
        if (isLibrary && name === "String") return CLEAN;
        return unhandled(DENY_ELEMENT, "element", name);
      }
      default:
        return unhandled(DENY_ELEMENT, "element", judged.k);
    }
  }
  function awaited(judged: Judged): Judged {
    switch (judged.k) {
      case "failed":
      case "clean":
        return judged;
      case "union":
        return join(judged.parts.map(awaited));
      case "checked": {
        const value = checker.getAwaitedType(judged.type);
        return value
          ? fromType(value)
          : unhandled(DENY_AWAIT, "await", "checked type");
      }
      case "object": {
        const isLibrary = (judged.symbol.declarations ?? []).every(library);
        if (isLibrary && PROMISES.has(judged.symbol.name))
          return awaited(firstArgument(judged));
        const declared = checker.getDeclaredTypeOfSymbol(judged.symbol);
        return checker.getPropertyOfType(declared, "then")
          ? unhandled(DENY_AWAIT, "await", judged.symbol.name)
          : judged;
      }
      case "literal":
        return judged.node.members.some(
          (member) =>
            member.name &&
            ts.isIdentifier(member.name) &&
            member.name.text === "then",
        )
          ? unhandled(DENY_AWAIT, "await", "a thenable type literal")
          : judged;
      case "opaque":
        return unhandled(DENY_AWAIT, "await", judged.why);
      default:
        return judged;
    }
  }

  // The kinds handled by the J-kind switches (all of them, by construction).
  HANDLED.element = [
    "failed",
    "clean",
    "union",
    "tuple",
    "checked",
    "object (library iterables)",
  ];
  HANDLED.await = [
    "failed",
    "clean",
    "union",
    "checked",
    "object (library promises, non-thenables)",
    "literal (non-thenable)",
    "other non-thenables",
  ];
  HANDLED.call = [
    "failed",
    "clean",
    "checked",
    "function",
    "static (new of a class)",
    "object (call/construct signatures)",
    "literal (call/construct signatures)",
    "union",
  ];

  return { expression, tainted, signatureDependsOnFailed, reaches };
}
