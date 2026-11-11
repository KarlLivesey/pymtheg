import ts from "typescript";
import {
  isJsFile,
  isShadowedRequireAlias,
  requireInitializer,
  unwrap,
} from "./symbols.js";

/** The module specifier an import binding comes from, if the symbol is one. */
export function bindingSpecifier(symbol: ts.Symbol): ts.Expression | undefined {
  for (const declaration of symbol.declarations ?? []) {
    const owner = ts.findAncestor(
      declaration,
      (node) =>
        ts.isImportDeclaration(node) ||
        ts.isExportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isVariableDeclaration(node),
    );
    if (!owner) continue;
    if (ts.isImportDeclaration(owner)) return owner.moduleSpecifier;
    if (ts.isExportDeclaration(owner) && owner.moduleSpecifier)
      return owner.moduleSpecifier;
    if (
      ts.isImportEqualsDeclaration(owner) &&
      ts.isExternalModuleReference(owner.moduleReference)
    )
      return owner.moduleReference.expression;
    if (ts.isVariableDeclaration(owner)) {
      const call = requireInitializer(owner);
      if (call) return call.arguments[0];
    }
  }
  return undefined;
}

/**
 * Provenance of values from a locally declared `require`.
 *
 * The compiler binds `const m = require("./dep")` as an import alias of
 * `./dep` even when `require` is a local function, parameter or import, so
 * every type and alias it hands out for `m` points into `./dep`. That is
 * wrong: at run time `m` is whatever the local function returns.
 *
 * This decides once, per declaration and across every file of the program,
 * whether a binding's value came from such a call (directly, or by being
 * initialised, assigned, exported, re-exported, returned or stored in an
 * object property from one). Resolution consults it at every alias step and
 * for every receiver, so nothing reached through such a value links into the
 * required module, and genuine imports of the same module are unaffected.
 */
export class Provenance {
  /** False when no captured JS file binds a shadowed `require`: every query is false. */
  readonly active: boolean;
  private readonly memo = new Map<ts.Node, boolean>();
  private readonly pending = new Set<ts.Node>();
  private assignments: Map<ts.Symbol, ts.Expression[]> | undefined;

  constructor(
    private readonly program: ts.Program,
    private readonly checker: ts.TypeChecker,
    private readonly captured: ReadonlySet<string>,
  ) {
    this.active = this.files().some((file) => {
      let found = false;
      const visit = (node: ts.Node): void => {
        if (found) return;
        if (
          (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) &&
          isShadowedRequireAlias(node)
        )
          found = true;
        else ts.forEachChild(node, visit);
      };
      visit(file);
      return found;
    });
  }

  private files(): ts.SourceFile[] {
    return this.program
      .getSourceFiles()
      .filter(
        (file) => isJsFile(file) && this.captured.has(file.fileName.slice(1)),
      );
  }

  /**
   * Each step of a symbol's alias chain, starting with the symbol itself. For a
   * binding of a module whose value is `module.exports = …`/`export = …`, that
   * assignment's symbol is an explicit step: the compiler resolves through it
   * without exposing it as an immediate alias.
   */
  aliasSteps(symbol: ts.Symbol): ts.Symbol[] {
    const steps = [symbol];
    let current = symbol;
    while (current.flags & ts.SymbolFlags.Alias && steps.length < 64) {
      if (this.active) {
        const assignment = this.exportAssignment(current);
        if (assignment && !steps.includes(assignment)) steps.push(assignment);
      }
      const next = this.checker.getImmediateAliasedSymbol(current);
      if (!next || steps.includes(next)) break;
      steps.push(next);
      current = next;
    }
    return steps;
  }
  /** The `export=` symbol of the module a binding names, if it has one. */
  private exportAssignment(binding: ts.Symbol): ts.Symbol | undefined {
    const specifier = bindingSpecifier(binding);
    if (!specifier || !ts.isStringLiteralLike(specifier)) return undefined;
    const from = specifier.getSourceFile();
    // Internal to the pinned compiler (present at run time, not in its typings).
    const resolve = (
      this.program as ts.Program & {
        getResolvedModuleFromModuleSpecifier?: (
          specifier: ts.StringLiteralLike,
          file: ts.SourceFile,
        ) => ts.ResolvedModuleWithFailedLookupLocations | undefined;
      }
    ).getResolvedModuleFromModuleSpecifier;
    if (typeof resolve !== "function")
      throw Error(
        "The pinned TypeScript compiler no longer exposes getResolvedModuleFromModuleSpecifier",
      );
    const resolved = resolve.call(
      this.program,
      specifier,
      from,
    )?.resolvedModule;
    const target =
      resolved && this.program.getSourceFile(resolved.resolvedFileName);
    const module = (
      target as (ts.SourceFile & { symbol?: ts.Symbol }) | undefined
    )?.symbol;
    return module?.exports?.get("export=" as ts.__String);
  }

  /** Whether this symbol's own declarations carry a shadowed-require value (no alias following). */
  declares(symbol: ts.Symbol): boolean {
    return (
      this.active &&
      !!symbol.declarations?.some((declaration) =>
        this.declaration(declaration),
      )
    );
  }

  /** Whether any step of the symbol's alias chain carries a shadowed-require value. */
  symbol(symbol: ts.Symbol): boolean {
    return (
      this.active && this.aliasSteps(symbol).some((step) => this.declares(step))
    );
  }

  /** Whether an expression's value came from a shadowed `require`. */
  expression(node: ts.Expression): boolean {
    if (!this.active) return false;
    let expression = unwrap(node);
    while (ts.isAwaitExpression(expression))
      expression = unwrap(expression.expression);
    const at = (name: ts.Node) => {
      const symbol = this.checker.getSymbolAtLocation(name);
      return !!symbol && this.symbol(symbol);
    };
    if (ts.isIdentifier(expression)) return at(expression);
    if (ts.isPropertyAccessExpression(expression))
      return this.expression(expression.expression) || at(expression.name);
    if (ts.isElementAccessExpression(expression))
      return (
        this.expression(expression.expression) ||
        (ts.isStringLiteralLike(expression.argumentExpression) &&
          at(expression.argumentExpression))
      );
    if (ts.isCallExpression(expression) || ts.isNewExpression(expression))
      return this.expression(expression.expression);
    if (ts.isConditionalExpression(expression))
      return (
        this.expression(expression.whenTrue) ||
        this.expression(expression.whenFalse)
      );
    if (
      ts.isBinaryExpression(expression) &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.CommaToken,
        ts.SyntaxKind.EqualsToken,
      ].includes(expression.operatorToken.kind)
    )
      return (
        (expression.operatorToken.kind !== ts.SyntaxKind.CommaToken &&
          expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken &&
          this.expression(expression.left)) ||
        this.expression(expression.right)
      );
    return false;
  }

  private declaration(node: ts.Node): boolean {
    const known = this.memo.get(node);
    if (known !== undefined) return known;
    if (this.pending.has(node)) return false;
    this.pending.add(node);
    let result = false;
    try {
      result = this.compute(node);
    } finally {
      this.pending.delete(node);
    }
    this.memo.set(node, result);
    return result;
  }

  private compute(node: ts.Node): boolean {
    if (ts.isVariableDeclaration(node))
      return (
        isShadowedRequireAlias(node) ||
        (!!node.initializer && this.expression(node.initializer)) ||
        (ts.isIdentifier(node.name) && this.assigned(node.name))
      );
    if (ts.isBindingElement(node)) {
      if (isShadowedRequireAlias(node)) return true;
      let root: ts.Node = node;
      while (
        ts.isBindingElement(root) ||
        ts.isObjectBindingPattern(root) ||
        ts.isArrayBindingPattern(root)
      )
        root = root.parent;
      return (
        ts.isVariableDeclaration(root) &&
        !!root.initializer &&
        this.expression(root.initializer)
      );
    }
    if (ts.isExportAssignment(node)) return this.expression(node.expression);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      return this.expression(node.right);
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isBinaryExpression(node.parent) &&
      node.parent.left === node
    )
      return this.expression(node.parent.right);
    if (ts.isShorthandPropertyAssignment(node)) {
      const value = this.checker.getShorthandAssignmentValueSymbol(node);
      return !!value && this.symbol(value);
    }
    if (ts.isPropertyAssignment(node)) return this.expression(node.initializer);
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    )
      return this.returns(node);
    return false;
  }

  /** Whether a function can return a shadowed-require value. */
  private returns(node: ts.FunctionLikeDeclaration): boolean {
    const body = node.body;
    if (!body) return false;
    if (!ts.isBlock(body)) return this.expression(body);
    let found = false;
    const visit = (child: ts.Node): void => {
      if (found || ts.isFunctionLike(child)) return;
      if (
        ts.isReturnStatement(child) &&
        child.expression &&
        this.expression(child.expression)
      )
        found = true;
      else ts.forEachChild(child, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  }

  /** Whether any plain assignment `name = value` in a captured JS file stores such a value. */
  private assigned(name: ts.Identifier): boolean {
    if (!this.assignments) {
      const map = new Map<ts.Symbol, ts.Expression[]>();
      this.assignments = map;
      for (const file of this.files()) {
        const visit = (node: ts.Node): void => {
          if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(node.left)
          ) {
            const symbol = this.checker.getSymbolAtLocation(node.left);
            if (symbol)
              map.set(symbol, [...(map.get(symbol) ?? []), node.right]);
          }
          ts.forEachChild(node, visit);
        };
        visit(file);
      }
    }
    const symbol = this.checker.getSymbolAtLocation(name);
    return (
      !!symbol &&
      (this.assignments.get(symbol) ?? []).some((value) =>
        this.expression(value),
      )
    );
  }
}
