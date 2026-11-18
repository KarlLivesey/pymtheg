// SPDX-License-Identifier: MIT
import ts from "typescript";
import { createHash } from "node:crypto";
import type { SourceRange, SymbolDraft } from "../../types.js";

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

/**
 * A `require("literal")` call in a JavaScript file. Locally bound `require`
 * names never reach the compiler (rename.ts renames them), so every remaining
 * one is the CommonJS loader or a `createRequire` result.
 */
export const isCommonJsRequire = (node: ts.Node): boolean =>
  isRequireCall(node) && isJsFile(node.getSourceFile());
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
/** CommonJS export target text for `exports.x`, `module.exports.x` or `module.exports`. */
export function commonJsTarget(expression: ts.Expression): string | undefined {
  const isModuleExports = (node: ts.Expression) =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "module" &&
    node.name.text === "exports";
  if (isModuleExports(expression)) return "module.exports";
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.name) &&
    ((ts.isIdentifier(expression.expression) &&
      expression.expression.text === "exports") ||
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
/**
 * The variable declaration a destructured name belongs to, climbing only
 * through binding patterns; undefined for a destructured PARAMETER (or any
 * other holder), so a caller never walks past the pattern.
 */
export function rootDeclaration(
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
function localFunctionInitializer(node: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(node.parent) &&
    !!(node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) &&
    isFunctionLike(node.initializer)
  );
}

export const isScopedDeclaration = (node: ts.Node) =>
  isLocalCallable(node) ||
  (ts.isEnumDeclaration(node) && !isStatementContainer(node.parent));

/** These declarations were previously absent from the graph. */
export function isLocalCallable(node: ts.Node): boolean {
  return (
    ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      !isStatementContainer(node.parent)) ||
    (ts.isVariableDeclaration(node) &&
      !eligibleVariable(node) &&
      localFunctionInitializer(node))
  );
}
function outerExpression(expression: ts.Node): ts.Node {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent)
  )
    current = current.parent;
  return current;
}

/** The anchored declaration that holds an expression (variable, default export, CommonJS export). */
function holderOf(expression: ts.Node): ts.Node | undefined {
  const current = outerExpression(expression);
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
      !ts.isIdentifier(node.name) ||
      !owner ||
      !ts.isParameterPropertyDeclaration(node, node.parent)
    )
      return undefined;
    return (
      ts.isClassDeclaration(owner)
        ? isStatementContainer(owner.parent) && anchorOf(owner) === owner
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
    return isStatementContainer(parent) || node.name
      ? overloadGroup(node).head
      : undefined;
  if (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node))
    return isStatementContainer(parent) || node.name ? node : undefined;
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    return isStatementContainer(parent) ? node : undefined;
  if (ts.isModuleDeclaration(node))
    return isStatementContainer(parent) || ts.isModuleDeclaration(parent)
      ? node
      : undefined;
  if (ts.isVariableDeclaration(node))
    return ts.isIdentifier(node.name) &&
      (eligibleVariable(node) || localFunctionInitializer(node))
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
    return isStatementContainer(parent.parent) && anchorOf(parent) === parent
      ? node
      : undefined;
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
      ? isStatementContainer(parent.parent) && anchorOf(parent) === parent
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
  const variable = ts.isBindingElement(anchor)
    ? rootDeclaration(anchor)
    : ts.isVariableDeclaration(anchor)
      ? anchor
      : undefined;
  if (variable && ts.isVariableDeclarationList(variable.parent))
    statement = variable.parent.parent;
  else if (ts.isBinaryExpression(anchor)) statement = anchor.parent;
  const parent = statement.parent;
  if (ts.isSourceFile(parent)) return parent;
  if (ts.isModuleBlock(parent)) return parent.parent;
  if (ts.isModuleDeclaration(parent)) return parent;
  for (
    let current: ts.Node | undefined = parent;
    current;
    current = current.parent
  ) {
    const container = anchorOf(current);
    if (container) return container;
  }
  return anchor.getSourceFile();
}

/** Position-independent syntax outside an anonymous function's body. */
function callbackSite(node: ts.FunctionLikeDeclaration): unknown[] {
  const argument = outerExpression(node);
  const parent = argument.parent;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const position = parent.arguments?.findIndex((item) => item === argument);
    if (position !== undefined && position >= 0)
      return [
        parent.expression.getText(),
        position,
        parent.arguments!.map((item) =>
          isFunctionLike(item) ? null : item.getText(),
        ),
      ];
  }
  if (ts.isPropertyAssignment(parent)) return [parent.name.getText()];
  return [ts.SyntaxKind[parent.kind]];
}

const scopeKey = (parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

function blockSite(block: ts.Block): unknown[] {
  const parent = block.parent;
  const kind = ts.SyntaxKind[parent.kind];
  if (ts.isIfStatement(parent))
    return [
      kind,
      parent.expression.getText(),
      parent.thenStatement === block ? "then" : "else",
    ];
  if (ts.isForStatement(parent))
    return [
      kind,
      parent.initializer?.getText(),
      parent.condition?.getText(),
      parent.incrementor?.getText(),
    ];
  if (ts.isForOfStatement(parent) || ts.isForInStatement(parent))
    return [kind, parent.initializer.getText(), parent.expression.getText()];
  if (
    ts.isWhileStatement(parent) ||
    ts.isDoStatement(parent) ||
    ts.isWithStatement(parent)
  )
    return [kind, parent.expression.getText()];
  if (ts.isCatchClause(parent))
    return [kind, parent.variableDeclaration?.getText()];
  if (ts.isTryStatement(parent))
    return [kind, parent.tryBlock === block ? "try" : "finally"];
  if (ts.isLabeledStatement(parent)) return [kind, parent.label.text];
  return [kind];
}

function scopeOf(anchor: ts.Node, owner: ts.Node | undefined): string {
  const parts: string[] = [];
  for (
    let node: ts.Node | undefined = anchor.parent;
    node && node !== owner;
    node = node.parent
  ) {
    if (ts.isFunctionLike(node) && anchorOf(node) === owner) break;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      parts.push(
        `[callback:${scopeKey([node.name?.text, node.parameters.map((p) => p.getText()), ...callbackSite(node)])}]`,
      );
    } else if (ts.isBlock(node) && !ts.isFunctionLike(node.parent)) {
      // Keep the branch or loop header in the identity. Bare blocks can
      // share a key, so requirement links verify multiplicity separately.
      parts.push(`[block:${scopeKey(blockSite(node))}]`);
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      parts.push(
        `[case:${scopeKey([ts.isCaseClause(node) ? node.expression.getText() : null])}]`,
      );
    }
  }
  return parts.length ? parts.reverse().join(".") + "." : "";
}

export function identityOf(anchor: ts.Node): string {
  if (ts.isSourceFile(anchor)) return nameOf(anchor);
  const container = containerOf(anchor);
  const prefix =
    !container || ts.isSourceFile(container) ? "" : identityOf(container) + ".";
  const scope = isScopedDeclaration(anchor)
    ? scopeOf(anchor, container) || "[local]."
    : "";
  return prefix + scope + (isStatic(anchor) ? "static " : "") + nameOf(anchor);
}
export function rangeOf(anchor: ts.Node): SourceRange {
  const file = anchor.getSourceFile();
  if (ts.isSourceFile(anchor)) return { start: 0, end: anchor.text.length };
  if (
    ts.isVariableDeclaration(anchor) &&
    ts.isVariableDeclarationList(anchor.parent) &&
    ts.isVariableStatement(anchor.parent.parent) &&
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

/** The existing graph owner of a declaration without its own symbol. */
export function enclosingAnchor(node: ts.Node): ts.Node {
  for (let parent = node.parent; parent; parent = parent.parent) {
    const anchor = anchorOf(parent);
    if (anchor) return anchor;
  }
  return node.getSourceFile();
}

/** A static object member in a named binding or a declaration's return value. */
export function objectMember(node: ts.Node): SymbolDraft | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  const literal = ts.isObjectLiteralExpression(parent);
  if (
    !(literal
      ? ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
      : ts.isTypeLiteralNode(parent) &&
        (ts.isPropertySignature(node) || ts.isMethodSignature(node))) ||
    anchorOf(node)
  )
    return undefined;
  const names: string[] = [];
  let member = node;
  let object = parent;
  let holder: ts.Node;
  for (;;) {
    const name = (member as ts.NamedDeclaration).name as ts.PropertyName;
    if (
      ts.isComputedPropertyName(name) &&
      !ts.isStringLiteralLike(name.expression) &&
      !ts.isNumericLiteral(name.expression)
    )
      return undefined;
    names.unshift(memberName(name));
    holder = (literal ? outerExpression(object) : object).parent;
    if (
      (ts.isPropertyAssignment(holder) &&
        ts.isObjectLiteralExpression(holder.parent)) ||
      (ts.isPropertySignature(holder) && ts.isTypeLiteralNode(holder.parent))
    ) {
      member = holder;
      object = holder.parent;
    } else break;
  }
  let owner = anchorOf(holder);
  let slot = "";
  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
    if (!owner) {
      owner = enclosingAnchor(holder);
      slot = `${scopeOf(holder, owner)}[local].${holder.name.text}.`;
    }
  } else if (literal && ts.isReturnStatement(holder)) {
    const signature = ts.findAncestor(holder, ts.isFunctionLike);
    if (!signature || !(owner = anchorOf(signature))) return undefined;
    slot = `${scopeOf(holder, signature)}[return].`;
  } else if (literal && ts.isArrowFunction(holder)) {
    if (!owner) return undefined;
    slot = "[return].";
  }
  if (!owner || ts.isSourceFile(owner)) return undefined;
  const kind = ts.isShorthandPropertyAssignment(node)
    ? "property"
    : kindOf(node);
  const range = { start: node.getStart(), end: node.end };
  return {
    key: `${kind}@${range.start}`,
    kind,
    name: names.at(-1)!,
    identity: `${identityOf(owner)}.${slot}[${literal ? "object" : "type"}].${names.join(".")}`,
    range,
    data: { scoped: true },
  };
}

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
