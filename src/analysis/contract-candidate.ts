import type { Expr } from "../language/ast.js";
import { exprChildren } from "../language/ast.js";
import type { ProjectIR } from "../semantic/core.js";
import { truth, type Fact, type Facts } from "./facts.js";
import { signedIntegerLiteral } from "../shared/integer-literal.js";

/** A bounded candidate from scalar argument ranges, never a reachability proof. */
export function contractCandidate(
  ir: ProjectIR,
  condition: Expr,
  ranges: Facts,
) {
  const referenced = new Set<string>();
  function names(e: Expr) {
    if (e.kind === "name" && ranges.has(e.name)) referenced.add(e.name);
    for (const child of exprChildren(e)) names(child);
  }
  names(condition);
  if (referenced.size > 8) return null;
  const constants = new Set<bigint>([0n, 1n, -1n]);
  function literals(e: Expr) {
    const integer = signedIntegerLiteral(e);
    if (integer !== null) {
      constants.add(integer);
      constants.add(integer - 1n);
      constants.add(integer + 1n);
    }
    for (const child of exprChildren(e)) literals(child);
  }
  literals(condition);
  const choices: { name: string; facts: Fact[] }[] = [];
  for (const [name, value] of ranges) {
    if (!referenced.has(name)) continue;
    if (value.kind === "unknown") return null;
    const facts: Fact[] =
      value.kind === "boolean"
        ? (value.value === null ? [false, true] : [value.value]).map((v) => ({
            kind: "boolean",
            value: v,
          }))
        : [
            ...new Set(
              [
                value.min,
                value.max,
                ...constants,
                ...(value.excluded ?? []).flatMap((n) => [n - 1n, n + 1n]),
              ].filter(
                (v): v is bigint =>
                  v !== null &&
                  (value.min === null || v >= value.min) &&
                  (value.max === null || v <= value.max) &&
                  !value.excluded?.includes(v),
              ),
            ),
          ]
            .slice(0, 16)
            .map((v) => ({ kind: "integer", min: v, max: v }));
    if (!facts.length) return null;
    choices.push({ name, facts });
  }
  let attempts = 0;
  const values: Facts = new Map();
  function search(i: number): Record<string, string | boolean> | null {
    if (attempts >= 256) return null;
    if (i === choices.length) {
      attempts++;
      if (truth(ir, condition, values) !== false) return null;
      return Object.fromEntries(
        [...values].map(([name, value]) => [
          name,
          value.kind === "integer"
            ? String(value.min)
            : value.kind === "boolean"
              ? value.value!
              : "unknown",
        ]),
      );
    }
    const choice = choices[i]!;
    for (const value of choice.facts) {
      values.set(choice.name, value);
      const found = search(i + 1);
      if (found) return found;
      if (attempts >= 256) break;
    }
    return null;
  }
  return search(0);
}
