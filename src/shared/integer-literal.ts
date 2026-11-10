import type { Expr } from "../language/ast.js";

/** The parser represents negative integers as unary expressions. Keep exact bounds. */
export function signedIntegerLiteral(expr: Expr): bigint | null {
  if (expr.kind === "literal" && typeof expr.value === "bigint")
    return expr.value;
  if (expr.kind === "unary" && expr.op === "-") {
    const value = signedIntegerLiteral(expr.expr);
    return value === null ? null : -value;
  }
  return null;
}
