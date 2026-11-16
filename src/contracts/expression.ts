// SPDX-License-Identifier: MIT
import type { Expr } from "../language/ast.js";
import { assertNever } from "../shared/identity.js";

/** Display the parsed expression deterministically; do not reparse or evaluate it. */
export function contractExpression(expr: Expr): string {
  switch (expr.kind) {
    case "literal":
      return expr.value === null
        ? "unit"
        : typeof expr.value === "string"
          ? JSON.stringify(expr.value)
          : String(expr.value);
    case "name":
      return expr.name;
    case "field":
      return `${contractExpression(expr.base)}.${expr.name}`;
    case "call":
      return `${expr.name}(${expr.args
        .map(
          (arg) =>
            `${arg.mode === "value" ? "" : arg.mode + " "}${contractExpression(arg.expr)}`,
        )
        .join(", ")})`;
    case "record":
      return `${expr.name} { ${expr.fields
        .map((field) => `${field.name}: ${contractExpression(field.value)}`)
        .join(", ")} }`;
    case "list":
      return `[${expr.items.map(contractExpression).join(", ")}]`;
    case "unary":
      return `(${expr.op}${contractExpression(expr.expr)})`;
    case "binary":
      return `(${contractExpression(expr.left)} ${expr.op} ${contractExpression(expr.right)})`;
    case "unknown":
      return `unknown ${JSON.stringify(expr.reason)}`;
    default:
      return assertNever(expr);
  }
}
