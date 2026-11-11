import ts from "typescript";
import type { SourceRange } from "../../types.js";

/**
 * Which compiler nodes are graph symbols. Every function here is purely
 * syntactic and position-based so that any Program's copy of a declaration maps
 * to the same symbol key, whichever project analysed the referring file.
 */
export const isJsFile = (file: ts.SourceFile) =>
  /\.(c|m)?jsx?$/.test(file.fileName);

/** Identifier or dotted identifier chain: the compiler treats these as aliases in export positions. */
export const isEntityName = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) ||
  (ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.name) &&
    isEntityName(node.expression));

export function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  return current;
}
const isStatementContainer = (node: ts.Node | undefined) =>
  !!node && (ts.isSourceFile(node) || ts.isModuleBlock(node));
const isFunctionLike = (expression: ts.Expression | undefined) =>
  !!expression &&
  (ts.isArrowFunction(unwrap(expression)) ||
    ts.isFunctionExpression(unwrap(expression)));

export function isRequireCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]!)
  );
}

// The checker of the program being extracted. Module-system names (`require`,
// `module`, `exports`) are judged with it, so symbol extraction and link
// extraction agree on whether a construct is CommonJS.
let oracle: ts.TypeChecker | undefined;
export function withChecker<T>(checker: ts.TypeChecker, run: () => T): T {
  const previous = oracle;
  oracle = checker;
  try {
    return run();
  } finally {
    oracle = previous;
  }
}
/**
 * Whether an identifier means the module system's global, following the
 * compiler's own `isCommonJsRequire` rule: no binding, or only ambient
 * declarations. A local function, parameter, variable or import of that name
 * shadows it.
 */
export function isModuleGlobal(identifier: ts.Identifier): boolean {
  if (!oracle) return true;
  const symbol = oracle.getSymbolAtLocation(identifier);
  if (!symbol) return true;
  if (symbol.flags & ts.SymbolFlags.Alias) return false;
  const declarations = symbol.declarations ?? [];
  return (
    !declarations.length ||
    declarations.some((declaration) => {
      if (declaration.getSourceFile().isDeclarationFile) return true;
      for (
        let node: ts.Node | undefined = declaration;
        node;
        node = node.parent
      )
        if (
          ts.canHaveModifiers(node) &&
          ts
            .getModifiers(node)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
        )
          return true;
      return false;
    })
  );
}
/** A `require("literal")` call in a JavaScript file that means CommonJS. */
export const isCommonJsRequire = (node: ts.Node): boolean =>
  isRequireCall(node) &&
  isJsFile(node.getSourceFile()) &&
  isModuleGlobal(node.expression as ts.Identifier);
/** The require call a variable is initialised from (`require(x)`, `require(x).y`), if any. */
export function requireInitializer(
  declaration: ts.VariableDeclaration,
): ts.CallExpression | undefined {
  if (!declaration.initializer || !isJsFile(declaration.getSourceFile()))
    return undefined;
  let value = unwrap(declaration.initializer);
  while (ts.isPropertyAccessExpression(value)) value = value.expression;
  return isRequireCall(value) ? value : undefined;
}
const requireAlias = (declaration: ts.VariableDeclaration) => {
  const call = requireInitializer(declaration);
  return !!call && isCommonJsRequire(call);
};
/**
 * The compiler binds `const x = require("m")` as an alias even when `require`
 * is a local function. Such a declaration is an ordinary variable here, so alias
 * following must stop at it.
 */
export function isShadowedRequireAlias(declaration: ts.Node): boolean {
  const root = ts.isBindingElement(declaration)
    ? rootDeclaration(declaration)
    : ts.isVariableDeclaration(declaration)
      ? declaration
      : undefined;
  const call = root && requireInitializer(root);
  return !!call && !isCommonJsRequire(call);
}

/**
 * Whether a file binds `name` at its top level (which shadows the CommonJS
 * `module`/`exports` objects for top-level assignments). The checker resolves
 * these identifiers to export symbols, not to scope bindings, so this is a
 * syntactic check of the file's own declarations.
 */
function declaresAtTop(file: ts.SourceFile, name: string): boolean {
  const binds = (node: ts.BindingName): boolean =>
    ts.isIdentifier(node)
      ? node.text === name
      : node.elements.some(
          (element) => !ts.isOmittedExpression(element) && binds(element.name),
        );
  return file.statements.some((statement) => {
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.some((d) => binds(d.name));
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    )
      return statement.name?.text === name;
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const named = clause?.namedBindings;
      return (
        clause?.name?.text === name ||
        (!!named &&
          (ts.isNamespaceImport(named)
            ? named.name.text === name
            : named.elements.some((element) => element.name.text === name)))
      );
    }
    if (ts.isImportEqualsDeclaration(statement))
      return statement.name.text === name;
    return false;
  });
}
/** CommonJS export target text for `exports.x`, `module.exports.x` or `module.exports`. */
export function commonJsTarget(expression: ts.Expression): string | undefined {
  const isModuleExports = (node: ts.Expression) =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "module" &&
    node.name.text === "exports" &&
    !declaresAtTop(node.getSourceFile(), "module");
  if (isModuleExports(expression)) return "module.exports";
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.name) &&
    ((ts.isIdentifier(expression.expression) &&
      expression.expression.text === "exports" &&
      !declaresAtTop(expression.getSourceFile(), "exports")) ||
      isModuleExports(expression.expression))
  )
    return expression.name.text;
  return undefined;
}
function commonJsAssignment(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isExpressionStatement(node.parent) &&
    ts.isSourceFile(node.parent.parent) &&
    isJsFile(node.getSourceFile()) &&
    commonJsTarget(node.left) !== undefined &&
    // `module.exports = name` is an alias of `name`, not a new declaration.
    !(
      commonJsTarget(node.left) === "module.exports" &&
      isEntityName(unwrap(node.right))
    )
  );
}
function rootDeclaration(
  node: ts.BindingElement,
): ts.VariableDeclaration | undefined {
  let current: ts.Node = node;
  while (
    ts.isBindingElement(current) ||
    ts.isObjectBindingPattern(current) ||
    ts.isArrayBindingPattern(current)
  )
    current = current.parent;
  return ts.isVariableDeclaration(current) ? current : undefined;
}
function eligibleVariable(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  return (
    ts.isVariableDeclarationList(list) &&
    ts.isVariableStatement(list.parent) &&
    isStatementContainer(list.parent.parent) &&
    !requireAlias(declaration)
  );
}
/** The anchored declaration that holds an expression (variable, default export, CommonJS export). */
function holderOf(expression: ts.Node): ts.Node | undefined {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent)
  )
    current = current.parent;
  const parent = current.parent;
  if (
    (ts.isVariableDeclaration(parent) && parent.initializer === current) ||
    (ts.isExportAssignment(parent) && parent.expression === current) ||
    (ts.isBinaryExpression(parent) && parent.right === current)
  )
    return anchorOf(parent) === parent ? parent : undefined;
  return undefined;
}

type Member =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.MethodSignature
  | ts.ConstructorDeclaration;
const isOverloadable = (node: ts.Node): node is Member =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isMethodSignature(node) ||
  ts.isConstructorDeclaration(node);
const isStatic = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
function siblings(node: ts.Node): readonly ts.Node[] {
  const parent = node.parent;
  if (ts.isSourceFile(parent) || ts.isModuleBlock(parent) || ts.isBlock(parent))
    return parent.statements;
  if (
    ts.isClassLike(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeLiteralNode(parent) ||
    ts.isObjectLiteralExpression(parent)
  )
    return ts.isObjectLiteralExpression(parent)
      ? parent.properties
      : parent.members;
  return [node];
}
const sameGroup = (a: ts.Node, b: ts.Node) =>
  a.kind === b.kind &&
  isOverloadable(a) &&
  isOverloadable(b) &&
  isStatic(a) === isStatic(b) &&
  (ts.isConstructorDeclaration(a) ||
    (!!a.name && !!b.name && a.name.getText() === b.name.getText()));
const bodiless = (node: ts.Node) =>
  ts.isMethodSignature(node) ||
  (isOverloadable(node) && !(node as { body?: ts.Node }).body);
/** First declaration of an overload set: preceding bodiless signatures with the same name. */
function overloadGroup(node: Member): { head: Member; tail: Member } {
  const list = siblings(node);
  let index = list.indexOf(node);
  while (
    index > 0 &&
    sameGroup(list[index - 1]!, node) &&
    bodiless(list[index - 1]!)
  )
    index--;
  const head = list[index] as Member;
  let end = index;
  while (
    end + 1 < list.length &&
    bodiless(list[end]!) &&
    sameGroup(list[end + 1]!, node)
  )
    end++;
  return { head, tail: list[end] as Member };
}

/** Canonical symbol node for a declaration, or undefined when it is not a graph symbol. */
export function anchorOf(node: ts.Node): ts.Node | undefined {
  if (ts.isSourceFile(node)) return node;
  if (ts.isParameter(node)) {
    // Constructor parameter properties (`constructor(public cb: T)`) are class properties.
    const owner = node.parent.parent;
    if (
      !ts.isParameterPropertyDeclaration(node, node.parent) ||
      !ts.isIdentifier(node.name) ||
      !owner
    )
      return undefined;
    return (
      ts.isClassDeclaration(owner)
        ? anchorOf(owner) === owner
        : ts.isClassExpression(owner) && !!holderOf(owner)
    )
      ? node
      : undefined;
  }
  const parent = node.parent;
  if (!parent) return undefined;
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isBinaryExpression(parent) &&
    parent.left === node
  )
    return anchorOf(parent);
  if (ts.isFunctionDeclaration(node))
    return isStatementContainer(parent) ? overloadGroup(node).head : undefined;
  if (
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  )
    return isStatementContainer(parent) ? node : undefined;
  if (ts.isModuleDeclaration(node))
    return isStatementContainer(parent) || ts.isModuleDeclaration(parent)
      ? node
      : undefined;
  if (ts.isVariableDeclaration(node))
    return ts.isIdentifier(node.name) && eligibleVariable(node)
      ? node
      : undefined;
  if (ts.isBindingElement(node)) {
    const root = rootDeclaration(node);
    return ts.isIdentifier(node.name) && root && eligibleVariable(root)
      ? node
      : undefined;
  }
  if (ts.isExportAssignment(node))
    return isStatementContainer(parent) &&
      !isEntityName(unwrap(node.expression))
      ? node
      : undefined;
  if (ts.isBinaryExpression(node))
    return commonJsAssignment(node) ? node : undefined;
  if (
    ts.isClassExpression(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isObjectLiteralExpression(node)
  )
    return holderOf(node);
  if (ts.isEnumMember(node))
    return anchorOf(parent) === parent ? node : undefined;
  if (
    ts.isMethodSignature(node) ||
    ts.isPropertySignature(node) ||
    ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
      ts.isInterfaceDeclaration(parent))
  )
    return ts.isInterfaceDeclaration(parent) && anchorOf(parent) === parent
      ? ts.isMethodSignature(node)
        ? overloadGroup(node).head
        : node
      : undefined;
  if (
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isPropertyAssignment(node)
  ) {
    if (ts.isObjectLiteralExpression(parent)) {
      // Only callable members of a module-level object literal are symbols.
      if (
        ts.isConstructorDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        (ts.isPropertyAssignment(node) && !isFunctionLike(node.initializer))
      )
        return undefined;
      return holderOf(parent) ? node : undefined;
    }
    if (!ts.isClassLike(parent) || ts.isPropertyAssignment(node))
      return undefined;
    const owner = ts.isClassDeclaration(parent)
      ? anchorOf(parent) === parent
      : !!holderOf(parent);
    if (!owner) return undefined;
    return ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
      ? overloadGroup(node).head
      : node;
  }
  return undefined;
}

export function kindOf(anchor: ts.Node): string {
  if (ts.isSourceFile(anchor)) return "module";
  if (ts.isFunctionDeclaration(anchor)) return "function";
  if (ts.isClassDeclaration(anchor)) return "class";
  if (ts.isInterfaceDeclaration(anchor)) return "interface";
  if (ts.isTypeAliasDeclaration(anchor)) return "type";
  if (ts.isEnumDeclaration(anchor)) return "enum";
  if (ts.isEnumMember(anchor)) return "enum-member";
  if (ts.isModuleDeclaration(anchor)) return "namespace";
  if (ts.isConstructorDeclaration(anchor)) return "constructor";
  if (ts.isGetAccessorDeclaration(anchor)) return "getter";
  if (ts.isSetAccessorDeclaration(anchor)) return "setter";
  if (ts.isMethodDeclaration(anchor) || ts.isMethodSignature(anchor))
    return "method";
  if (ts.isPropertyAssignment(anchor))
    return isFunctionLike(anchor.initializer) ? "method" : "property";
  if (
    ts.isPropertyDeclaration(anchor) ||
    ts.isPropertySignature(anchor) ||
    ts.isParameter(anchor)
  )
    return "property";
  const value = ts.isVariableDeclaration(anchor)
    ? anchor.initializer
    : ts.isExportAssignment(anchor)
      ? anchor.expression
      : ts.isBinaryExpression(anchor)
        ? anchor.right
        : undefined;
  if (value && isFunctionLike(value)) return "function";
  if (value && ts.isClassExpression(unwrap(value))) return "class";
  if (ts.isVariableDeclaration(anchor) || ts.isBindingElement(anchor)) {
    const root = ts.isVariableDeclaration(anchor)
      ? anchor
      : rootDeclaration(anchor)!;
    return (root.parent as ts.VariableDeclarationList).flags &
      (ts.NodeFlags.Const | ts.NodeFlags.Using)
      ? "constant"
      : "variable";
  }
  return "constant";
}

function memberName(name: ts.PropertyName): string {
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  if (ts.isStringLiteralLike(name)) return JSON.stringify(name.text);
  return name.getText().replace(/\s+/g, " ");
}
export function nameOf(anchor: ts.Node): string {
  if (ts.isSourceFile(anchor)) return anchor.fileName.slice(1);
  if (ts.isConstructorDeclaration(anchor)) return "constructor";
  if (ts.isExportAssignment(anchor))
    return anchor.isExportEquals ? "export=" : "default";
  if (ts.isBinaryExpression(anchor)) return commonJsTarget(anchor.left)!;
  if (ts.isModuleDeclaration(anchor))
    return anchor.flags & ts.NodeFlags.GlobalAugmentation
      ? "global"
      : ts.isStringLiteral(anchor.name)
        ? JSON.stringify(anchor.name.text)
        : anchor.name.text;
  const name = (anchor as ts.NamedDeclaration).name;
  if (!name) return "default";
  if (ts.isIdentifier(name)) return name.text;
  return memberName(name as ts.PropertyName);
}

/** The anchored container that qualifies this symbol's identity, or the source file. */
export function containerOf(anchor: ts.Node): ts.Node | undefined {
  if (ts.isSourceFile(anchor)) return undefined;
  if (ts.isParameter(anchor)) {
    const owner = anchor.parent.parent;
    return ts.isClassExpression(owner) ? holderOf(owner) : owner;
  }
  let statement: ts.Node = anchor;
  if (ts.isBindingElement(anchor))
    statement = rootDeclaration(anchor)!.parent.parent;
  else if (ts.isVariableDeclaration(anchor)) statement = anchor.parent.parent;
  else if (ts.isBinaryExpression(anchor)) statement = anchor.parent;
  const parent = statement.parent;
  if (ts.isSourceFile(parent)) return parent;
  if (ts.isModuleBlock(parent)) return parent.parent;
  if (ts.isModuleDeclaration(parent)) return parent;
  if (ts.isClassExpression(parent) || ts.isObjectLiteralExpression(parent))
    return holderOf(parent);
  return parent;
}
export function identityOf(anchor: ts.Node): string {
  if (ts.isSourceFile(anchor)) return nameOf(anchor);
  const container = containerOf(anchor);
  const prefix =
    !container || ts.isSourceFile(container) ? "" : identityOf(container) + ".";
  return prefix + (isStatic(anchor) ? "static " : "") + nameOf(anchor);
}
export function rangeOf(anchor: ts.Node): SourceRange {
  const file = anchor.getSourceFile();
  if (ts.isSourceFile(anchor)) return { start: 0, end: anchor.text.length };
  if (
    ts.isVariableDeclaration(anchor) &&
    ts.isVariableDeclarationList(anchor.parent) &&
    anchor.parent.declarations.length === 1
  ) {
    const statement = anchor.parent.parent;
    return { start: statement.getStart(file), end: statement.end };
  }
  if (isOverloadable(anchor))
    return {
      start: anchor.getStart(file),
      end: overloadGroup(anchor).tail.end,
    };
  return { start: anchor.getStart(file), end: anchor.end };
}
export const keyOf = (anchor: ts.Node) =>
  `${kindOf(anchor)}@${rangeOf(anchor).start}`;
