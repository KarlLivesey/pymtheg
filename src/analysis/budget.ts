import type { Cost } from "./cost.js";
export const budgetLimits = {
  operations: 100000,
  terms: 128,
  degree: 16,
  alternatives: 64,
  witnessVariables: 8,
} as const;

export interface BudgetWork {
  remaining: number;
  operations: number;
}
export type BudgetComparison =
  | { status: "covered"; reason: string }
  | { status: "exceeded"; reason: string; inputs: Record<string, string> }
  | { status: "unresolved"; reason: string };
type Polynomial = Map<string, { variables: string[]; coefficient: bigint }>;
class BudgetLimit extends Error {}

/** Compare the same nonnegative input variables on both sides. No independent maxima. */
export function compareBudget(
  work: Cost,
  budget: Cost,
  bounds: Record<string, bigint>,
  effort: BudgetWork,
): BudgetComparison {
  const spend = () => {
    if (effort.remaining-- <= 0)
      throw new BudgetLimit("Budget comparison operation limit reached");
    effort.operations++;
  };
  function insert(poly: Polynomial, variables: string[], coefficient: bigint) {
    spend();
    if (variables.length > budgetLimits.degree)
      throw new BudgetLimit("Budget polynomial degree exceeds 16");
    if (!coefficient) return;
    const key = JSON.stringify(variables);
    const total = (poly.get(key)?.coefficient ?? 0n) + coefficient;
    if (total) poly.set(key, { variables, coefficient: total });
    else poly.delete(key);
    if (poly.size > budgetLimits.terms)
      throw new BudgetLimit("Budget polynomial exceeds 128 terms");
  }
  const cache = new Map<Cost, Polynomial[]>();
  function expand(cost: Cost): Polynomial[] {
    spend();
    const cached = cache.get(cost);
    if (cached) return cached;
    let result: Polynomial[];
    if (cost.kind === "unknown")
      throw new BudgetLimit(
        "Work or budget has an unresolved expression: " + cost.reason,
      );
    if (cost.kind === "constant" || cost.kind === "variable") {
      const poly: Polynomial = new Map();
      if (cost.kind === "constant" && cost.value < 0n)
        throw new BudgetLimit("Budget costs require nonnegative quantities");
      insert(
        poly,
        cost.kind === "variable" ? [cost.name] : [],
        cost.kind === "constant" ? cost.value : 1n,
      );
      result = [poly];
    } else if (cost.kind === "maximum") {
      result = [];
      for (const term of cost.terms) {
        result.push(...expand(term));
        if (result.length > budgetLimits.alternatives)
          throw new BudgetLimit(
            "Budget comparison exceeds 64 work alternatives",
          );
      }
    } else {
      const initial: Polynomial = new Map();
      if (cost.kind === "multiply") insert(initial, [], 1n);
      result = [initial];
      for (const term of cost.terms) {
        const next: Polynomial[] = [];
        for (const a of result)
          for (const b of expand(term)) {
            const poly: Polynomial = new Map();
            if (cost.kind === "add") {
              for (const t of [...a.values(), ...b.values()])
                insert(poly, t.variables, t.coefficient);
            } else
              for (const x of a.values())
                for (const y of b.values()) {
                  insert(
                    poly,
                    [...x.variables, ...y.variables].sort(),
                    x.coefficient * y.coefficient,
                  );
                }
            next.push(poly);
            if (next.length > budgetLimits.alternatives)
              throw new BudgetLimit(
                "Budget comparison exceeds 64 work alternatives",
              );
          }
        result = next;
      }
    }
    cache.set(cost, result);
    return result;
  }
  function differenceUpper(a: Polynomial, b: Polynomial): bigint | null {
    const diff: Polynomial = new Map();
    for (const t of a.values()) insert(diff, t.variables, t.coefficient);
    for (const t of b.values()) insert(diff, t.variables, -t.coefficient);
    let total = 0n;
    for (const term of diff.values()) {
      spend();
      if (!term.variables.length) {
        total += term.coefficient;
        continue;
      }
      // Nonconstant negative terms are <= 0 for nonnegative cardinalities.
      if (term.coefficient < 0n) continue;
      let product = term.coefficient;
      for (const variable of term.variables) {
        spend();
        if (!Object.hasOwn(bounds, variable)) return null;
        product *= bounds[variable]!;
      }
      total += product;
    }
    return total;
  }
  function at(
    polynomials: Polynomial[],
    values: Record<string, bigint>,
  ): bigint {
    let maximum = 0n;
    for (const poly of polynomials) {
      let sum = 0n;
      for (const t of poly.values()) {
        let product = t.coefficient;
        for (const v of t.variables) {
          spend();
          product *= values[v]!;
        }
        sum += product;
      }
      if (sum > maximum) maximum = sum;
    }
    return maximum;
  }
  try {
    const left = expand(work),
      right = expand(budget);
    if (
      left.every((a) =>
        right.some((b) => {
          const bound = differenceUpper(a, b);
          return bound !== null && bound <= 0n;
        }),
      )
    )
      return {
        status: "covered",
        reason:
          "Every abstract work alternative is within the budget for all allowed nonnegative inputs",
      };
    const variables = [
      ...new Set(
        [...left, ...right].flatMap((p) =>
          [...p.values()].flatMap((t) => t.variables),
        ),
      ),
    ];
    const zero = Object.fromEntries(variables.map((v) => [v, 0n]));
    const candidates = [zero];
    if (variables.every((v) => Object.hasOwn(bounds, v))) {
      if (variables.length <= budgetLimits.witnessVariables) {
        for (let mask = 1; mask < 2 ** variables.length; mask++)
          candidates.push(
            Object.fromEntries(
              variables.map((v, i) => [v, mask & (1 << i) ? bounds[v]! : 0n]),
            ),
          );
      } else
        candidates.push(
          Object.fromEntries(variables.map((v) => [v, bounds[v]!])),
        );
    }
    for (const inputs of candidates) {
      spend();
      const actual = at(left, inputs),
        limit = at(right, inputs);
      if (actual > limit)
        return {
          status: "exceeded",
          reason: `Abstract work bound ${actual} exceeds budget ${limit} at the same inputs`,
          inputs: Object.fromEntries(
            Object.entries(inputs).map(([key, value]) => [key, String(value)]),
          ),
        };
    }
    return {
      status: "unresolved",
      reason:
        "Cannot establish the work budget for every input; add relevant cardinality bounds or simplify the budget expression",
    };
  } catch (error) {
    if (error instanceof BudgetLimit)
      return { status: "unresolved", reason: error.message };
    throw error;
  }
}
