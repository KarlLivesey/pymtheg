import type { Expr, Callable, TypeRef } from "../language/ast.js";
import { nodeKey, exprChildren } from "../language/ast.js";
import type { ProjectIR } from "../semantic/core.js";
export type Fact = (
  | {
      kind: "integer";
      min: bigint | null;
      max: bigint | null;
      excluded?: bigint[];
    }
  | { kind: "boolean"; value: boolean | null }
  | { kind: "unknown" }
) & {
  bindingId?: string;
  assumptions?: string[];
  predicate?: { expression: Expr; bindings: [string, Fact | undefined][] };
};
export type Facts = Map<string, Fact>;
export const unknown: Fact = { kind: "unknown" };
/** A local immutable Boolean alias may refine only the exact bindings it captured. */
export function rememberPredicate(
  value: Fact,
  expression: Expr,
  env: Facts,
): Fact {
  if (value.kind !== "boolean" || value.value !== null) return value;
  const names = new Set<string>();
  function visit(e: Expr) {
    if (e.kind === "name") names.add(e.name);
    for (const child of exprChildren(e)) visit(child);
  }
  visit(expression);
  return {
    ...value,
    predicate: {
      expression,
      bindings: [...names].map((name) => [name, env.get(name)]),
    },
  };
}
export function initialFacts(owner: Callable, ir?: ProjectIR): Facts {
  const facts: Facts = new Map();
  for (const p of owner.params)
    facts.set(p.name, {
      ...typeFact(p.type, owner.meta.bounds[p.name]),
      bindingId: nodeKey(p.span),
    });
  for (const pre of owner.meta.requires)
    ir ? refineResolved(ir, facts, pre, true) : refine(facts, pre, true);
  return facts;
}
export function typeFact(type: TypeRef, max: bigint | null = null): Fact {
  return type.name === "Bool"
    ? { kind: "boolean", value: null }
    : ["Nat", "Int"].includes(type.name)
      ? { kind: "integer", min: type.name === "Nat" ? 0n : null, max }
      : unknown;
}
// A path condition can itself depend on an assumed result, even if a later
// call uses only literals. Keep that dependency with the branch environment.
export const pathFact = "\0contract-path";
/** Interval proofs can establish safety without proving that a source path exists. */
export const conditionalPath = "\0contract-conditional-path";
const infeasibleFact = "\0contract-infeasible";
function markInfeasible(env: Facts): void {
  env.set(infeasibleFact, { kind: "integer", min: 1n, max: 0n });
}
export function expressionAssumptions(e: Expr, env: Facts): string[] {
  const found = new Set(env.get(pathFact)?.assumptions ?? []);
  function visit(node: Expr): void {
    if (node.kind === "name")
      for (const value of env.get(node.name)?.assumptions ?? [])
        found.add(value);
    for (const child of exprChildren(node)) visit(child);
  }
  visit(e);
  return [...found];
}
export type Affine = { constant: bigint; terms: Map<string, bigint> };
export function affine(
  e: Expr,
  substitute?: (expression: Expr) => Affine | null | undefined,
): Affine | null {
  const substituted = substitute?.(e);
  if (substituted !== undefined) return substituted;
  if (e.kind === "literal" && typeof e.value === "bigint")
    return { constant: e.value, terms: new Map() };
  if (e.kind === "name")
    return { constant: 0n, terms: new Map([[e.name, 1n]]) };
  if (e.kind === "unary" && e.op === "-") {
    const a = affine(e.expr, substitute);
    return a
      ? {
          constant: -a.constant,
          terms: new Map([...a.terms].map(([k, v]) => [k, -v])),
        }
      : null;
  }
  if (e.kind === "binary" && ["+", "-"].includes(e.op)) {
    const a = affine(e.left, substitute),
      b = affine(e.right, substitute);
    if (!a || !b) return null;
    const sign = e.op === "+" ? 1n : -1n,
      terms = new Map(a.terms);
    for (const [key, v] of b.terms)
      terms.set(key, (terms.get(key) ?? 0n) + sign * v);
    return { constant: a.constant + sign * b.constant, terms };
  }
  if (e.kind === "binary" && e.op === "*") {
    const a = affine(e.left, substitute),
      b = affine(e.right, substitute);
    if (!a || !b) return null;
    const constant = [...a.terms.values()].every((n) => n === 0n)
      ? a
      : [...b.terms.values()].every((n) => n === 0n)
        ? b
        : null;
    if (!constant) return null;
    const variable = constant === a ? b : a;
    return {
      constant: constant.constant * variable.constant,
      terms: new Map(
        [...variable.terms].map(([name, factor]) => [
          name,
          factor * constant.constant,
        ]),
      ),
    };
  }
  return null;
}
/** Constants use the same integer expression semantics as fact comparison. */
function integerConstant(e: Expr): bigint | null {
  const value = affine(e);
  return value && [...value.terms.values()].every((n) => n === 0n)
    ? value.constant
    : null;
}
function difference(
  left: Expr,
  right: Expr,
  env: Facts,
): { min: bigint | null; max: bigint | null } | null {
  const a = affine(left),
    b = affine(right);
  if (!a || !b) return null;
  const terms = new Map(a.terms);
  for (const [k, v] of b.terms) terms.set(k, (terms.get(k) ?? 0n) - v);
  let min: bigint | null = a.constant - b.constant,
    max: bigint | null = min;
  for (const [name, factor] of terms) {
    if (!factor) continue;
    const range = env.get(name);
    if (range?.kind !== "integer") return null;
    const low = factor > 0 ? range.min : range.max,
      high = factor > 0 ? range.max : range.min;
    min = min !== null && low !== null ? min + factor * low : null;
    max = max !== null && high !== null ? max + factor * high : null;
  }
  return { min, max };
}
export function fact(ir: ProjectIR, e: Expr, env: Facts, depth = 0): Fact {
  const value = evaluateFact(ir, e, env, depth);
  const assumptions = [
    ...new Set([
      ...expressionAssumptions(e, env),
      ...(value.assumptions ?? []),
    ]),
  ];
  return assumptions.length ? { ...value, assumptions } : value;
}
function evaluateFact(ir: ProjectIR, e: Expr, env: Facts, depth = 0): Fact {
  if (depth > 64) return unknown;
  switch (e.kind) {
    case "literal":
      return typeof e.value === "bigint"
        ? { kind: "integer", min: e.value, max: e.value }
        : typeof e.value === "boolean"
          ? { kind: "boolean", value: e.value }
          : unknown;
    case "name":
      return env.get(e.name) ?? unknown;
    case "unary": {
      const a = fact(ir, e.expr, env, depth + 1);
      if (e.op === "!" && a.kind === "boolean")
        return { kind: "boolean", value: a.value === null ? null : !a.value };
      if (e.op === "-" && a.kind === "integer")
        return {
          kind: "integer",
          min: a.max === null ? null : -a.max,
          max: a.min === null ? null : -a.min,
        };
      return unknown;
    }
    case "binary": {
      if (["==", "!="].includes(e.op)) {
        const name =
          e.left.kind === "name"
            ? e.left
            : e.right.kind === "name"
              ? e.right
              : null;
        const literal =
          name === e.left ? integerConstant(e.right) : integerConstant(e.left);
        const range = name ? env.get(name.name) : null;
        if (
          range?.kind === "integer" &&
          literal !== null &&
          range.excluded?.includes(literal)
        )
          return { kind: "boolean", value: e.op === "!=" };
      }
      if ([">", ">=", "<", "<=", "==", "!="].includes(e.op)) {
        const range = difference(e.left, e.right, env);
        if (range) {
          const { min, max } = range;
          let value: boolean | null = null;
          switch (e.op) {
            case ">":
              value =
                min !== null && min > 0n
                  ? true
                  : max !== null && max <= 0n
                    ? false
                    : null;
              break;
            case ">=":
              value =
                min !== null && min >= 0n
                  ? true
                  : max !== null && max < 0n
                    ? false
                    : null;
              break;
            case "<":
              value =
                max !== null && max < 0n
                  ? true
                  : min !== null && min >= 0n
                    ? false
                    : null;
              break;
            case "<=":
              value =
                max !== null && max <= 0n
                  ? true
                  : min !== null && min > 0n
                    ? false
                    : null;
              break;
            case "==":
              value =
                min === 0n && max === 0n
                  ? true
                  : (min !== null && min > 0n) || (max !== null && max < 0n)
                    ? false
                    : null;
              break;
            case "!=":
              value =
                min === 0n && max === 0n
                  ? false
                  : (min !== null && min > 0n) || (max !== null && max < 0n)
                    ? true
                    : null;
              break;
          }
          if (value !== null) return { kind: "boolean", value };
        }
      }
      const a = fact(ir, e.left, env, depth + 1),
        b = fact(ir, e.right, env, depth + 1);
      if (["&&", "||"].includes(e.op)) {
        const av = a.kind === "boolean" ? a.value : null,
          bv = b.kind === "boolean" ? b.value : null;
        return {
          kind: "boolean",
          value:
            e.op === "&&"
              ? av === false || bv === false
                ? false
                : av === true && bv === true
                  ? true
                  : null
              : av === true || bv === true
                ? true
                : av === false && bv === false
                  ? false
                  : null,
        };
      }
      if (a.kind === "integer" && b.kind === "integer") {
        const amin = a.min,
          amax = a.max,
          bmin = b.min,
          bmax = b.max;
        let value: boolean | null = null;
        switch (e.op) {
          case ">":
            value =
              amin !== null && bmax !== null && amin > bmax
                ? true
                : amax !== null && bmin !== null && amax <= bmin
                  ? false
                  : null;
            break;
          case ">=":
            value =
              amin !== null && bmax !== null && amin >= bmax
                ? true
                : amax !== null && bmin !== null && amax < bmin
                  ? false
                  : null;
            break;
          case "<":
            return fact(
              ir,
              { ...e, op: ">", left: e.right, right: e.left },
              env,
              depth + 1,
            );
          case "<=":
            return fact(
              ir,
              { ...e, op: ">=", left: e.right, right: e.left },
              env,
              depth + 1,
            );
          case "==":
          case "!=": {
            const same =
                amin !== null &&
                amin === amax &&
                amin === bmin &&
                bmin === bmax,
              apart =
                (amax !== null && bmin !== null && amax < bmin) ||
                (bmax !== null && amin !== null && bmax < amin);
            value = same ? e.op === "==" : apart ? e.op === "!=" : null;
            break;
          }
          case "+":
            return {
              kind: "integer",
              min: amin !== null && bmin !== null ? amin + bmin : null,
              max: amax !== null && bmax !== null ? amax + bmax : null,
            };
          case "-":
            return {
              kind: "integer",
              min: amin !== null && bmax !== null ? amin - bmax : null,
              max: amax !== null && bmin !== null ? amax - bmin : null,
            };
          case "*":
            if (
              amin !== null &&
              amax !== null &&
              bmin !== null &&
              bmax !== null
            ) {
              const ns = [amin * bmin, amin * bmax, amax * bmin, amax * bmax];
              return {
                kind: "integer",
                min: ns.reduce((a, b) => (a < b ? a : b)),
                max: ns.reduce((a, b) => (a > b ? a : b)),
              };
            }
            return unknown;
          default:
            return unknown;
        }
        return { kind: "boolean", value };
      }
      if (
        a.kind === "boolean" &&
        b.kind === "boolean" &&
        ["==", "!="].includes(e.op)
      )
        return {
          kind: "boolean",
          value:
            a.value === null || b.value === null
              ? null
              : e.op === "=="
                ? a.value === b.value
                : a.value !== b.value,
        };
      return unknown;
    }
    case "call": {
      const target = ir.info.get(nodeKey(e.span))?.target,
        d = target ? ir.symbols.get(target) : undefined;
      if (d?.kind !== "rule" || !d.expr) return unknown;
      const args = new Map(
        d.params.map((p, i) => [
          p.name,
          e.args[i] ? fact(ir, e.args[i]!.expr, env, depth + 1) : unknown,
        ]),
      );
      // A rule's body is usable only under its own established caller conditions.
      // Otherwise evaluating it could justify a later call on an invalid path.
      for (const condition of d.meta.requires) {
        const value = fact(ir, condition, args, depth + 1);
        if (value.kind !== "boolean" || value.value !== true) return unknown;
      }
      return fact(ir, d.expr, args, depth + 1);
    }
    default:
      return unknown;
  }
}
export function truth(ir: ProjectIR, e: Expr, env: Facts): boolean | null {
  const f = fact(ir, e, env);
  return f.kind === "boolean" ? f.value : null;
}
/** Resolve pure-rule projections from the same IR before range refinement.
 * Source execution and witness provenance continue to use original expressions. */
export function refineResolved(
  ir: ProjectIR,
  env: Facts,
  e: Expr,
  positive: boolean,
): void {
  let visits = 0;
  function map(expr: Expr, visit: (child: Expr) => Expr): Expr {
    switch (expr.kind) {
      case "binary":
        return { ...expr, left: visit(expr.left), right: visit(expr.right) };
      case "unary":
        return { ...expr, expr: visit(expr.expr) };
      case "field":
        return { ...expr, base: visit(expr.base) };
      case "call":
        return {
          ...expr,
          args: expr.args.map((a) => ({ ...a, expr: visit(a.expr) })),
        };
      case "record":
        return {
          ...expr,
          fields: expr.fields.map((f) => ({ ...f, value: visit(f.value) })),
        };
      case "list":
        return { ...expr, items: expr.items.map(visit) };
      default:
        return expr;
    }
  }
  function expand(expr: Expr, depth = 0): Expr {
    if (++visits > 12000 || depth > 64) return expr;
    if (expr.kind === "name") {
      const old = env.get(expr.name),
        predicate = old?.predicate;
      if (
        predicate?.bindings.every(([name, value]) =>
          value?.bindingId
            ? env.get(name)?.bindingId === value.bindingId
            : env.get(name) === value,
        )
      ) {
        const projected = expand(predicate.expression, depth + 1);
        if (visits <= 12000)
          env.set(expr.name, {
            ...old!,
            predicate: { ...predicate, expression: projected },
          });
      }
      return expr;
    }
    if (expr.kind === "call") {
      const target = ir.info.get(nodeKey(expr.span))?.target,
        d = target ? ir.symbols.get(target) : undefined;
      if (
        d?.kind === "rule" &&
        d.expr &&
        d.params.length === expr.args.length
      ) {
        const values = new Map(
          d.params.map((p, i) => [p.name, fact(ir, expr.args[i]!.expr, env)]),
        );
        if (d.meta.requires.every((c) => truth(ir, c, values) === true)) {
          const args = new Map(
            d.params.map((p, i) => [p.name, expr.args[i]!.expr]),
          );
          function substitute(body: Expr): Expr {
            if (++visits > 12000) return body;
            return body.kind === "name"
              ? (args.get(body.name) ?? body)
              : map(body, substitute);
          }
          // Do not project a partially substituted body into the caller scope.
          const body = substitute(d.expr);
          if (visits > 12000) return expr;
          return expand(body, depth + 1);
        }
      }
    }
    return map(expr, (child) => expand(child, depth + 1));
  }
  const resolved = expand(e);
  if (visits <= 12000) refine(env, resolved, positive);
}
export function refine(
  env: Facts,
  e: Expr,
  positive: boolean,
  depth = 0,
): void {
  if (depth > 64) return;
  if (e.kind === "literal" && typeof e.value === "boolean") {
    if (e.value !== positive) markInfeasible(env);
    return;
  }
  if (e.kind === "name") {
    const old = env.get(e.name);
    if (old?.kind === "boolean" && old.value !== null && old.value !== positive)
      markInfeasible(env);
    const predicate = env.get(e.name)?.predicate;
    if (
      predicate?.bindings.every(([name, value]) =>
        value?.bindingId
          ? env.get(name)?.bindingId === value.bindingId
          : env.get(name) === value,
      )
    )
      refine(env, predicate.expression, positive, depth + 1);
    env.set(e.name, {
      kind: "boolean",
      value: positive,
      ...(env.get(e.name)?.bindingId
        ? { bindingId: env.get(e.name)!.bindingId }
        : {}),
      ...(env.get(e.name)?.assumptions
        ? { assumptions: env.get(e.name)!.assumptions }
        : {}),
    });
    return;
  }
  if (e.kind === "unary" && e.op === "!") {
    refine(env, e.expr, !positive, depth + 1);
    return;
  }
  if (e.kind !== "binary") return;
  if (
    (integerConstant(e.left) !== null || e.left.kind === "literal") &&
    e.right.kind === "name"
  ) {
    const reverse: Record<string, string> = {
      ">": "<",
      ">=": "<=",
      "<": ">",
      "<=": ">=",
    };
    refine(
      env,
      { ...e, left: e.right, right: e.left, op: reverse[e.op] ?? e.op },
      positive,
      depth + 1,
    );
    return;
  }
  if ((e.op === "&&" && positive) || (e.op === "||" && !positive)) {
    refine(env, e.left, positive, depth + 1);
    refine(env, e.right, positive, depth + 1);
    return;
  }
  if ((e.op === "||" && positive) || (e.op === "&&" && !positive)) {
    const a = new Map(env),
      b = new Map(env);
    refine(a, e.left, positive, depth + 1);
    refine(b, e.right, positive, depth + 1);
    const paths = [a, b].filter(feasible);
    if (!paths.length) markInfeasible(env);
    else {
      const joined = joinFacts(paths);
      env.clear();
      for (const [name, value] of joined) env.set(name, value);
    }
    return;
  }
  if (
    e.left.kind === "name" &&
    e.right.kind === "literal" &&
    typeof e.right.value === "boolean" &&
    ["==", "!="].includes(e.op)
  ) {
    const equal = e.op === "==" ? positive : !positive;
    refine(env, e.left, equal ? e.right.value : !e.right.value, depth + 1);
    return;
  }
  const n = integerConstant(e.right);
  if (e.left.kind !== "name" || n === null) {
    const a = affine(e.left),
      b = affine(e.right);
    if (!a || !b || !["<", "<=", ">", ">=", "==", "!="].includes(e.op)) return;
    const terms = new Map(a.terms);
    for (const [name, factor] of b.terms)
      terms.set(name, (terms.get(name) ?? 0n) - factor);
    const variables = [...terms].filter(([, factor]) => factor !== 0n);
    if (variables.length !== 1) return;
    let [name, factor] = variables[0]!;
    let bound = b.constant - a.constant,
      op = e.op;
    if (factor < 0n) {
      factor = -factor;
      bound = -bound;
      op = (
        {
          "<": ">",
          "<=": ">=",
          ">": "<",
          ">=": "<=",
          "==": "==",
          "!=": "!=",
        } as Record<string, string>
      )[op]!;
    }
    if (!positive)
      op = (
        {
          "<": ">=",
          "<=": ">",
          ">": "<=",
          ">=": "<",
          "==": "!=",
          "!=": "==",
        } as Record<string, string>
      )[op]!;
    const floor = bound / factor - (bound % factor < 0n ? 1n : 0n);
    const ceil = bound / factor + (bound % factor > 0n ? 1n : 0n);
    if (["==", "!="].includes(op) && bound % factor !== 0n) {
      if (op === "==") markInfeasible(env);
      return;
    }
    const value =
      op === "<"
        ? ceil - 1n
        : op === "<="
          ? floor
          : op === ">"
            ? floor + 1n
            : op === ">="
              ? ceil
              : bound / factor;
    const relation = ["<", "<="].includes(op)
      ? "<="
      : [">", ">="].includes(op)
        ? ">="
        : op;
    refine(
      env,
      {
        ...e,
        left: { kind: "name", name, span: e.span },
        right: { kind: "literal", value, span: e.span },
        op: relation,
      },
      true,
      depth + 1,
    );
    return;
  }
  const old = env.get(e.left.name);
  if (old?.kind !== "integer") return;
  const inverse: Record<string, string> = {
    ">": "<=",
    ">=": "<",
    "<": ">=",
    "<=": ">",
    "==": "!=",
    "!=": "==",
  };
  const op = positive ? e.op : inverse[e.op];
  let min = old.min,
    max = old.max;
  if (op === ">" || op === ">=")
    min =
      min === null
        ? n + (op === ">" ? 1n : 0n)
        : min > n + (op === ">" ? 1n : 0n)
          ? min
          : n + (op === ">" ? 1n : 0n);
  if (op === "<" || op === "<=")
    max =
      max === null
        ? n - (op === "<" ? 1n : 0n)
        : max < n - (op === "<" ? 1n : 0n)
          ? max
          : n - (op === "<" ? 1n : 0n);
  if (op === "==") {
    min = min === null || min < n ? n : min;
    max = max === null || max > n ? n : max;
  }
  // An interval cannot represent an interior hole, but can exclude either
  // endpoint exactly (including the single-value/infeasible case).
  if (op === "!=") {
    if (min === n) min = n + 1n;
    if (max === n) max = n - 1n;
  }
  env.set(e.left.name, {
    ...old,
    kind: "integer",
    min,
    max,
    ...(op === "!="
      ? { excluded: [...new Set([...(old.excluded ?? []), n])].slice(0, 32) }
      : {}),
  });
}

/** Conservative join of surviving paths; never carry one branch's narrowing across another. */
export function joinFacts(paths: Facts[]): Facts {
  if (!paths.length) return new Map();
  const joined = new Map(paths[0]);
  for (const next of paths.slice(1)) {
    for (const name of new Set([...joined.keys(), ...next.keys()])) {
      const a = joined.get(name) ?? unknown,
        b = next.get(name) ?? unknown;
      const assumptions = [
        ...new Set([...(a.assumptions ?? []), ...(b.assumptions ?? [])]),
      ];
      let value: Fact = unknown;
      if (a.kind === "integer" && b.kind === "integer") {
        const excluded = new Set([
          ...(a.excluded ?? []),
          ...(b.excluded ?? []),
        ]);
        const gap = (low: bigint | null, high: bigint | null) => {
          if (low !== null && high !== null && high > low && high - low <= 33n)
            for (let n = low + 1n; n < high; n++) excluded.add(n);
        };
        gap(a.max, b.min);
        gap(b.max, a.min);
        const outside = (range: typeof a, n: bigint) =>
          (range.min !== null && n < range.min) ||
          (range.max !== null && n > range.max) ||
          range.excluded?.includes(n);
        value = {
          kind: "integer",
          excluded: [...excluded]
            .filter((n) => outside(a, n) && outside(b, n))
            .slice(0, 32),
          min:
            a.min === null || b.min === null
              ? null
              : a.min < b.min
                ? a.min
                : b.min,
          max:
            a.max === null || b.max === null
              ? null
              : a.max > b.max
                ? a.max
                : b.max,
        };
      } else if (a.kind === "boolean" && b.kind === "boolean")
        value = {
          kind: "boolean",
          value: a.value === b.value ? a.value : null,
        };
      if (a.bindingId && a.bindingId === b.bindingId)
        value = { ...value, bindingId: a.bindingId };
      if (
        value.kind === "boolean" &&
        a.predicate &&
        a.predicate === b.predicate
      )
        value = { ...value, predicate: a.predicate };
      joined.set(name, assumptions.length ? { ...value, assumptions } : value);
    }
  }
  return joined;
}
export function feasible(env: Facts): boolean {
  return [...env.values()].every(
    (f) =>
      f.kind !== "integer" ||
      f.min === null ||
      f.max === null ||
      (f.min <= f.max && !(f.min === f.max && f.excluded?.includes(f.min))),
  );
}
