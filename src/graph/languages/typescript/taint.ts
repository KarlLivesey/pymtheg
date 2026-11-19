// SPDX-License-Identifier: MIT
import ts from "typescript";
import { fromVirtual, toVirtual } from "./project.js";
import { bindingSpecifier } from "./symbols.js";

/**
 * Taint: a failure with a failed-file cause is a value that passes through
 * every lookup that depends on it (docs/changes/W2-D.md, "Failed files").
 * Computed once per checker, after binding, over the declarations of the
 * program's valid captured files, with the compiler's own symbol and alias
 * resolution:
 * - seeds: a binding of a failed module (import, re-export, `import =`,
 *   `require`, `module.exports = require(…)`), or of a name that only an
 *   `export *` from a failed module could supply;
 * - a declaration is tainted when anything its meaning depends on refers to
 *   a tainted symbol (see DEPENDENCIES); repeated to a fixpoint.
 */
export interface Taint {
  /** Seeds: bindings that resolve into a failed file. */
  seeds: Map<ts.Symbol, Set<string>>;
  /**
   * Strongly tainted symbols (seeds included), with their causes: what the
   * symbol is, or which members it has, depends on a failed file.
   */
  all: Map<ts.Symbol, Set<string>>;
  /**
   * Weakly tainted symbols: the failed file appears only in a type argument
   * or array element type (`Promise<Job>[]`, `extends Base<Job>`), so member
   * lookups find the same declarations but their result types may differ.
   */
  weak: Map<ts.Symbol, Set<string>>;
}

export interface TaintInput {
  program: ts.Program;
  checker: ts.TypeChecker;
  captured: ReadonlySet<string>;
  resolveModule: (specifier: string, from: string) => string | undefined;
  /** Whether a captured file failed (syntax error). */
  invalid: (path: string) => boolean;
  /**
   * Names the program's failed files declare (top level, namespaces,
   * `declare global`), with those files: an unresolved reference to one is
   * a dependence on them, like an import binding.
   */
  failedNames: ReadonlyMap<string, readonly string[]>;
}

const memo = new WeakMap<ts.TypeChecker, Taint>();
/**
 * The most steps one program's taint walk may take: a node visited while
 * looking for seeds or reading a declaration's parts, an edge followed to
 * the fixpoint, and a cause stored, compared or copied. A count, never a time or memory reading, so the outcome
 * depends only on the snapshot. Far above every measured pin
 * (docs/changes/C-13.md). A walk that reaches it stops: its program's taint
 * is unknown, and the module reports every link that would have consulted
 * it as unresolved (`taint-budget-exhausted`), never as untainted.
 */
export const TAINT_BUDGET = 8_000_000;
/** Test hook: the budget in force (TAINT_BUDGET in normal use). */
export const taintLimits = { steps: TAINT_BUDGET };
/** Observation counters for evidence and tests: walks, the most steps one took, walks stopped. */
export const taintStatistics = { walks: 0, maxSteps: 0, exhausted: 0 };
/** Checkers whose taint walk reached the budget. */
const exhaustedFor = new WeakSet<ts.TypeChecker>();
/** Whether this checker's taint walk stopped at the budget (its taint is unknown). */
export const taintExhausted = (checker: ts.TypeChecker) =>
  exhaustedFor.has(checker);
/**
 * Treats this checker's taint as unknown without walking: for a program
 * rebuilt from one whose walk reached the budget (the same files, or one
 * fewer). Only ever more conservative: its links are reported
 * `taint-budget-exhausted`.
 */
export function markTaintExhausted(checker: ts.TypeChecker): void {
  exhaustedFor.add(checker);
  memo.set(checker, EMPTY);
}
const BUDGET_REACHED = Symbol("taint budget reached");
/** A destructured binding depends on the property it takes. */
const DESTRUCTURED = true;
/** A reference inside a type argument taints weakly. */
const WEAK_ARGUMENTS = true;
/** A call's arguments taint its result weakly, and only for a generic or overloaded callee. */
const CALL_ARGUMENTS = true;
/** Weak taint passes on only through a value itself, not through the object of a member access. */
const WEAK_THROUGH_VALUE_ONLY = true;
/** The parameters of a signature in a type taint weakly. */
const WEAK_SIGNATURE_PARAMETERS = true;
/** An unresolved name a failed file declares taints like a binding. */
const UNREAD_NAMES = true;
/** A function literal counts by its signature only, not its body. */
const SIGNATURE_ONLY = true;
/** An import type of a failed module is a seed. */
const IMPORT_TYPES = true;

/**
 * A symbol and the aliases it resolves through, as the compiler resolves
 * them, plus at each binding the bound module's `export =` symbol (the
 * compiler's own step goes straight through it to the final target).
 */
export function aliasChain(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): ts.Symbol[] {
  const chain: ts.Symbol[] = [];
  let current: ts.Symbol | undefined = symbol;
  for (let steps = 0; current && steps < 64; steps++) {
    chain.push(current);
    if (!(current.flags & ts.SymbolFlags.Alias)) break;
    const specifier = bindingSpecifier(current);
    if (specifier) {
      let module: ts.Symbol | undefined;
      try {
        module = checker.getSymbolAtLocation(specifier);
      } catch {
        module = undefined;
      }
      const equals = module?.exports?.get("export=" as ts.__String);
      if (equals && !chain.includes(equals))
        for (const step of aliasChain(checker, equals))
          if (!chain.includes(step)) chain.push(step);
    }
    let next: ts.Symbol | undefined;
    try {
      next = checker.getImmediateAliasedSymbol(current);
    } catch {
      next = undefined;
    }
    if (!next || next === current || chain.includes(next)) break;
    current = next;
  }
  return chain;
}
const EMPTY: Taint = { seeds: new Map(), all: new Map(), weak: new Map() };

/** The parts of a declaration its meaning depends on, by kind (one entry per kind). */
export const DEPENDENCIES: Record<
  string,
  (node: ts.Node, checker: ts.TypeChecker) => ts.Node[]
> = {
  /** `x: T`, `p: T`, `prop: T`. */
  annotation: (node) =>
    (ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node)) &&
    node.type
      ? [node.type]
      : [],
  /** `type Y = …`. */
  aliasBody: (node) => (ts.isTypeAliasDeclaration(node) ? [node.type] : []),
  /** `extends`/`implements` of a class or interface (every merged declaration). */
  heritage: (node) =>
    (ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) &&
    node.heritageClauses
      ? [...node.heritageClauses]
      : [],
  /** Initialisers, for inferred types (also of a destructured binding). */
  initializer: (node) => {
    // `for (const job of jobs)`: the iterated expression.
    if (
      ts.isVariableDeclaration(node) &&
      !node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (ts.isForOfStatement(node.parent.parent) ||
        ts.isForInStatement(node.parent.parent))
    )
      return [node.parent.parent.expression];
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isPropertyDeclaration(node)) &&
      node.initializer
    )
      return [node.initializer];
    if (ts.isBindingElement(node)) {
      let holder: ts.Node = node;
      while (
        ts.isBindingElement(holder) ||
        ts.isObjectBindingPattern(holder) ||
        ts.isArrayBindingPattern(holder)
      )
        holder = holder.parent;
      return ts.isVariableDeclaration(holder) && holder.initializer
        ? [holder.initializer]
        : [];
    }
    return [];
  },
  /** A declared return type. */
  returnType: (node) =>
    ts.isFunctionLike(node) && node.type ? [node.type] : [],
  /** An inferred return: the returned expressions (not of nested functions). */
  inferredReturn: (node) => {
    if (!ts.isFunctionLike(node) || node.type) return [];
    const body = (node as ts.FunctionLikeDeclaration).body;
    if (!body) return [];
    if (!ts.isBlock(body)) return [body];
    const found: ts.Node[] = [];
    const visit = (child: ts.Node): void => {
      if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
      if (ts.isReturnStatement(child) && child.expression)
        found.push(child.expression);
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  },
  /** `export = …`, `module.exports = …`, `exports.x = …`. */
  exportEquals: (node) =>
    (ts.isExportAssignment(node) && node.isExportEquals) ||
    (ts.isBinaryExpression(node) && isCommonJsExport(node.left))
      ? [ts.isExportAssignment(node) ? node.expression : node.right]
      : [],
  /** `export default …`. */
  defaultExport: (node) =>
    ts.isExportAssignment(node) && !node.isExportEquals
      ? [node.expression]
      : [],
  /**
   * An unannotated parameter of a callback takes its type from the call it
   * is passed to (`list.map((job) => …)`): the callee and its receiver.
   */
  contextual: (node, checker) => {
    if (!ts.isParameter(node) || node.type) return [];
    const fn = node.parent;
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return [];
    const parts: ts.Node[] = [];
    let holder: ts.Node = fn;
    while (ts.isParenthesizedExpression(holder.parent)) holder = holder.parent;
    const call = holder.parent;
    if (
      (ts.isCallExpression(call) || ts.isNewExpression(call)) &&
      call.expression !== holder
    )
      // The callee (its receiver's type arguments reach it when the
      // callee's declared type uses them, as `Array<T>.map` does).
      parts.push(call.expression);
    // The declaration of the contextual type itself (a listener's function
    // type in an interface, say), which names the parameter's type.
    let contextual: ts.Type | undefined;
    try {
      contextual = checker.getContextualType(fn);
    } catch {
      contextual = undefined;
    }
    for (const type of contextual?.isUnion()
      ? contextual.types
      : contextual
        ? [contextual]
        : [])
      for (const symbol of [type.getSymbol(), type.aliasSymbol])
        for (const declaration of symbol?.declarations ?? [])
          if (!declaration.getSourceFile().isDeclarationFile)
            parts.push(declaration);
    return parts;
  },
  /** In a JS file, a JSDoc `@type` or `@returns` type, and a `@typedef`. */
  jsdoc: (node) => {
    if (ts.isJSDocTypedefTag(node) || ts.isJSDocCallbackTag(node))
      return node.typeExpression ? [node.typeExpression] : [];
    if (!/\.(c|m)?jsx?$/.test(node.getSourceFile().fileName)) return [];
    const parts: ts.Node[] = [];
    const type = ts.getJSDocType(node);
    if (type) parts.push(type);
    if (ts.isFunctionLike(node)) {
      const returned = ts.getJSDocReturnType(node);
      if (returned) parts.push(returned);
    }
    return parts;
  },
  /** A generic constraint or default. */
  typeParameter: (node) =>
    ts.isTypeParameterDeclaration(node)
      ? [node.constraint, node.default].filter(
          (part): part is ts.TypeNode => !!part,
        )
      : [],
};

const isCommonJsExport = (left: ts.Node): boolean =>
  (ts.isPropertyAccessExpression(left) &&
    ts.isIdentifier(left.expression) &&
    left.expression.text === "module" &&
    left.name.text === "exports") ||
  (ts.isPropertyAccessExpression(left) &&
    ((ts.isIdentifier(left.expression) && left.expression.text === "exports") ||
      isCommonJsExport(left.expression)));

/**
 * The symbol a declaration binds, for the seed walk: the binder's own symbol
 * (every import, re-export, `import =` and `require` binding has one), or a
 * CommonJS export assignment's. Never a name the checker must resolve in an
 * arbitrary expression: resolving every member access of a program asks the
 * checker for each one's type (a single member access on a cross-product of
 * unions and intersections exhausted the heap, see docs/changes/C-13.md).
 */
function aliasDeclared(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const bound = (node as { symbol?: ts.Symbol }).symbol;
  if (bound) return bound;
  if (ts.isBinaryExpression(node) && isCommonJsExport(node.left))
    return checker.getSymbolAtLocation(node.left);
  return undefined;
}

/** The symbol a declaration (or a CommonJS export assignment) defines. */
function symbolOfDeclaration(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const bound = (node as { symbol?: ts.Symbol }).symbol;
  if (bound) return bound;
  if (ts.isBinaryExpression(node))
    return checker.getSymbolAtLocation(node.left);
  const name = (node as ts.NamedDeclaration).name;
  return name ? checker.getSymbolAtLocation(name) : undefined;
}

/**
 * The causes recorded for a symbol, also through its declarations: a member
 * of an instantiated generic type is a new symbol whose declarations are the
 * original ones.
 */
/**
 * Whether a member's declared type refers to its owner's type parameters
 * (`Array<T>.slice(): T[]`, `Box<T>.value: T`): then the member's value
 * depends on the receiver's type arguments. So does a member the compiler
 * could not resolve.
 */
export function usesOwnerTypeParameters(
  checker: ts.TypeChecker,
  member: ts.Symbol | undefined,
): boolean {
  // A member with no symbol cannot be shown independent of the receiver.
  if (!member) return true;
  const declaration = member.valueDeclaration ?? member.declarations?.[0];
  const owner = declaration?.parent;
  if (
    !declaration ||
    !owner ||
    !(ts.isClassLike(owner) || ts.isInterfaceDeclaration(owner)) ||
    !owner.typeParameters?.length
  )
    return false;
  const parameters = new Set<ts.Symbol>();
  for (const parameter of owner.typeParameters) {
    const symbol = checker.getSymbolAtLocation(parameter.name);
    if (symbol) parameters.add(symbol);
  }
  let uses = false;
  const visit = (node: ts.Node): void => {
    if (uses) return;
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const symbol = checker.getSymbolAtLocation(node.typeName);
      if (symbol && parameters.has(symbol)) uses = true;
    }
    // Not a body or an initialiser: the declared type only.
    if (ts.isBlock(node) || (ts.isExpression(node) && !ts.isTypeNode(node)))
      return;
    ts.forEachChild(node, visit);
  };
  const typed = declaration as ts.SignatureDeclaration & {
    type?: ts.TypeNode;
  };
  if (typed.type) visit(typed.type);
  for (const parameter of typed.parameters ?? [])
    if (parameter.type) visit(parameter.type);
  return uses;
}

export function causesOfSymbol(
  map: ReadonlyMap<ts.Symbol, ReadonlySet<string>>,
  symbol: ts.Symbol,
): string[] {
  const causes = [...(map.get(symbol) ?? [])];
  for (const declaration of symbol.declarations ?? []) {
    const declared = (declaration as { symbol?: ts.Symbol }).symbol;
    if (declared && declared !== symbol)
      causes.push(...(map.get(declared) ?? []));
  }
  return causes;
}

export function taintOf(input: TaintInput, failed: boolean): Taint {
  if (!failed) return EMPTY;
  const known = memo.get(input.checker);
  if (known) return known;
  let steps = 0;
  const step = () => {
    if (++steps > taintLimits.steps) throw BUDGET_REACHED;
  };
  taintStatistics.walks++;
  try {
    return computeTaint(input, step);
  } catch (error) {
    if (error !== BUDGET_REACHED) throw error;
    // Unknown, not empty: the module turns every link of this program
    // that consults it into `taint-budget-exhausted` (taintExhausted).
    taintStatistics.exhausted++;
    exhaustedFor.add(input.checker);
    memo.set(input.checker, EMPTY);
    return EMPTY;
  } finally {
    taintStatistics.maxSteps = Math.max(taintStatistics.maxSteps, steps);
  }
}

function computeTaint(input: TaintInput, step: () => void): Taint {
  const { program, checker, captured, resolveModule, invalid, failedNames } =
    input;
  const seeds = new Map<ts.Symbol, Set<string>>();
  const all = new Map<ts.Symbol, Set<string>>();
  const weak = new Map<ts.Symbol, Set<string>>();
  /**
   * Cause sets held by more than one symbol: each is copied before it grows.
   * The fixpoint hands a symbol's whole set to each dependent. Copying it
   * every time made memory grow with symbols times causes: on
   * microsoft/TypeScript, about 12,000 failed files, the walk exhausted the
   * heap (docs/changes/C-13.md). The contents are the same.
   */
  const shared = new WeakSet<Set<string>>();
  const add = (
    map: Map<ts.Symbol, Set<string>>,
    symbol: ts.Symbol,
    causes: Iterable<string>,
  ): boolean => {
    // Every cause stored or copied is a step: the budget bounds what the
    // walk holds, not only what it visits.
    const set = map.get(symbol);
    if (!set) {
      if (causes instanceof Set && causes.size) {
        step();
        shared.add(causes);
        map.set(symbol, causes);
        return true;
      }
      const fresh = new Set<string>();
      for (const cause of causes) {
        step();
        fresh.add(cause);
      }
      map.set(symbol, fresh);
      return fresh.size > 0;
    }
    if (set === causes) return false;
    let grows = false;
    for (const cause of causes) {
      step();
      if (!set.has(cause)) {
        grows = true;
        break;
      }
    }
    if (!grows) return false;
    let target = set;
    if (shared.has(set)) {
      target = new Set<string>();
      for (const cause of set) {
        step();
        target.add(cause);
      }
    }
    for (const cause of causes) {
      step();
      target.add(cause);
    }
    if (target !== set) map.set(symbol, target);
    return true;
  };
  /** The failed module itself, or the failed modules of its `export *` closure. */
  const failedIn = (module: string, seen: Set<string>): string[] => {
    if (seen.has(module)) return [];
    seen.add(module);
    if (invalid(module)) return [module];
    const source = program.getSourceFile(toVirtual(module));
    if (!source) return [];
    const found: string[] = [];
    for (const statement of source.statements)
      if (
        ts.isExportDeclaration(statement) &&
        !statement.exportClause &&
        statement.moduleSpecifier &&
        ts.isStringLiteralLike(statement.moduleSpecifier)
      ) {
        const next = resolveModule(statement.moduleSpecifier.text, module);
        if (next !== undefined) found.push(...failedIn(next, seen));
      }
    return found;
  };
  /** Causes of a module specifier written in `from`. */
  const moduleCauses = (
    specifier: ts.Expression | undefined,
    from: string,
    resolved: boolean,
  ): string[] => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return [];
    const module = resolveModule(specifier.text, from);
    if (module === undefined) return [];
    if (invalid(module)) return [module];
    // Through `export *`: only when the name was not found elsewhere.
    return resolved ? [] : failedIn(module, new Set());
  };
  const resolvedAlias = (symbol: ts.Symbol): boolean => {
    try {
      return !!checker.getAliasedSymbol(symbol).declarations?.length;
    } catch {
      return false;
    }
  };
  const sources = program.getSourceFiles().filter((source) => {
    const path = fromVirtual(source.fileName);
    return path !== undefined && captured.has(path) && !invalid(path);
  });
  // ----- seeds -----
  const declarations: ts.Node[] = [];
  for (const source of sources) {
    const path = fromVirtual(source.fileName)!;
    const visit = (node: ts.Node): void => {
      step();
      const symbol = aliasDeclared(node, checker);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
        const causes = moduleCauses(
          bindingSpecifier(symbol),
          path,
          resolvedAlias(symbol),
        );
        if (causes.length) {
          add(seeds, symbol, causes);
          add(all, symbol, causes);
        }
      }
      // `const b = require("./bad")`, `module.exports = require("./bad")`,
      // `const m = await import("./bad")`.
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) &&
          node.expression.text === "require") ||
          node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        node.arguments.length >= 1
      ) {
        const causes = moduleCauses(node.arguments[0], path, false);
        let holder: ts.Node = node.parent;
        while (
          ts.isAwaitExpression(holder) ||
          ts.isParenthesizedExpression(holder)
        )
          holder = holder.parent;
        const target =
          holder &&
          (ts.isVariableDeclaration(holder) ||
            (ts.isBinaryExpression(holder) && holder.left !== node))
            ? symbolOfDeclaration(holder, checker)
            : undefined;
        if (causes.length && target) {
          add(seeds, target, causes);
          add(all, target, causes);
        }
      }
      if (
        Object.values(DEPENDENCIES).some(
          (parts) => parts(node, checker).length > 0,
        )
      )
        declarations.push(node);
      // JSDoc `@typedef`/`@callback` tags are declarations too.
      for (const doc of (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? [])
        for (const tag of doc.tags ?? [])
          if (
            (ts.isJSDocTypedefTag(tag) || ts.isJSDocCallbackTag(tag)) &&
            tag.typeExpression
          )
            declarations.push(tag);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // ----- closure -----
  /**
   * Whether a node is a type argument (or array element type) that decides
   * only member types, not which members exist: an argument of a class or
   * interface (`Promise<Job>`, `QueueGetters<Job>`). An argument of a type
   * alias (`Pick<BaseI, "m">`, a mapped type) can decide the members.
   */
  const isTypeArgument = (node: ts.Node): boolean => {
    const parent = node.parent;
    if (
      ts.isTypeReferenceNode(parent) ||
      ts.isExpressionWithTypeArguments(parent)
    ) {
      const name = ts.isTypeReferenceNode(parent)
        ? parent.typeName
        : parent.expression;
      let referenced: ts.Symbol | undefined;
      try {
        referenced = checker.getSymbolAtLocation(
          ts.isQualifiedName(name) ? name.right : name,
        );
        if (referenced && referenced.flags & ts.SymbolFlags.Alias)
          referenced = checker.getAliasedSymbol(referenced);
      } catch {
        referenced = undefined;
      }
      if (
        !referenced ||
        !(referenced.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface))
      )
        return false;
    }
    return (
      ((ts.isTypeReferenceNode(parent) ||
        ts.isExpressionWithTypeArguments(parent) ||
        ts.isCallExpression(parent) ||
        ts.isNewExpression(parent) ||
        ts.isImportTypeNode(parent)) &&
        !!parent.typeArguments?.includes(node as ts.TypeNode)) ||
      (ts.isArrayTypeNode(parent) && parent.elementType === node)
    );
  };
  /** A dependence of one declaration's symbol on another symbol's taint. */
  interface Edge {
    target: ts.Symbol;
    /** How the other symbol's strong taint reaches the target. */
    fromAll: "strong" | "weak";
    /** Whether its weak taint reaches the target. */
    fromWeak: boolean;
  }
  const dependents = new Map<ts.Symbol, Edge[]>();
  const depend = (on: ts.Symbol, edge: Edge) => {
    // A member of an instantiated generic type depends through its
    // declaration's own symbol.
    const keys = new Set<ts.Symbol>([on]);
    for (const declaration of on.declarations ?? []) {
      const declared = (declaration as { symbol?: ts.Symbol }).symbol;
      if (declared) keys.add(declared);
    }
    for (const key of keys) {
      const edges = dependents.get(key);
      if (edges) edges.push(edge);
      else dependents.set(key, [edge]);
    }
  };
  /** Only a generic or overloaded callee's result depends on its arguments. */
  const argumentsMatter = (call: ts.CallExpression | ts.NewExpression) => {
    try {
      const type = checker.getTypeAtLocation(call.expression);
      const signatures = ts.isNewExpression(call)
        ? type.getConstructSignatures()
        : type.getCallSignatures();
      return (
        signatures.length > 1 ||
        signatures.some((signature) => !!signature.typeParameters?.length)
      );
    } catch {
      return true;
    }
  };
  /**
   * Records what a part of a declaration refers to (aliases followed):
   * strong when a reference decides what the declaration is, weak when it
   * sits in a type argument; a name no declaration answers that a failed
   * file declares taints the target directly.
   */
  const reference = (target: ts.Symbol, part: ts.Node) => {
    const visit = (node: ts.Node, inArgument: boolean): void => {
      step();
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        let symbol: ts.Symbol | undefined;
        try {
          symbol = checker.getSymbolAtLocation(node);
        } catch {
          symbol = undefined;
        }
        // The object of a member access gives the member's value only its
        // strong taint (which members exist); its type arguments do not
        // reach a member whose own type does not depend on them.
        const parent = node.parent;
        const object =
          WEAK_THROUGH_VALUE_ONLY &&
          node !== part &&
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          !usesOwnerTypeParameters(
            checker,
            checker.getSymbolAtLocation(parent.name),
          );
        // An unresolved name (in a type, the compiler's "unknown" symbol).
        const resolved =
          symbol &&
          (symbol.declarations?.length || symbol.flags & ts.SymbolFlags.Alias);
        if (symbol && resolved)
          for (const step of aliasChain(checker, symbol))
            depend(step, {
              target,
              fromAll: inArgument ? "weak" : "strong",
              fromWeak: !object,
            });
        else if (UNREAD_NAMES && ts.isIdentifier(node)) {
          const files = failedNames.get(node.text);
          if (files?.length) add(inArgument ? weak : all, target, files);
        }
      }
      // `x as T`, `<T>x`: the asserted type replaces the expression's.
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        visit(node.type, inArgument);
        return;
      }
      // A function literal's type is its signature: its parameters'
      // annotations (or defaults) and its return type (or what it returns),
      // never what its body mentions.
      if (
        SIGNATURE_ONLY &&
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      ) {
        for (const parameter of node.parameters) {
          if (parameter.type) visit(parameter.type, true);
          else if (parameter.initializer) visit(parameter.initializer, true);
        }
        if (node.type) visit(node.type, inArgument);
        else
          for (const returned of DEPENDENCIES.inferredReturn!(node, checker))
            visit(returned, inArgument);
        return;
      }
      // `import("./bad")`, `typeof import("./bad")`, `import("./bad").X`.
      if (
        IMPORT_TYPES &&
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        const from = fromVirtual(node.getSourceFile().fileName);
        const causes =
          from === undefined
            ? []
            : moduleCauses(node.argument.literal, from, false);
        if (causes.length) add(inArgument ? weak : all, target, causes);
      }
      if (
        CALL_ARGUMENTS &&
        (ts.isCallExpression(node) || ts.isNewExpression(node))
      ) {
        // The callee decides the result; its arguments only through
        // inferred type arguments (weak), and only when they can.
        visit(node.expression, inArgument);
        for (const typeArgument of node.typeArguments ?? [])
          visit(typeArgument, true);
        if (argumentsMatter(node))
          for (const argument of node.arguments ?? []) visit(argument, true);
        return;
      }
      // The parameters of a signature in a type (a function, constructor or
      // method type) decide only what it accepts: weak, through inference.
      const signatureParameter =
        WEAK_SIGNATURE_PARAMETERS &&
        ts.isParameter(node) &&
        (ts.isFunctionTypeNode(node.parent) ||
          ts.isConstructorTypeNode(node.parent) ||
          ts.isCallSignatureDeclaration(node.parent) ||
          ts.isConstructSignatureDeclaration(node.parent) ||
          ts.isMethodSignature(node.parent));
      ts.forEachChild(node, (child) =>
        visit(
          child,
          inArgument ||
            signatureParameter ||
            (WEAK_ARGUMENTS && isTypeArgument(child)),
        ),
      );
    };
    visit(part, false);
  };
  for (const node of declarations) {
    const symbol = symbolOfDeclaration(node, checker);
    if (!symbol) continue;
    for (const parts of Object.values(DEPENDENCIES))
      for (const part of parts(node, checker)) reference(symbol, part);
    // `const { job } = tree`: the destructured property's own taint.
    if (
      DESTRUCTURED &&
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent)
    ) {
      const key = node.propertyName ?? node.name;
      let property: ts.Symbol | undefined;
      try {
        property = ts.isIdentifier(key)
          ? checker.getTypeAtLocation(node.parent).getProperty(key.text)
          : undefined;
      } catch {
        property = undefined;
      }
      if (property)
        depend(property, { target: symbol, fromAll: "strong", fromWeak: true });
    }
  }
  // Nothing reaches a failed file (no binding, import type or global name).
  if (!all.size && !weak.size) {
    memo.set(checker, EMPTY);
    return EMPTY;
  }
  // A worklist to the true fixpoint: taint only grows, over finitely many
  // symbols and causes, so it ends; there is no pass limit.
  const queue = [...new Set([...all.keys(), ...weak.keys()])];
  while (queue.length) {
    const changed = queue.pop()!;
    for (const edge of dependents.get(changed) ?? []) {
      step();
      let grew = false;
      const strong = all.get(changed);
      if (strong?.size)
        grew =
          add(edge.fromAll === "strong" ? all : weak, edge.target, strong) ||
          grew;
      const weakCauses = weak.get(changed);
      if (edge.fromWeak && weakCauses?.size)
        grew = add(weak, edge.target, weakCauses) || grew;
      if (grew) queue.push(edge.target);
    }
  }
  const taint = { seeds, all, weak };
  memo.set(checker, taint);
  return taint;
}
