import { binary, unary, type Scalar } from "../shared/operators.js";
import { nodeKey, type Expr } from "../language/ast.js";
import type { ProjectIR } from "../semantic/core.js";
import { json } from "../shared/identity.js";
export type Value =
  | Scalar
  | Value[]
  | { tag: string; value: Value | null }
  | { record: string; fields: Record<string, Value> }
  | { resource: string };
export class EvaluationViolation extends Error {
  constructor(
    readonly code: "precondition" | "postcondition",
    message: string,
    readonly span: import("../shared/identity.js").Span,
  ) {
    super(message);
  }
}
export type Environment = Record<string, Value>;
const scalar = (v: Value): v is Scalar =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  typeof v === "bigint";
export function expressionValue(
  ir: ProjectIR,
  e: Expr,
  env: Environment,
  depth = 0,
): Value {
  if (depth > 128) throw Error("Pure evaluation depth exceeded");
  switch (e.kind) {
    case "literal":
      return e.value;
    case "name": {
      if (Object.hasOwn(env, e.name)) return env[e.name]!;
      const t = ir.info.get(nodeKey(e.span))?.type;
      if (t?.kind === "nominal" || t?.kind === "result")
        return { tag: e.name, value: null };
      throw Error(`Unbound value ${e.name}`);
    }
    case "unknown":
      throw Error(`Unknown value: ${e.reason}`);
    case "field": {
      const base = expressionValue(ir, e.base, env, depth + 1);
      if (Array.isArray(base) && e.name === "count") return BigInt(base.length);
      if (
        base &&
        typeof base === "object" &&
        !Array.isArray(base) &&
        "fields" in base &&
        Object.hasOwn(base.fields, e.name)
      )
        return base.fields[e.name]!;
      throw Error(`Invalid field ${e.name}`);
    }
    case "list":
      return e.items.map((item) => expressionValue(ir, item, env, depth + 1));
    case "record":
      return {
        record: e.name,
        fields: Object.fromEntries(
          e.fields.map((f) => [
            f.name,
            expressionValue(ir, f.value, env, depth + 1),
          ]),
        ),
      };
    case "unary": {
      const v = expressionValue(ir, e.expr, env, depth + 1);
      if (!scalar(v)) throw Error("Unary operand must be scalar");
      return unary(e.op, v);
    }
    case "binary": {
      const a = expressionValue(ir, e.left, env, depth + 1);
      if (e.op === "&&" && a === false) return false;
      if (e.op === "||" && a === true) return true;
      const b = expressionValue(ir, e.right, env, depth + 1);
      if (["==", "!="].includes(e.op) && (!scalar(a) || !scalar(b)))
        return e.op === "==" ? json(a) === json(b) : json(a) !== json(b);
      if (!scalar(a) || !scalar(b)) throw Error("Invalid binary values");
      return binary(e.op, a, b);
    }
    case "call": {
      const target = ir.info.get(nodeKey(e.span))?.target,
        d = target ? ir.symbols.get(target) : undefined;
      if (d?.kind === "rule" && d.expr) {
        const scope: Environment = Object.create(null) as Environment;
        d.params.forEach((p, i) => {
          const arg = e.args[i];
          if (!arg) throw Error("Missing pure argument");
          scope[p.name] = expressionValue(ir, arg.expr, env, depth + 1);
        });
        for (const pre of d.meta.requires)
          if (expressionValue(ir, pre, scope, depth + 1) !== true)
            throw new EvaluationViolation(
              "precondition",
              `Rule ${d.name} precondition failed`,
              e.span,
            );
        const result = expressionValue(ir, d.expr, scope, depth + 1);
        for (const post of d.meta.ensures)
          if (
            expressionValue(ir, post, { ...scope, result }, depth + 1) !== true
          )
            throw new EvaluationViolation(
              "postcondition",
              `Rule ${d.name} postcondition failed`,
              post.span,
            );
        return result;
      }
      if (!target)
        return {
          tag: e.name,
          value: e.args[0]
            ? expressionValue(ir, e.args[0].expr, env, depth + 1)
            : null,
        };
      throw Error(`Cannot evaluate effectful call ${e.name} as an expression`);
    }
  }
}
