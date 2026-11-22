// SPDX-License-Identifier: MIT
/**
 * C-41: when a call on a member of a type literal may link to that member.
 *
 * The checker's declaration for `receiver.member` names the literal the
 * receiver's type came from. When that type was computed from expressions
 * (`cond ? one : two`, an inferred return), the checker may have reduced a
 * union of structurally identical literals to the first one, and the
 * declaration list then omits the others. A type written on the receiver's
 * own declaration is never reduced so. So the call links to the member only
 * when the receiver's declaration writes a type that holds that literal:
 * directly, through type aliases, parentheses, `readonly`, an intersection
 * or a written union (which the checker does not reduce). An inferred type,
 * or a receiver with several declarations: no.
 */
import ts from "typescript";
import { unwrap } from "./symbols.js";

/** Aliases and type positions followed before giving up (counted). */
const DEPTH = 16;

/** The type nodes written for the value `expression` denotes, if exactly known. */
function writtenTypes(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): ts.TypeNode[] | undefined {
  const value = unwrap(expression);
  if (ts.isNonNullExpression(value)) return writtenTypes(checker, value.expression);
  if (ts.isCallExpression(value)) {
    const declaration = checker.getResolvedSignature(value)?.declaration;
    return declaration && !ts.isJSDocSignature(declaration) && declaration.type
      ? [declaration.type]
      : undefined;
  }
  const name = ts.isPropertyAccessExpression(value)
    ? value.name
    : ts.isIdentifier(value)
      ? value
      : undefined;
  if (!name) return undefined;
  let symbol = checker.getSymbolAtLocation(name);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  const declarations = symbol?.declarations ?? [];
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0]!;
  const type =
    ts.isVariableDeclaration(declaration) ||
    ts.isParameter(declaration) ||
    ts.isPropertySignature(declaration) ||
    ts.isPropertyDeclaration(declaration)
      ? declaration.type
      : undefined;
  return type ? [type] : undefined;
}

/** Whether the written type `node` holds the type literal `literal`. */
function holds(
  checker: ts.TypeChecker,
  node: ts.TypeNode,
  literal: ts.TypeLiteralNode,
  depth: number,
): boolean {
  if (depth > DEPTH) return false;
  if (node === literal) return true;
  if (ts.isParenthesizedTypeNode(node))
    return holds(checker, node.type, literal, depth + 1);
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword)
    return holds(checker, node.type, literal, depth + 1);
  // A written union is not reduced: the checker keeps a member of each arm.
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node))
    return node.types.some((part) => holds(checker, part, literal, depth + 1));
  if (ts.isTypeReferenceNode(node)) {
    let symbol = checker.getSymbolAtLocation(node.typeName);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declarations = symbol?.declarations ?? [];
    if (declarations.length !== 1) return false;
    const declaration = declarations[0]!;
    return (
      ts.isTypeAliasDeclaration(declaration) &&
      holds(checker, declaration.type, literal, depth + 1)
    );
  }
  return false;
}

/**
 * Whether a call on a member of `literal` through `receiver` may link to it:
 * the receiver's declaration writes a type that holds the literal, or the
 * member's literal is itself the written type of a member reached so.
 */
export function declaredLiteral(
  checker: ts.TypeChecker,
  receiver: ts.Expression | undefined,
  literal: ts.TypeLiteralNode,
): boolean {
  if (!receiver) return false;
  try {
    const types = writtenTypes(checker, receiver);
    return !!types?.length && types.every((type) => holds(checker, type, literal, 0));
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
