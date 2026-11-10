import type { Expr } from "../language/ast.js";
import { unary, binary, type Scalar } from "./operators.js";

/** Shared exact scalar expression semantics for constant checks and source replay. */
export function evaluateScalar(e: Expr, state: Record<string, Scalar>): Scalar {
  switch (e.kind) {
    case "literal":
      return e.value;
    case "name":
      if (!Object.hasOwn(state, e.name))
        throw Error(`Missing source state ${e.name}`);
      return state[e.name]!;
    case "unary":
      return unary(e.op, evaluateScalar(e.expr, state));
    case "binary": {
      const a = evaluateScalar(e.left, state);
      if (e.op === "&&" && a === false) return false;
      if (e.op === "||" && a === true) return true;
      return binary(e.op, a, evaluateScalar(e.right, state));
    }
    default:
      throw Error(`Unsupported behavioural expression ${e.kind}`);
  }
}
