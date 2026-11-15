export type Scalar = bigint | boolean | string | null;
export function unary(op: string, v: Scalar): Scalar {
  if (op === "!" && typeof v === "boolean") return !v;
  if (op === "-" && typeof v === "bigint") return -v;
  throw Error(`Invalid unary operand ${op}`);
}
export function binary(op: string, a: Scalar, b: Scalar): Scalar {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "&&":
      if (typeof a === "boolean" && typeof b === "boolean") return a && b;
      break;
    case "||":
      if (typeof a === "boolean" && typeof b === "boolean") return a || b;
      break;
    case "+":
      if (typeof a === "bigint" && typeof b === "bigint") return a + b;
      break;
    case "-":
      if (typeof a === "bigint" && typeof b === "bigint") return a - b;
      break;
    case "*":
      if (typeof a === "bigint" && typeof b === "bigint") return a * b;
      break;
    case "<":
      if (typeof a === "bigint" && typeof b === "bigint") return a < b;
      break;
    case "<=":
      if (typeof a === "bigint" && typeof b === "bigint") return a <= b;
      break;
    case ">":
      if (typeof a === "bigint" && typeof b === "bigint") return a > b;
      break;
    case ">=":
      if (typeof a === "bigint" && typeof b === "bigint") return a >= b;
      break;
  }
  throw Error(`Invalid operands for ${op}`);
}
/** Binary operators the shared scalar evaluator (and so the built-in engine) accepts. */
export const scalarBinaryOperators: ReadonlySet<string> = new Set([
  "+",
  "-",
  "*",
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "&&",
  "||",
]);
