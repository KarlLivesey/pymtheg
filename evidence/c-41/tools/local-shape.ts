// SPDX-License-Identifier: MIT
// C-41 diagnostic only (not shipped): what kind of declaration a `local`
// link's checker answer is, and where its containing literal lives.
import ts from "typescript";
import { anchorOf, objectMember } from "./symbols.js";

const moduleLevel = (node: ts.Node) =>
  ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent);

/** Unwraps parentheses, `as`, `satisfies` and `!` around an expression. */
function outer(node: ts.Node): ts.Node {
  let at = node;
  while (
    ts.isParenthesizedExpression(at.parent) ||
    ts.isAsExpression(at.parent) ||
    ts.isSatisfiesExpression(at.parent) ||
    ts.isNonNullExpression(at.parent) ||
    ts.isTypeAssertionExpression(at.parent)
  )
    at = at.parent;
  return at;
}

/** Where the outermost literal around a member lives. */
function whereOf(member: ts.Node): string {
  // Walk out through nested members of literals.
  let literal: ts.Node = member.parent;
  for (;;) {
    const value = outer(literal);
    const holder = value.parent;
    if (
      (ts.isPropertyAssignment(holder) &&
        ts.isObjectLiteralExpression(holder.parent)) ||
      ((ts.isPropertySignature(holder) || ts.isPropertyDeclaration(holder)) &&
        ts.isTypeLiteralNode(holder.parent))
    ) {
      literal = holder.parent;
      continue;
    }
    if (ts.isArrayLiteralExpression(holder) || ts.isSpreadElement(holder)) {
      literal = holder;
      continue;
    }
    const constant = /\bas\s+const\s*$/.test(value.getText());
    const inFunction = !!ts.findAncestor(holder, (node) =>
      ts.isFunctionLike(node) && !ts.isTypeNode(node),
    );
    let place: string;
    if (ts.isVariableDeclaration(holder)) {
      const statement = holder.parent.parent;
      place =
        ts.isVariableStatement(statement) && moduleLevel(statement)
          ? statement.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.ExportKeyword,
            )
            ? "initialiser of an exported module-level declaration"
            : "initialiser of a module-level declaration"
          : "initialiser of a variable inside a function";
    } else if (ts.isReturnStatement(holder) || ts.isArrowFunction(holder))
      place = "a returned literal";
    else if (ts.isCallExpression(holder) || ts.isNewExpression(holder))
      place = inFunction
        ? "an argument to a call, inside a function"
        : "an argument to a call, at module level";
    else if (ts.isExportAssignment(holder)) place = "export default";
    else if (
      ts.isTypeAliasDeclaration(holder) ||
      ts.isInterfaceDeclaration(holder)
    )
      place = moduleLevel(holder)
        ? "type of a module-level declaration"
        : "type declared inside a function";
    else if (ts.isTypeNode(holder) || ts.isParameter(holder))
      place = inFunction
        ? "a type annotation inside a function or signature"
        : "a type annotation at module level";
    else if (ts.isBinaryExpression(holder))
      place = inFunction ? "an assignment inside a function" : "an assignment at module level";
    else place = `other (${ts.SyntaxKind[holder.kind]})`;
    return constant ? `${place}, as const` : place;
  }
}

/** The shape of one declaration a `local` link's answer has. */
export function localShape(declaration: ts.Node, call: boolean): string {
  const parent = declaration.parent;
  let kind: string;
  if (
    ts.isObjectLiteralExpression(parent) &&
    (ts.isPropertyAssignment(declaration) ||
      ts.isShorthandPropertyAssignment(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isGetAccessorDeclaration(declaration) ||
      ts.isSetAccessorDeclaration(declaration))
  )
    kind = ts.isShorthandPropertyAssignment(declaration)
      ? "object literal: shorthand"
      : ts.isPropertyAssignment(declaration)
        ? "object literal: property"
        : "object literal: method or accessor";
  else if (
    ts.isTypeLiteralNode(parent) &&
    (ts.isPropertySignature(declaration) || ts.isMethodSignature(declaration))
  )
    kind = ts.isMethodSignature(declaration)
      ? "type literal: method signature"
      : "type literal: property signature";
  else if (ts.isMappedTypeNode(declaration) || ts.isMappedTypeNode(parent))
    return "mapped type";
  else if (ts.isParameter(declaration)) return "parameter";
  else if (ts.isBindingElement(declaration)) return "destructured binding";
  else if (ts.isVariableDeclaration(declaration)) return "local variable";
  else if (ts.isFunctionDeclaration(declaration)) return "local function";
  else if (
    (ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration))
  )
    return "function expression";
  else if (
    ts.isClassExpression(parent) ||
    (ts.isClassDeclaration(parent) && !anchorOf(parent))
  )
    return "member of a class expression or local class";
  else return `other (${ts.SyntaxKind[declaration.kind]})`;
  const symbol = objectMember(declaration);
  const why = symbol
    ? call
      ? "has a member symbol, refused for a call"
      : "has a member symbol"
    : "no member symbol";
  return `${kind} | ${whereOf(declaration)} | ${why}`;
}
