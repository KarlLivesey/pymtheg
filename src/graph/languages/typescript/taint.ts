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
  /** Every tainted symbol (seeds included), with its causes. */
  all: Map<ts.Symbol, Set<string>>;
}

export interface TaintInput {
  program: ts.Program;
  checker: ts.TypeChecker;
  captured: ReadonlySet<string>;
  resolveModule: (specifier: string, from: string) => string | undefined;
  /** Whether a captured file failed (syntax error). */
  invalid: (path: string) => boolean;
}

const memo = new WeakMap<ts.TypeChecker, Taint>();

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
const EMPTY: Taint = { seeds: new Map(), all: new Map() };

/** The parts of a declaration its meaning depends on, by kind (one entry per kind). */
export const DEPENDENCIES: Record<string, (node: ts.Node) => ts.Node[]> = {
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

export function taintOf(input: TaintInput, failed: boolean): Taint {
  if (!failed) return EMPTY;
  const known = memo.get(input.checker);
  if (known) return known;
  const { program, checker, captured, resolveModule, invalid } = input;
  const seeds = new Map<ts.Symbol, Set<string>>();
  const all = new Map<ts.Symbol, Set<string>>();
  const add = (
    map: Map<ts.Symbol, Set<string>>,
    symbol: ts.Symbol,
    causes: Iterable<string>,
  ): boolean => {
    const set = map.get(symbol) ?? new Set<string>();
    const before = set.size;
    for (const cause of causes) set.add(cause);
    map.set(symbol, set);
    return set.size > before;
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
      const symbol = symbolOfDeclaration(node, checker);
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
      if (Object.values(DEPENDENCIES).some((parts) => parts(node).length > 0))
        declarations.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (!all.size) {
    memo.set(checker, EMPTY);
    return EMPTY;
  }
  // ----- closure -----
  /** Causes of whatever a subtree refers to (aliases followed). */
  const referenced = (part: ts.Node): Set<string> => {
    const causes = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        let symbol: ts.Symbol | undefined;
        try {
          symbol = checker.getSymbolAtLocation(node);
        } catch {
          symbol = undefined;
        }
        if (symbol)
          for (const step of aliasChain(checker, symbol))
            for (const cause of all.get(step) ?? []) causes.add(cause);
      }
      ts.forEachChild(node, visit);
    };
    visit(part);
    return causes;
  };
  for (let changed = true, rounds = 0; changed && rounds < 64; rounds++) {
    changed = false;
    for (const node of declarations) {
      const symbol = symbolOfDeclaration(node, checker);
      if (!symbol) continue;
      for (const parts of Object.values(DEPENDENCIES))
        for (const part of parts(node)) {
          const causes = referenced(part);
          if (causes.size && add(all, symbol, causes)) changed = true;
        }
    }
  }
  const taint = { seeds, all };
  memo.set(checker, taint);
  return taint;
}
