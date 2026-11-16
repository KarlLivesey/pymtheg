// SPDX-License-Identifier: MIT
import {
  nodeKey,
  exprChildren,
  expressions,
  blocks,
  type Expr,
  type Stmt,
  type Callable,
  type Resource,
} from "../language/ast.js";
import {
  type ProjectIR,
  callable,
  variants,
  blockedSymbols,
  resourceResult,
} from "../semantic/core.js";
import { obligationDischarged } from "../shared/judgements.js";
import { finding, type Finding, type Span } from "../shared/identity.js";
import { result, type AnalysisResult } from "../reporting/report.js";
interface Owned {
  resource: Resource;
  states: Set<string>;
  moved: "no" | "yes" | "maybe";
  borrow: boolean;
  origin: Span;
  guard?: { result: string; tag: string };
}
type State = Map<string, Owned>;
const clone = (s: State): State =>
  new Map([...s].map(([k, v]) => [k, { ...v, states: new Set(v.states) }]));
function join(a: State | null, b: State | null): State | null {
  if (!a) return b ? clone(b) : null;
  if (!b) return clone(a);
  const s = clone(a);
  for (const [name, v] of b) {
    const old = s.get(name);
    if (!old) {
      s.set(name, { ...v, moved: "maybe" });
      continue;
    }
    for (const t of v.states) old.states.add(t);
    if (old.moved !== v.moved) old.moved = "maybe";
  }
  return s;
}
export function analyseOwnership(ir: ProjectIR): AnalysisResult[] {
  const results: AnalysisResult[] = [],
    blocked = blockedSymbols(ir),
    verified = new Map<string, boolean>(),
    inheritedAssumptions = new Map<string, string[]>(),
    active = new Set<string>();
  let steps = 0;
  function analyse(d: Callable): boolean {
    if (verified.has(d.id)) return verified.get(d.id)!;
    if (active.has(d.id)) return false;
    active.add(d.id);
    const ds: Finding[] = [],
      obligations = new Set<string>(),
      assumptions = new Set<string>();
    let used = false;
    const aliases = new Map<string, string>();
    const collectAliases = (body: Stmt[]): void => {
      for (const s of body) {
        if (s.kind === "match" && s.expr.kind === "name")
          for (const arm of s.arms)
            if (arm.tag === "Ok" && arm.binding)
              aliases.set(s.expr.name, arm.binding);
        for (const b of blocks(s)) collectAliases(b);
      }
    };
    if (d.body) collectAliases(d.body);
    const emit = (
      code: string,
      message: string,
      span: Span,
      related: Span[] = [],
      severity: Finding["severity"] = "error",
    ): void => {
      if (
        !ds.some(
          (x) =>
            x.code === code &&
            x.span.start === span.start &&
            x.message === message,
        )
      )
        ds.push(finding(code, message, span, severity, related, [d.name]));
    };
    const initial: State = new Map();
    for (const p of d.params) {
      const t = ir.types.get(nodeKey(p.type.span));
      const r = t?.kind === "nominal" ? ir.symbols.get(t.id) : undefined;
      if (r?.kind === "resource") {
        used = true;
        if (p.mode === "value")
          emit("O001", `Resource ${p.name} requires take or borrow`, p.span);
        initial.set(p.name, {
          resource: r,
          states: new Set([r.initial]),
          moved: "no",
          borrow: p.mode === "borrow",
          origin: p.span,
        });
      }
    }
    function use(name: string, s: State, span: Span): Owned | undefined {
      const r = s.get(name);
      if (r && r.moved !== "no")
        emit(
          "O003",
          `${name} used after ${r.moved === "maybe" ? "possible " : ""}ownership transfer`,
          span,
          [r.origin],
        );
      return r;
    }
    function checkExpr(e: Expr, s: State): void {
      if (e.kind === "name") use(e.name, s, e.span);
      for (const c of exprChildren(e)) checkExpr(c, s);
    }
    function exit(s: State, span: Span, kind: string): void {
      for (const [name, r] of s)
        if (!r.borrow) {
          const unfinished = [...r.states].filter(
            (t) => !r.resource.terminal.includes(t),
          );
          if (
            !obligationDischarged(
              r.states,
              r.resource.terminal,
              r.moved === "yes",
            )
          )
            emit(
              "O004",
              `${kind} may leave ${name} unsettled in ${unfinished.join("|")}`,
              span,
              [r.origin],
            );
        }
    }
    function cancel(s: State, span: Span): void {
      if (![...s.values()].some((r) => !r.borrow && r.moved !== "yes")) return;
      if (!d.cancel) {
        obligations.add(
          "Cancellation cleanup is unspecified for owned resources",
        );
        return;
      }
      const cancelled = clone(s);
      for (const [key, r] of cancelled)
        if (r.guard) {
          const alias = aliases.get(r.guard.result);
          if (alias) {
            const copy = { ...r };
            delete copy.guard;
            cancelled.delete(key);
            cancelled.set(alias, copy);
          }
        }
      const after = walk(d.cancel, cancelled, true);
      if (after) exit(after, span, "Cancellation");
    }
    function walk(body: Stmt[], input: State, inCancel = false): State | null {
      let current: State | null = clone(input);
      const introduced = new Set<string>();
      for (const s of body) {
        steps++;
        if (!current) break;
        const state: State = current;
        if (!inCancel) cancel(state, s.span);
        for (const e of expressions(s)) checkExpr(e, state);
        switch (s.kind) {
          case "own": {
            used = true;
            const resource =
              ir.declarations.find(
                (d) =>
                  d.kind === "resource" &&
                  d.name === s.resource &&
                  d.span.file === s.span.file,
              ) ??
              ir.declarations.find(
                (d) => d.kind === "resource" && d.name === s.resource,
              );
            if (resource?.kind === "resource") {
              if (state.has(s.name))
                emit(
                  "O007",
                  `Owned identity ${s.name} cannot be rebound`,
                  s.span,
                );
              state.set(s.name, {
                resource,
                states: new Set([resource.initial]),
                moved: "no",
                borrow: false,
                origin: s.span,
              });
              introduced.add(s.name);
            }
            break;
          }
          case "transition": {
            // Cancellation handler transitions are conditional on acquisition
            // and caller ownership (docs/support.md): a borrowed or already
            // transferred resource is skipped, as in flow exploration.
            if (inCancel) {
              const held = state.get(s.name);
              if (!held || held.borrow || held.moved === "yes") break;
            }
            const r = inCancel ? state.get(s.name) : use(s.name, state, s.span);
            if (!r) {
              if (!inCancel)
                emit("O003", `No owned resource ${s.name}`, s.span);
              break;
            }
            if (r.borrow)
              emit(
                "O005",
                `Cannot mutate borrowed resource ${s.name}`,
                s.span,
                [r.origin],
              );
            if (!r.resource.states.includes(s.state))
              emit("R002", `Unknown lifecycle state ${s.state}`, s.span, [
                r.resource.span,
              ]);
            for (const from of r.states)
              if (
                !r.resource.transitions.some(
                  (t) => t.from === from && t.to === s.state,
                )
              )
                emit(
                  "R002",
                  `Illegal transition ${s.name}: ${from} -> ${s.state}${inCancel ? " (during cancellation cleanup)" : ""}`,
                  s.span,
                  [r.resource.span],
                );
            r.states = new Set([s.state]);
            break;
          }
          case "move": {
            const r = use(s.name, state, s.span);
            if (r) {
              if (r.borrow)
                emit("O005", `Cannot transfer borrowed ${s.name}`, s.span);
              r.moved = "yes";
              obligations.add(
                `Transfer ${s.name} has no receiver/settlement summary`,
              );
            }
            break;
          }
          case "invoke": {
            const id = ir.info.get(nodeKey(s.span))?.target,
              target = id ? ir.symbols.get(id) : undefined;
            for (let i = 0; i < s.args.length; i++) {
              const a = s.args[i]!;
              if (a.expr.kind !== "name") continue;
              const r = use(a.expr.name, state, a.expr.span);
              if (!r) continue;
              if (a.mode === "value")
                emit(
                  "O007",
                  `Resource ${a.expr.name} cannot be copied`,
                  a.expr.span,
                  [r.origin],
                );
              if ([...r.states].some((state) => state !== r.resource.initial))
                emit(
                  "R003",
                  `${target?.name ?? "Callee"} expects ${r.resource.name}.${r.resource.initial}`,
                  a.expr.span,
                  [r.resource.span],
                );
              if (a.mode === "take") {
                if (r.borrow)
                  emit(
                    "O005",
                    `Cannot transfer borrowed ${a.expr.name}`,
                    a.expr.span,
                    [r.origin],
                  );
                r.moved = "yes";
                if (target && callable(target)) {
                  const parameter = target.params[i];
                  let settled = false;
                  if (target.kind === "flow") {
                    settled = analyse(target);
                    for (const assumption of inheritedAssumptions.get(
                      target.id,
                    ) ?? [])
                      assumptions.add(assumption);
                  } else if (target.kind === "op" && parameter) {
                    const declared = target.meta.settles
                        .filter((x) => x.param === parameter.name)
                        .flatMap((x) => x.outcomes),
                      outcomes = [
                        ...variants(
                          ir,
                          ir.types.get(nodeKey(target.result.span))!,
                        ).keys(),
                      ];
                    if (!outcomes.length)
                      outcomes.push(
                        target.result.name === "Unit" ? "Unit" : "Return",
                      );
                    settled = [...outcomes, "Cancelled"].every((o) =>
                      declared.includes(o),
                    );
                    if (settled)
                      assumptions.add(
                        `Trusted ${target.name}.${parameter.name} settlement on ${[...outcomes, "Cancelled"].join(", ")}`,
                      );
                  }
                  if (!settled) {
                    obligations.add(
                      `${a.expr.name} obligation transferred to ${target.name}; settlement is not established on every outcome/cancellation`,
                    );
                    emit(
                      "O006",
                      `Transfer to ${target.name} preserves an unresolved cleanup obligation for ${a.expr.name}`,
                      s.span,
                      [target.span],
                      "warning",
                    );
                  }
                } else
                  obligations.add(
                    `Unknown receiver owns obligation for ${a.expr.name}`,
                  );
              }
            }
            const returned =
              target && callable(target)
                ? resourceResult(ir, ir.types.get(nodeKey(target.result.span)))
                : null;
            if (returned) {
              used = true;
              if (
                target &&
                callable(target) &&
                target.kind === "op" &&
                !target.meta.creates
              )
                obligations.add(
                  `${target.name} must declare creates result or define resource-return provenance`,
                );
              if (!s.binding)
                emit("O004", "Returned owned resource is discarded", s.span);
              else
                state.set(returned.wrapped ? s.binding + ":Ok" : s.binding, {
                  resource: returned.resource,
                  states: new Set([returned.resource.initial]),
                  moved: "no",
                  borrow: false,
                  origin: s.span,
                  ...(returned.wrapped
                    ? { guard: { result: s.binding, tag: "Ok" } }
                    : {}),
                });
            }
            break;
          }
          case "let": {
            const t = ir.info.get(nodeKey(s.expr.span))?.type;
            if (
              t?.kind === "nominal" &&
              ir.symbols.get(t.id)?.kind === "resource"
            )
              emit(
                "O007",
                "Resource aliases are unsupported; use explicit take/return",
                s.span,
              );
            break;
          }
          case "if": {
            if (s.test.kind === "literal" && typeof s.test.value === "boolean")
              current = walk(s.test.value ? s.yes : s.no, state, inCancel);
            else
              current = join(
                walk(s.yes, state, inCancel),
                walk(s.no, state, inCancel),
              );
            break;
          }
          case "match": {
            let merged: State | null = null;
            for (const arm of s.arms) {
              const branch = clone(state);
              if (s.expr.kind === "name") {
                for (const [key, r] of [...branch])
                  if (r.guard?.result === s.expr.name) {
                    branch.delete(key);
                    if (r.guard.tag === arm.tag && arm.binding) {
                      const copy = { ...r };
                      delete copy.guard;
                      branch.set(arm.binding, copy);
                    }
                  }
              }
              merged = join(merged, walk(arm.body, branch, inCancel));
            }
            current = merged;
            break;
          }
          case "for":
          case "retry": {
            if (s.count.kind === "literal" && s.count.value === 0n) break;
            const outer = new Set(state.keys());
            const touched = (body: Stmt[]): boolean =>
              body.some(
                (x) =>
                  ((x.kind === "transition" || x.kind === "move") &&
                    outer.has(x.name)) ||
                  (x.kind === "invoke" &&
                    x.args.some(
                      (a) =>
                        a.mode === "take" &&
                        a.expr.kind === "name" &&
                        outer.has(a.expr.name),
                    )) ||
                  blocks(x).some(touched),
              );
            if (touched(s.body)) {
              obligations.add(
                "Outer resource mutation/transfer in loops requires an invariant (unsupported v0)",
              );
              emit(
                "O008",
                "Outer owned resources cannot be mutated/transferred in repeated blocks without a supported invariant",
                s.span,
                [],
                "warning",
              );
            }
            const after = walk(s.body, state, inCancel);
            if (after) {
              for (const [name, r] of after)
                if (
                  !outer.has(name) &&
                  !r.borrow &&
                  !obligationDischarged(
                    r.states,
                    r.resource.terminal,
                    r.moved === "yes",
                  )
                )
                  emit(
                    "O004",
                    `Iteration may leave ${name} unsettled`,
                    s.span,
                    [r.origin],
                  );
              for (const name of after.keys())
                if (!outer.has(name)) after.delete(name);
            }
            current = join(state, after);
            break;
          }
          case "return":
          case "propagate": {
            const mark = (e: Expr): void => {
              if (e.kind === "name") {
                const r = state.get(e.name);
                if (r) {
                  if (r.borrow)
                    emit(
                      "O005",
                      `Borrowed ${e.name} escapes through return`,
                      s.span,
                      [r.origin],
                    );
                  else r.moved = "yes";
                }
              }
              if (e.kind === "call" && !ir.info.get(nodeKey(e.span))?.target)
                for (const a of e.args) mark(a.expr);
            };
            mark(s.expr);
            exit(state, s.span, inCancel ? "Cancellation return" : "Return");
            current = null;
            break;
          }
          case "unknown":
            obligations.add(s.reason);
            break;
        }
      }
      if (current) {
        if (!inCancel) cancel(current, body.at(-1)?.span ?? d.span);
        for (const name of introduced) {
          const r = current.get(name);
          if (
            r &&
            !r.borrow &&
            !obligationDischarged(
              r.states,
              r.resource.terminal,
              r.moved === "yes",
            )
          )
            emit(
              "O004",
              `Scope exit may leave ${name} unsettled`,
              body.at(-1)?.span ?? d.span,
              [r.origin],
            );
          current.delete(name);
        }
      }
      return current;
    }
    if (d.body) {
      const end = walk(d.body, initial);
      if (end) exit(end, d.span, "Flow exit");
    }
    const ok =
      !blocked.has(d.id) &&
      !ds.some((x) => x.severity === "error") &&
      !obligations.size;
    verified.set(d.id, ok);
    inheritedAssumptions.set(d.id, [...assumptions]);
    active.delete(d.id);
    if (used || ds.length || obligations.size)
      results.push(
        result(ir, d.id + "/ownership", "ownership-lifecycle", {
          outcome: ds.some((x) => x.severity === "error")
            ? "counterexample"
            : ok
              ? "established"
              : "inconclusive",
          completion:
            blocked.has(d.id) || obligations.size ? "incomplete" : "complete",
          method: "abstract_interpretation",
          diagnostics: ds,
          assumptions: [...assumptions],
          outstandingObligations: [...obligations],
          witnessOrDerivation: {
            subset:
              "single owner; lexical read borrows; branch state unions; every explicit exit; loop-local resources",
            candidate: "conservative paths; no satisfiability proof",
          },
        }),
      );
    return ok;
  }
  for (const d of ir.declarations) if (d.kind === "flow") analyse(d);
  ir.measurements.ownershipStatements = steps;
  return results;
}
