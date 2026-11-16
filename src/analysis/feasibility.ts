// SPDX-License-Identifier: MIT
import type { Callable, Expr, Param } from "../language/ast.js";
import type { ProjectIR } from "../semantic/core.js";
import { result, type AnalysisResult } from "../reporting/report.js";
import { finding } from "../shared/identity.js";
interface Interval {
  lo: bigint | null;
  hi: bigint | null;
}
/** Exact only for conjunctive scalar constraints; unsupported expressions never prove feasibility. */
export function scalarFeasibility(
  params: Param[],
  bounds: Record<string, bigint>,
  constraints: Expr[],
): {
  supported: boolean;
  impossible: boolean;
  witness: Record<string, bigint | boolean>;
} {
  const ranges = new Map<string, Interval>(),
    booleans = new Map<string, boolean>();
  let supported = true,
    impossible = false;
  for (const p of params) {
    if (p.type.name === "Int" || p.type.name === "Nat")
      ranges.set(p.name, {
        lo: p.type.name === "Nat" ? 0n : null,
        hi: bounds[p.name] ?? null,
      });
  }
  const setBool = (name: string, value: boolean): void => {
    const old = booleans.get(name);
    if (old !== undefined && old !== value) impossible = true;
    booleans.set(name, value);
  };
  const int = (e: Expr): bigint | null =>
    e.kind === "literal" && typeof e.value === "bigint"
      ? e.value
      : e.kind === "unary" &&
          e.op === "-" &&
          e.expr.kind === "literal" &&
          typeof e.expr.value === "bigint"
        ? -e.expr.value
        : null;
  const boolParams = new Set(
    params.filter((p) => p.type.name === "Bool").map((p) => p.name),
  );
  function constrain(e: Expr): void {
    if (e.kind === "literal" && typeof e.value === "boolean") {
      if (!e.value) impossible = true;
      return;
    }
    if (e.kind === "binary" && e.op === "&&") {
      constrain(e.left);
      constrain(e.right);
      return;
    }
    if (e.kind === "name" && boolParams.has(e.name)) {
      setBool(e.name, true);
      return;
    }
    if (
      e.kind === "unary" &&
      e.op === "!" &&
      e.expr.kind === "name" &&
      boolParams.has(e.expr.name)
    ) {
      setBool(e.expr.name, false);
      return;
    }
    if (e.kind === "binary") {
      if (e.op === "==" || e.op === "!=") {
        const name =
          e.left.kind === "name"
            ? e.left
            : e.right.kind === "name"
              ? e.right
              : null;
        const literal =
          e.left.kind === "literal"
            ? e.left
            : e.right.kind === "literal"
              ? e.right
              : null;
        if (
          name &&
          literal &&
          boolParams.has(name.name) &&
          typeof literal.value === "boolean"
        ) {
          setBool(name.name, e.op === "==" ? literal.value : !literal.value);
          return;
        }
      }
      let name: string | null = null,
        n: bigint | null = null,
        op = e.op;
      if (e.left.kind === "name") {
        name = e.left.name;
        n = int(e.right);
      } else if (e.right.kind === "name") {
        name = e.right.name;
        n = int(e.left);
        op =
          (
            { "<": ">", ">": "<", "<=": ">=", ">=": "<=" } as Record<
              string,
              string
            >
          )[op] ?? op;
      }
      if (
        name &&
        n !== null &&
        ranges.has(name) &&
        ["<", "<=", ">", ">=", "=="].includes(op)
      ) {
        const r = ranges.get(name)!;
        const low = op === ">" ? n + 1n : op === ">=" || op === "==" ? n : null,
          high = op === "<" ? n - 1n : op === "<=" || op === "==" ? n : null;
        if (low !== null && (r.lo === null || low > r.lo)) r.lo = low;
        if (high !== null && (r.hi === null || high < r.hi)) r.hi = high;
        if (r.lo !== null && r.hi !== null && r.lo > r.hi) impossible = true;
        return;
      }
    }
    supported = false;
  }
  for (const e of constraints) constrain(e);
  const witness = Object.fromEntries(
    [...ranges].map(([name, r]) => [
      name,
      r.lo ?? (r.hi !== null && r.hi < 0n ? r.hi : 0n),
    ]),
  );
  Object.assign(witness, Object.fromEntries(booleans));
  return { supported, impossible, witness };
}

export function guaranteeFeasibility(d: Callable) {
  return scalarFeasibility(
    [
      ...d.params,
      { name: "result", type: d.result, span: d.span, mode: "value" },
    ],
    d.meta.bounds,
    [...d.meta.requires, ...d.meta.ensures],
  );
}
export function feasibility(
  ir: ProjectIR,
  d: Callable,
  blocked: boolean,
): AnalysisResult[] {
  const results: AnalysisResult[] = [];
  if (d.meta.requires.length) {
    const { supported, impossible, witness } = scalarFeasibility(
      d.params,
      d.meta.bounds,
      d.meta.requires,
    );
    results.push(
      result(ir, d.id + "/feasibility", "feasibility", {
        outcome: impossible
          ? "counterexample"
          : blocked || !supported
            ? "inconclusive"
            : "established",
        completion: blocked
          ? "incomplete"
          : supported || impossible
            ? "complete"
            : "unsupported",
        outstandingObligations: blocked
          ? ["Entry has semantic holes/errors"]
          : supported || impossible
            ? []
            : ["Unsupported entry satisfiability reasoning"],
        diagnostics: impossible
          ? [
              finding(
                "V001",
                "Contradictory entry conditions: vacuous model",
                d.span,
              ),
            ]
          : [],
        witnessOrDerivation: impossible
          ? { contradiction: true }
          : supported
            ? {
                entryWitness: witness,
                scope:
                  "literal/conjunctive integer intervals and Bool parameters only",
              }
            : null,
      }),
    );
  }
  if (d.meta.ensures.length && d.kind === "op") {
    const guarantees = guaranteeFeasibility(d);
    results.push(
      result(ir, d.id + "/postconditions", "contracts", {
        outcome: guarantees.impossible ? "counterexample" : "not_run",
        completion: blocked ? "incomplete" : "complete",
        assumptions: [`Trusted abstract postconditions of ${d.id}`],
        diagnostics: guarantees.impossible
          ? [
              finding(
                "V002",
                "Contradictory operation guarantees: no result can satisfy this contract",
                d.meta.ensures[0]!.span,
                "error",
                d.meta.ensures.slice(1).map((e) => e.span),
              ),
            ]
          : [],
        outstandingObligations: [],
      }),
    );
  }
  return results;
}
