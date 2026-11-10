import { callable, blockedSymbols, type ProjectIR } from "../semantic/core.js";
import {
  nodeKey,
  expressions,
  exprChildren,
  type Expr,
  type Stmt,
  type Arg,
  type Callable,
} from "../language/ast.js";
import {
  initialFacts,
  rememberPredicate,
  fact,
  truth,
  refineResolved,
  feasible,
  joinFacts,
  unknown,
  typeFact,
  pathFact,
  conditionalPath,
  expressionAssumptions,
  type Fact,
  type Facts,
} from "./facts.js";
import { result, location, type AnalysisResult } from "../reporting/report.js";
import { guaranteeFeasibility } from "./feasibility.js";
import { finding, type Span } from "../shared/identity.js";
import { contractWitnessSearch } from "./contract-witness.js";
import { contractCandidate } from "./contract-candidate.js";
function hasCall(e: Expr): boolean {
  return e.kind === "call" || exprChildren(e).some(hasCall);
}
export function analyseContracts(ir: ProjectIR): AnalysisResult[] {
  const confirm = contractWitnessSearch(ir);
  const results: AnalysisResult[] = [],
    blocked = blockedSymbols(ir),
    invalidSource = blockedSymbols(ir, false);
  for (const owner of ir.declarations) {
    if (!callable(owner)) continue;
    const postFailures: ReturnType<typeof finding>[] = [],
      conditionalReturns: ReturnType<typeof finding>[] = [],
      postPending: string[] = [],
      postAssumptions = new Set<string>();
    let exits = 0;
    const postconditions = owner.meta.ensures;
    function check(span: Span, args: Arg[], env: Facts): Fact {
      const target = ir.info.get(nodeKey(span))?.target,
        callee = target ? ir.symbols.get(target) : undefined;
      if (!callee || !callable(callee)) return unknown;
      const answer = typeFact(callee.result);
      if (!callee.meta.requires.length && !callee.meta.ensures.length)
        return answer;
      const values: Facts = new Map(
          callee.params.map((p, i) => [
            p.name,
            args[i] ? fact(ir, args[i]!.expr, env) : unknown,
          ]),
        ),
        pending: string[] = [],
        diagnostics: ReturnType<typeof finding>[] = [],
        reviews: ReturnType<typeof finding>[] = [],
        candidates: {
          arguments: Record<string, string | boolean>;
          precondition: Span;
        }[] = [],
        confirmed: NonNullable<ReturnType<typeof confirm>>[] = [],
        assumptions = [
          ...new Set([
            ...(env.get(pathFact)?.assumptions ?? []),
            ...args.flatMap((arg) => expressionAssumptions(arg.expr, env)),
          ]),
        ];
      for (const [preIndex, pre] of callee.meta.requires.entries()) {
        const valid = truth(ir, pre, values);
        const witness =
          valid !== true &&
          !invalidSource.has(owner.id) &&
          !invalidSource.has(callee.id)
            ? confirm(owner as Callable, env, span, pre)
            : null;
        if (witness) {
          confirmed.push(witness);
          assumptions.push(...witness.assumptions);
          diagnostics.push(
            finding(
              "C004",
              `Call to ${callee.name} violates its precondition for source inputs ${JSON.stringify(witness.inputs)}. This example was replayed through the source executor.`,
              span,
              "error",
              [pre.span],
              [owner.name, callee.name],
            ),
          );
          continue;
        }
        if (
          valid === false &&
          (env.has(conditionalPath) || args.some((arg) => hasCall(arg.expr)))
        ) {
          pending.push(
            "Validate source-path reachability before claiming a precondition counterexample.",
          );
          reviews.push(
            finding(
              "C009",
              `Call to ${callee.name} violates its precondition if reached. Source-path reachability has not been validated; this is not a confirmed counterexample.`,
              span,
              "warning",
              [pre.span],
              [owner.name, callee.name],
            ),
          );
        } else if (valid === false)
          diagnostics.push(
            finding(
              "C004",
              `Call to ${callee.name} violates its precondition`,
              span,
              "error",
              [pre.span],
              [owner.name, callee.name],
            ),
          );
        else if (valid === null) {
          pending.push(
            `Establish ${callee.name} precondition at ${location(ir.snapshot, span)}`,
          );
          const candidate = contractCandidate(ir, pre, values);
          if (candidate) {
            candidates.push({ arguments: candidate, precondition: pre.span });
            const inputs = callee.params
              .flatMap((p, i) => {
                if (!Object.hasOwn(candidate, p.name)) return [];
                const arg = args[i]?.expr;
                const source =
                  arg?.kind === "name" && arg.name !== p.name
                    ? ` (${arg.name})`
                    : "";
                return [`${p.name}${source} = ${String(candidate[p.name])}`];
              })
              .join(", ");
            reviews.push(
              finding(
                "C006",
                `Review a possible precondition failure in ${callee.name}: ${inputs}. These candidate arguments fit individually inferred ranges and fail the rule; joint reachability is unvalidated.`,
                span,
                "warning",
                [pre.span],
                [owner.name, callee.name],
              ),
            );
          } else
            reviews.push(
              finding(
                "C007",
                `Caller rule ${preIndex + 1} of ${callee.name} is not established by the supported analysis. Review the arguments and rule or add a guard; no concrete candidate was inferred.`,
                span,
                "warning",
                [pre.span],
                [owner.name, callee.name],
              ),
            );
        }
      }
      const canAssume =
        callee.kind === "op" &&
        !pending.length &&
        !diagnostics.length &&
        !blocked.has(callee.id) &&
        !guaranteeFeasibility(callee).impossible;
      let returned = answer;
      if (canAssume && callee.meta.ensures.length) {
        values.set("result", answer);
        let consistent = true;
        for (const condition of callee.meta.ensures)
          consistent = refineResult(ir, condition, values) && consistent;
        returned = values.get("result") ?? answer;
        if (consistent && feasible(values)) {
          assumptions.push(`Trusted abstract postconditions of ${callee.id}`);
          returned = {
            ...returned,
            assumptions: [
              ...new Set([
                ...assumptions,
                `Trusted abstract postconditions of ${callee.id}`,
              ]),
            ],
          };
        } else {
          returned = unknown;
          diagnostics.push(
            finding(
              "V002",
              `Call to ${callee.name} has contradictory assumed guarantees ${callee.params.length ? "for these inputs" : "for this call"}`,
              span,
              "error",
              callee.meta.ensures.map((e) => e.span),
            ),
          );
        }
      }
      results.push(
        result(ir, owner.id + "/call-contract/" + span.start, "call-contract", {
          outcome: diagnostics.length
            ? "counterexample"
            : pending.length || blocked.has(owner.id)
              ? "inconclusive"
              : "established",
          completion: blocked.has(owner.id)
            ? "incomplete"
            : pending.length
              ? "unsupported"
              : "complete",
          ...(confirmed.length ? { method: "simulation" as const } : {}),
          diagnostics: [...diagnostics, ...reviews],
          ...(confirmed.length
            ? {
                witnessOrDerivation: {
                  kind: "source-call-counterexamples",
                  examples: confirmed,
                },
                witnessValidation: "source_replayed" as const,
              }
            : candidates.length
              ? {
                  witnessOrDerivation: {
                    kind: "candidate-call-arguments",
                    candidates,
                    limitation:
                      "Arguments fit independent inferred ranges. Joint source-path reachability has not been validated; this is not a confirmed counterexample.",
                  },
                  witnessValidation: "unvalidated" as const,
                }
              : reviews.some((review) => review.code === "C009")
                ? { witnessValidation: "unvalidated" as const }
                : {}),
          outstandingObligations: [...new Set(pending)],
          assumptions,
        }),
      );
      if (pending.length || diagnostics.length || blocked.has(callee.id))
        env.set(conditionalPath, unknown);
      return pending.length ||
        diagnostics.length ||
        blocked.has(callee.id) ||
        guaranteeFeasibility(callee).impossible
        ? unknown
        : returned;
    }
    function expr(e: Expr, env: Facts): void {
      if (e.kind === "binary" && ["&&", "||"].includes(e.op)) {
        expr(e.left, env);
        const left = truth(ir, e.left, env);
        const needed = e.op === "&&";
        if (left === !needed) return;
        const right = new Map(env);
        if (left === null) right.set(conditionalPath, unknown);
        refineResolved(ir, right, e.left, needed);
        if (feasible(right)) expr(e.right, right);
        return;
      }
      if (e.kind === "call") check(e.span, e.args, env);
      for (const child of exprChildren(e)) expr(child, env);
    }
    function post(env: Facts, e: Expr | null): void {
      exits++;
      const values = new Map(env);
      values.set("result", e ? fact(ir, e, env) : unknown);
      for (const assumed of values.get("result")?.assumptions ??
        env.get(pathFact)?.assumptions ??
        [])
        postAssumptions.add(assumed);
      for (const condition of postconditions) {
        const substituted = e ? replaceResult(condition, e) : condition;
        const valid = truth(ir, substituted, values);
        if (valid === false && env.has(conditionalPath)) {
          conditionalReturns.push(
            finding(
              "C009",
              "Return violates its postcondition if reached. Source-path reachability has not been validated.",
              e?.span ?? owner.span,
              "warning",
              [condition.span],
            ),
          );
          postPending.push(
            "Validate source-path reachability for this return.",
          );
        } else if (valid === false)
          postFailures.push(
            finding(
              "C005",
              "Return violates its postcondition",
              e?.span ?? owner.span,
              "error",
              [condition.span],
            ),
          );
        else if (valid === null)
          postPending.push(
            "Postcondition is outside supported scalar reasoning",
          );
      }
    }
    function walk(body: Stmt[], input: Facts, cancel = false): Facts | null {
      let env = new Map(input);
      if (!feasible(env)) return null;
      for (const s of body) {
        const returned =
          s.kind === "invoke" ? check(s.span, s.args, env) : unknown;
        for (const e of expressions(s)) expr(e, env);
        // Abstract operations return under their explicitly retained assumptions.
        // A concrete source call may instead terminate before this continuation.
        if (
          (s.kind === "invoke" &&
            ir.symbols.get(ir.info.get(nodeKey(s.span))?.target ?? "")?.kind !==
              "op") ||
          expressions(s).some(hasCall)
        )
          env.set(conditionalPath, unknown);
        if (s.kind === "assert") {
          const fails = truth(ir, s.expr, env) === false;
          refineResolved(ir, env, s.expr, true);
          if (fails || !feasible(env)) {
            results.push(
              result(
                ir,
                owner.id + "/assert-feasibility/" + s.span.start,
                "feasibility",
                {
                  outcome: "inconclusive",
                  completion: "unsupported",
                  assumptions: expressionAssumptions(s.expr, env),
                  diagnostics: [
                    finding(
                      "C008",
                      "Assertion has no feasible continuation under the inferred path conditions. Review this assertion and the preceding constraints.",
                      s.expr.span,
                      "warning",
                      [],
                      [owner.name],
                    ),
                  ],
                  outstandingObligations: [
                    "An assertion blocks every continuation in the supported path analysis; no executable counterexample is claimed.",
                  ],
                },
              ),
            );
            return null;
          }
          env.set(conditionalPath, unknown);
        }
        if (s.kind === "let")
          env.set(s.name, {
            ...rememberPredicate(fact(ir, s.expr, env), s.expr, env),
            bindingId: nodeKey(s.span),
          });
        if (s.kind === "invoke" && s.binding)
          env.set(s.binding, { ...returned, bindingId: nodeKey(s.span) });
        if (s.kind === "if") {
          const valid = truth(ir, s.test, env),
            yes = new Map(env),
            no = new Map(env);
          yes.set(conditionalPath, unknown);
          no.set(conditionalPath, unknown);
          const pathAssumptions = expressionAssumptions(s.test, env);
          if (pathAssumptions.length) {
            yes.set(pathFact, { ...unknown, assumptions: pathAssumptions });
            no.set(pathFact, { ...unknown, assumptions: pathAssumptions });
          }
          refineResolved(ir, yes, s.test, true);
          refineResolved(ir, no, s.test, false);
          const a = valid !== false ? walk(s.yes, yes, cancel) : null,
            b = valid !== true ? walk(s.no, no, cancel) : null;
          const surviving = [a, b].filter(
            (facts): facts is Facts => facts !== null,
          );
          if (!surviving.length) return null;
          env = joinFacts(surviving);
        } else if (s.kind === "match") {
          env.set(conditionalPath, unknown);
          const all = s.arms.map((a) => walk(a.body, new Map(env), cancel));
          const surviving = all.filter(
            (facts): facts is Facts => facts !== null,
          );
          if (all.length && !surviving.length) return null;
          if (surviving.length) env = joinFacts(surviving);
        } else if (s.kind === "for" || s.kind === "retry") {
          env.set(conditionalPath, unknown);
          const child = new Map(env);
          if (s.kind === "for") {
            const type = ir.info.get(nodeKey(s.count.span))?.type;
            if (type?.kind === "list") {
              if (s.count.kind === "list" && !s.count.items.length) continue;
              const element = type.element;
              child.set(
                s.name,
                element.kind === "primitive"
                  ? typeFact({
                      name: element.name,
                      args: [],
                      span: s.count.span,
                    })
                  : unknown,
              );
            } else if (type?.kind === "primitive" && type.name === "Nat") {
              const count = fact(ir, s.count, env);
              if (
                count.kind === "integer" &&
                count.max !== null &&
                count.max <= 0n
              )
                continue;
              child.set(s.name, {
                kind: "integer",
                min: 0n,
                max:
                  count.kind === "integer" && count.max !== null
                    ? count.max - 1n
                    : null,
                ...(count.assumptions
                  ? { assumptions: count.assumptions }
                  : {}),
              });
            } else child.set(s.name, unknown);
            child.set(s.name, {
              ...(child.get(s.name) ?? unknown),
              bindingId: nodeKey(s.span),
            });
          }
          walk(s.body, child, cancel);
        } else if (s.kind === "return" || s.kind === "propagate") {
          if (!cancel) post(env, s.expr);
          return null;
        }
      }
      return env;
    }
    const env = initialFacts(owner, ir);
    if (owner.meta.requires.length) env.set(conditionalPath, unknown);
    if (owner.body) {
      const fallthrough = walk(owner.body, env);
      if (fallthrough) post(fallthrough, null);
    }
    if (owner.cancel) {
      const cleanup = new Map(env);
      cleanup.set(conditionalPath, unknown);
      walk(owner.cancel, cleanup, true);
    }
    if (owner.expr) {
      expr(owner.expr, env);
      post(env, owner.expr);
    }
    const confirmedReturns: NonNullable<ReturnType<typeof confirm>>[] = [];
    if (
      owner.kind === "flow" &&
      !invalidSource.has(owner.id) &&
      postPending.length
    ) {
      for (const condition of postconditions) {
        if (
          postFailures.some((f) =>
            f.related.some((s) => nodeKey(s) === nodeKey(condition.span)),
          )
        )
          continue;
        const example = confirm(
          owner,
          initialFacts(owner, ir),
          condition.span,
          condition,
          "postcondition",
        );
        if (!example) continue;
        confirmedReturns.push(example);
        postFailures.push(
          finding(
            "C005",
            `Return guarantee fails for source inputs ${JSON.stringify(example.inputs)}. This example was replayed through the source executor.`,
            condition.span,
            "error",
          ),
        );
        for (const assumption of example.assumptions)
          postAssumptions.add(assumption);
      }
    }
    if (owner.kind !== "op" && owner.meta.ensures.length)
      results.push(
        result(ir, owner.id + "/postconditions", "contracts", {
          outcome: postFailures.length
            ? "counterexample"
            : postPending.length || !exits || blocked.has(owner.id)
              ? "inconclusive"
              : "established",
          completion: blocked.has(owner.id)
            ? "incomplete"
            : confirmedReturns.length
              ? "complete"
              : postPending.length || !exits
                ? "unsupported"
                : "complete",
          diagnostics: [
            ...postFailures,
            ...conditionalReturns.filter(
              (f) =>
                !confirmedReturns.some((e) =>
                  f.related.some((s) => nodeKey(s) === nodeKey(e.condition)),
                ),
            ),
          ],
          ...(confirmedReturns.length
            ? {
                method: "simulation" as const,
                witnessValidation: "source_replayed" as const,
              }
            : conditionalReturns.length
              ? { witnessValidation: "unvalidated" as const }
              : {}),
          assumptions: [...postAssumptions],
          outstandingObligations: confirmedReturns.length
            ? []
            : postPending.length
              ? [...new Set(postPending)]
              : !exits
                ? ["No feasible return was established"]
                : [],
          witnessOrDerivation: confirmedReturns.length
            ? {
                kind: "source-return-counterexamples",
                examples: confirmedReturns,
              }
            : {
                method: "branch-sensitive scalar intervals",
                checkedReturns: exits,
              },
        }),
      );
  }
  return results;
}

function replaceResult(expression: Expr, value: Expr): Expr {
  if (expression.kind === "name" && expression.name === "result") return value;
  if (expression.kind === "binary")
    return {
      ...expression,
      left: replaceResult(expression.left, value),
      right: replaceResult(expression.right, value),
    };
  if (expression.kind === "unary")
    return { ...expression, expr: replaceResult(expression.expr, value) };
  return expression;
}

/** Narrow only the abstract result, never caller arguments. Unsupported clauses
 * retain their uncertainty; supported conjuncts still follow from the assumption. */
function refineResult(ir: ProjectIR, condition: Expr, values: Facts): boolean {
  if (condition.kind === "binary" && condition.op === "&&") {
    const left = refineResult(ir, condition.left, values);
    const right = refineResult(ir, condition.right, values);
    return left && right;
  }
  if (truth(ir, condition, values) === false) return false;
  if (
    (condition.kind === "name" && condition.name === "result") ||
    (condition.kind === "unary" &&
      condition.op === "!" &&
      condition.expr.kind === "name" &&
      condition.expr.name === "result")
  ) {
    refineResolved(ir, values, condition, true);
    return feasible(values);
  }
  if (condition.kind !== "binary") return true;
  let left = condition.left,
    right = condition.right,
    op = condition.op;
  if (right.kind === "name" && right.name === "result") {
    [left, right] = [right, left];
    op =
      (
        { "<": ">", ">": "<", "<=": ">=", ">=": "<=" } as Record<string, string>
      )[op] ?? op;
  }
  if (left.kind !== "name" || left.name !== "result") return true;
  const constant = fact(ir, right, values);
  if (
    constant.kind === "integer" &&
    constant.min !== null &&
    constant.min === constant.max
  )
    refineResolved(
      ir,
      values,
      {
        ...condition,
        op,
        left,
        right: { kind: "literal", value: constant.min, span: right.span },
      },
      true,
    );
  if (
    constant.kind === "boolean" &&
    constant.value !== null &&
    (op === "==" || op === "!=")
  )
    refineResolved(
      ir,
      values,
      left,
      op === "==" ? constant.value : !constant.value,
    );
  return feasible(values);
}
