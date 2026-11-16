// SPDX-License-Identifier: MIT
import type { Expr, Callable, Stmt } from "../language/ast.js";
import { nodeKey, exprChildren } from "../language/ast.js";
import { callable, blockedSymbols, type ProjectIR } from "../semantic/core.js";
import { result, type AnalysisResult } from "../reporting/report.js";
import { finding, type Finding } from "../shared/identity.js";
import { compareBudget, budgetLimits } from "./budget.js";
export type Cost =
  | { kind: "constant"; value: bigint }
  | { kind: "variable"; name: string }
  | { kind: "unknown"; reason: string }
  | { kind: "add" | "multiply" | "maximum"; terms: Cost[] };
export const constant = (value: bigint): Cost => ({ kind: "constant", value });
const zero = constant(0n),
  one = constant(1n);
export function show(c: Cost): string {
  switch (c.kind) {
    case "constant":
      return String(c.value);
    case "variable":
      return c.name;
    case "unknown":
      return `unknown(${c.reason})`;
    case "add":
      return c.terms.map(show).join(" + ");
    case "multiply":
      return c.terms
        .map((t) => (t.kind === "add" ? `(${show(t)})` : show(t)))
        .join(" * ");
    case "maximum":
      return `max(${c.terms.map(show).join(", ")})`;
  }
}
export function multiply(...values: Cost[]): Cost {
  const terms: Cost[] = [];
  let factor = 1n;
  for (const v of values) {
    const a = v.kind === "multiply" ? v.terms : [v];
    for (const t of a)
      if (t.kind === "constant") factor *= t.value;
      else terms.push(t);
  }
  if (factor === 0n) return zero;
  if (factor !== 1n || !terms.length) terms.unshift(constant(factor));
  if (terms.length > 256)
    return { kind: "unknown", reason: "expression size limit" };
  return terms.length === 1 ? terms[0]! : { kind: "multiply", terms };
}
export function add(...values: Cost[]): Cost {
  const groups = new Map<string, { term: Cost; factor: bigint }>();
  let total = 0n;
  for (const v of values)
    for (const t of v.kind === "add" ? v.terms : [v]) {
      if (t.kind === "constant") {
        total += t.value;
        continue;
      }
      let factor = 1n;
      let term: Cost = t;
      if (t.kind === "multiply" && t.terms[0]?.kind === "constant") {
        factor = t.terms[0].value;
        term =
          t.terms.length === 2
            ? t.terms[1]!
            : { kind: "multiply", terms: t.terms.slice(1) };
      }
      const key = show(term),
        g = groups.get(key);
      if (g) g.factor += factor;
      else groups.set(key, { term, factor });
    }
  const terms: Cost[] = [];
  if (total) terms.push(constant(total));
  for (const { term, factor } of groups.values())
    terms.push(multiply(constant(factor), term));
  if (terms.length > 256)
    return { kind: "unknown", reason: "expression size limit" };
  return !terms.length
    ? zero
    : terms.length === 1
      ? terms[0]!
      : { kind: "add", terms };
}
export function maximum(...values: Cost[]): Cost {
  const unique = new Map<string, Cost>();
  for (const v of values)
    for (const t of v.kind === "maximum" ? v.terms : [v])
      unique.set(show(t), t);
  const terms = [...unique.values()];
  if (terms.every((t) => t.kind === "constant"))
    return constant(
      terms.reduce(
        (n, t) => (t.kind === "constant" && t.value > n ? t.value : n),
        0n,
      ),
    );
  return terms.length === 1 ? terms[0]! : { kind: "maximum", terms };
}
export function evaluate(
  c: Cost,
  bounds: Record<string, bigint>,
): bigint | null {
  switch (c.kind) {
    case "constant":
      return c.value;
    case "variable":
      return Object.hasOwn(bounds, c.name) ? bounds[c.name]! : null;
    case "unknown":
      return null;
    default: {
      const v = c.terms.map((t) => evaluate(t, bounds));
      if (v.some((x) => x === null)) return null;
      const ns = v as bigint[];
      return c.kind === "add"
        ? ns.reduce((a, b) => a + b, 0n)
        : c.kind === "multiply"
          ? ns.reduce((a, b) => a * b, 1n)
          : ns.reduce((a, b) => (a > b ? a : b), 0n);
    }
  }
}
const containsUnknown = (c: Cost): boolean =>
  c.kind === "unknown" || ("terms" in c && c.terms.some(containsUnknown));
function resolvedSize(e: Expr, bindings: Map<string, Cost>): Cost {
  if (e.kind === "name") return bindings.get(e.name) ?? size(e);
  if (e.kind === "field" && e.name === "count" && e.base.kind === "name")
    return bindings.get(e.base.name) ?? size(e);
  if (e.kind === "binary" && e.op === "+")
    return add(resolvedSize(e.left, bindings), resolvedSize(e.right, bindings));
  if (e.kind === "binary" && e.op === "*")
    return multiply(
      resolvedSize(e.left, bindings),
      resolvedSize(e.right, bindings),
    );
  return size(e);
}
export function size(e: Expr): Cost {
  switch (e.kind) {
    case "list":
      return constant(BigInt(e.items.length));
    case "literal":
      return typeof e.value === "bigint" && e.value >= 0n
        ? constant(e.value)
        : { kind: "unknown", reason: "not a nonnegative integer" };
    case "name":
      return { kind: "variable", name: e.name };
    case "field":
      return e.name === "count" && e.base.kind === "name"
        ? { kind: "variable", name: e.base.name }
        : { kind: "unknown", reason: "dependent size" };
    case "binary":
      return e.op === "+"
        ? add(size(e.left), size(e.right))
        : e.op === "*"
          ? multiply(size(e.left), size(e.right))
          : { kind: "unknown", reason: "unsupported size expression" };
    default:
      return {
        kind: "unknown",
        reason: e.kind === "unknown" ? e.reason : "unsupported size expression",
      };
  }
}
interface Summary {
  cost: Cost;
  upper: boolean;
  assumptions: string[];
  path: string[];
}
interface Paths {
  next: Cost | null;
  returned: Cost | null;
  upper: boolean;
}
export function analyseCosts(ir: ProjectIR): AnalysisResult[] {
  const metrics = new Set(
      ir.declarations
        .filter(callable)
        .flatMap((d) =>
          d.meta.costs.filter((c) => c.kind !== "budget").map((c) => c.metric),
        ),
    ),
    blocked = blockedSymbols(ir, false),
    memo = new Map<string, Summary>(),
    active = new Set<string>(),
    results: AnalysisResult[] = [];
  let operations = 0;
  const budgetWork = {
    remaining: budgetLimits.operations as number,
    operations: 0,
  };
  const join = (a: Cost | null, b: Cost | null): Cost | null =>
    a === null ? b : b === null ? a : maximum(a, b);
  for (const d of ir.declarations)
    if (callable(d))
      for (const c of d.meta.costs)
        if (c.kind === "budget" && !metrics.has(c.metric))
          results.push(
            result(ir, d.id + "/budget/" + c.metric, "budget", {
              outcome: "counterexample",
              diagnostics: [
                finding(
                  "K004",
                  `Budget metric ${c.metric} has no compatible work declaration`,
                  c.span,
                ),
              ],
            }),
          );
  function infer(d: Callable, metric: string): Summary {
    const key = d.id + "/" + metric,
      cached = memo.get(key);
    if (cached) return cached;
    if (active.size > 256)
      return {
        cost: { kind: "unknown", reason: "call depth limit" },
        upper: true,
        assumptions: [],
        path: [d.name],
      };
    if (active.has(key))
      return {
        cost: { kind: "unknown", reason: `recursive call ${d.name}` },
        upper: true,
        assumptions: [],
        path: [d.name],
      };
    if (blocked.has(d.id))
      return {
        cost: { kind: "unknown", reason: `incomplete ${d.name}` },
        upper: true,
        assumptions: [],
        path: [d.name],
      };
    active.add(key);
    let upper = false;
    const assumptions = new Set<string>(),
      path = [d.name];
    function expression(
      e: Expr,
      bindings: Map<string, Cost> = new Map(),
    ): Cost {
      if (e.kind === "unknown") return { kind: "unknown", reason: e.reason };
      if (e.kind === "call") {
        const target = ir.info.get(nodeKey(e.span))?.target,
          callee = target ? ir.symbols.get(target) : undefined;
        const argumentCost = add(
          ...e.args.map((a) => expression(a.expr, bindings)),
        );
        return callee && callable(callee)
          ? add(
              argumentCost,
              call(
                callee,
                e.args.map((a) => a.expr),
                bindings,
              ),
            )
          : argumentCost;
      }
      if (
        e.kind === "binary" &&
        ((e.op === "&&" &&
          e.left.kind === "literal" &&
          e.left.value === false) ||
          (e.op === "||" && e.left.kind === "literal" && e.left.value === true))
      )
        return expression(e.left, bindings);
      if (e.kind === "binary" && ["&&", "||"].includes(e.op)) {
        upper = true;
        return add(expression(e.left, bindings), expression(e.right, bindings));
      }
      return add(
        ...exprChildren(e).map((child) => expression(child, bindings)),
      );
    }
    function substitute(c: Cost, values: Map<string, Cost>): Cost {
      switch (c.kind) {
        case "variable":
          return values.get(c.name) ?? c;
        case "add":
          return add(...c.terms.map((t) => substitute(t, values)));
        case "multiply":
          return multiply(...c.terms.map((t) => substitute(t, values)));
        case "maximum":
          return maximum(...c.terms.map((t) => substitute(t, values)));
        default:
          return c;
      }
    }
    function call(
      callee: Callable,
      args: Expr[],
      bindings: Map<string, Cost> = new Map(),
    ): Cost {
      const summary = infer(callee, metric);
      if (callee.meta.requires.length)
        assumptions.add(
          `Cost contract for ${callee.id} assumes its declared preconditions`,
        );
      upper ||= summary.upper;
      for (const a of summary.assumptions) assumptions.add(a);
      path.push(...summary.path);
      return substitute(
        summary.cost,
        new Map(
          callee.params.map((p, i) => [
            p.name,
            args[i]
              ? resolvedSize(args[i]!, bindings)
              : { kind: "unknown", reason: "missing argument" },
          ]),
        ),
      );
    }
    function walk(
      body: Stmt[],
      bindings: Map<string, Cost> = new Map(),
    ): Paths {
      let next: Cost | null = zero,
        returned: Cost | null = null,
        up = false;
      for (const s of body) {
        operations++;
        if (next === null) break;
        let item: Paths = { next: zero, returned: null, upper: false };
        switch (s.kind) {
          case "invoke": {
            const id = ir.info.get(nodeKey(s.span))?.target,
              callee = id ? ir.symbols.get(id) : undefined;
            item.next = add(
              ...s.args.map((a) => expression(a.expr, bindings)),
              callee && callable(callee)
                ? call(
                    callee,
                    s.args.map((a) => a.expr),
                    bindings,
                  )
                : { kind: "unknown", reason: `unknown callee ${s.name}` },
            );
            break;
          }
          case "let":
            bindings.set(s.name, resolvedSize(s.expr, bindings));
            item.next = expression(s.expr, bindings);
            break;
          case "assert":
            item.next = expression(s.expr, bindings);
            break;
          case "return":
          case "propagate":
            item = {
              next: null,
              returned: expression(s.expr, bindings),
              upper: false,
            };
            break;
          case "if": {
            const test = expression(s.test, bindings);
            if (
              s.test.kind === "literal" &&
              typeof s.test.value === "boolean"
            ) {
              item = walk(s.test.value ? s.yes : s.no, new Map(bindings));
              item.next = item.next === null ? null : add(test, item.next);
              item.returned =
                item.returned === null ? null : add(test, item.returned);
            } else {
              const a = walk(s.yes, new Map(bindings)),
                b = walk(s.no, new Map(bindings));
              const n = join(a.next, b.next),
                r = join(a.returned, b.returned);
              item = {
                next: n === null ? null : add(test, n),
                returned: r === null ? null : add(test, r),
                upper: true,
              };
            }
            break;
          }
          case "match": {
            const test = expression(s.expr, bindings),
              parts = s.arms.map((a) => walk(a.body, new Map(bindings)));
            const n = parts.reduce<Cost | null>(
                (n, p) => join(n, p.next),
                null,
              ),
              r = parts.reduce<Cost | null>(
                (n, p) => join(n, p.returned),
                null,
              );
            item = {
              next: n === null ? null : add(test, n),
              returned: r === null ? null : add(test, r),
              upper: true,
            };
            break;
          }
          case "for":
          case "retry": {
            const count = resolvedSize(s.count, bindings);
            if (evaluate(count, d.meta.bounds) === 0n) {
              item.next = zero;
              break;
            }
            const a = walk(s.body, new Map(bindings)),
              n = evaluate(count, {});
            if (a.next === null && a.returned !== null) {
              item = {
                next: n !== null && n > 0n ? null : zero,
                returned: a.returned,
                upper: true,
              };
            } else {
              const all = join(a.next, a.returned) ?? zero,
                work = multiply(count, all);
              item = {
                next: work,
                returned: a.returned === null ? null : work,
                upper: true,
              };
            }
            break;
          }
          case "unknown":
            item.next = { kind: "unknown", reason: s.reason };
            break;
          case "own":
          case "move":
          case "transition":
            break;
        }
        if (item.returned !== null)
          returned = join(returned, add(next, item.returned));
        next = item.next === null ? null : add(next, item.next);
        up ||= item.upper;
      }
      return { next, returned, upper: up };
    }
    const annotations = d.meta.costs.filter(
      (c) =>
        c.metric === metric &&
        c.kind === (d.kind === "op" ? "cost" : "overhead"),
    );
    let cost: Cost;
    if (d.kind === "op") {
      cost = annotations.length
        ? add(...annotations.map((c) => size(c.expr)))
        : { kind: "unknown", reason: `no ${metric} summary for ${d.name}` };
      for (const a of annotations)
        assumptions.add(
          `${d.id}: ${metric} ${a.quality} ${show(size(a.expr))}`,
        );
      upper ||= annotations.some((a) => a.quality === "upper");
    } else {
      const p = d.body
        ? walk(d.body)
        : {
            next: d.expr ? expression(d.expr) : zero,
            returned: null,
            upper: false,
          };
      cost = add(
        join(p.next, p.returned) ?? zero,
        ...annotations.map((c) => size(c.expr)),
      );
      upper ||= p.upper || annotations.some((c) => c.quality === "upper");
      if (d.cancel) {
        const c = walk(d.cancel);
        cost = add(cost, join(c.next, c.returned) ?? zero);
        upper = true;
        assumptions.add(
          "Cancellation may follow any prefix; sum with cleanup is a conservative bound",
        );
      }
    }
    const r = {
      cost,
      upper,
      assumptions: [...assumptions],
      path: [...new Set(path)],
    };
    active.delete(key);
    memo.set(key, r);
    return r;
  }
  for (const d of ir.declarations)
    if (callable(d))
      for (const metric of metrics) {
        const s = infer(d, metric),
          unknown = containsUnknown(s.cost),
          maximumValue = evaluate(s.cost, d.meta.bounds),
          diagnostics: Finding[] = [],
          pendingBudgets: string[] = [],
          budgetChecks: {
            expression: string;
            status: string;
            reason: string;
            inputs?: Record<string, string>;
          }[] = [];
        for (const b of d.meta.costs.filter(
          (c) => c.kind === "budget" && c.metric === metric,
        )) {
          const constraint = size(b.expr);
          const comparison = compareBudget(
            s.cost,
            constraint,
            d.meta.bounds,
            budgetWork,
          );
          budgetChecks.push({ expression: show(constraint), ...comparison });
          if (comparison.status === "unresolved") {
            const reason = `${d.name}: ${metric} budget ${show(constraint)} remains unresolved: ${comparison.reason}`;
            pendingBudgets.push(reason);
            diagnostics.push(
              finding("K006", reason, b.span, "warning", [], [d.name]),
            );
          }
          if (comparison.status === "exceeded")
            diagnostics.push(
              finding(
                "K002",
                `${d.name}: ${show(s.cost)} ${metric} may exceed budget ${show(constraint)}. ${comparison.reason}${
                  Object.keys(comparison.inputs).length
                    ? "; inputs: " +
                      Object.entries(comparison.inputs)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")
                    : ""
                }. This compares abstract work bounds; validate path feasibility.`,
                b.span,
                "error",
                [],
                [d.name],
              ),
            );
        }
        const unvalidatedBudget =
          s.upper && diagnostics.some((d) => d.code === "K002");
        results.push(
          result(ir, d.id + "/cost/" + metric, "cost", {
            outcome:
              diagnostics.some((d) => d.severity === "error") &&
              !unvalidatedBudget
                ? "counterexample"
                : unknown || pendingBudgets.length || unvalidatedBudget
                  ? "inconclusive"
                  : "established",
            completion:
              unknown || pendingBudgets.length
                ? "incomplete"
                : unvalidatedBudget
                  ? "unsupported"
                  : "complete",
            ...(unvalidatedBudget
              ? { witnessValidation: "unvalidated" as const }
              : {}),
            ...(budgetChecks.length
              ? { method: "abstract_interpretation" as const }
              : {}),
            assumptions: s.assumptions,
            outstandingObligations: [
              ...(unknown ? [show(s.cost)] : []),
              ...pendingBudgets,
              ...(unvalidatedBudget
                ? [
                    "The upper work bound exceeds a budget, but source-path feasibility has not been validated. This is not a confirmed executable counterexample.",
                  ]
                : []),
            ],
            diagnostics,
            witnessOrDerivation: {
              metric,
              expression: show(s.cost),
              classification: unknown ? "unknown" : s.upper ? "upper" : "exact",
              maximum: maximumValue === null ? null : String(maximumValue),
              bounds: d.meta.bounds,
              contributors: s.path,
              algebra: s.cost,
              budgetChecks,
            },
          }),
        );
      }
  ir.measurements.costOperations = operations;
  ir.measurements.costSummaries = memo.size;
  ir.measurements.budgetAlgebraOperations = budgetWork.operations;
  return results;
}
