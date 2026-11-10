import { type ProjectIR, callable } from "../semantic/core.js";
import {
  type Stmt,
  blocks,
  nodeKey,
  type Expr,
  exprChildren,
} from "../language/ast.js";
import { safeToSuggestHoist } from "../shared/judgements.js";
import { result, type AnalysisResult } from "../reporting/report.js";
import { finding, hash, json } from "../shared/identity.js";
export function repeatedWork(ir: ProjectIR): AnalysisResult[] {
  const results: AnalysisResult[] = [];
  let effectVisits = 0;
  for (const flow of ir.declarations) {
    if (flow.kind !== "flow" || !flow.body) continue;
    const entries: {
      stmt: Extract<Stmt, { kind: "invoke" }>;
      target: string;
      loopVars: Set<string>;
      loop: boolean;
    }[] = [];
    function walk(body: Stmt[], loopVars: Set<string>, loop = false): void {
      for (const s of body) {
        if (s.kind === "invoke") {
          const target = ir.info.get(nodeKey(s.span))?.target;
          if (target)
            entries.push({
              stmt: s,
              target,
              loopVars: new Set(loopVars),
              loop,
            });
        }
        if (s.kind === "for") {
          if (
            s.count.kind === "literal" &&
            typeof s.count.value === "bigint" &&
            s.count.value <= 1n
          ) {
            if (s.count.value === 1n) walk(s.body, loopVars, loop);
          } else walk(s.body, new Set([...loopVars, s.name]), true);
        } else if (s.kind === "retry") walk(s.body, loopVars, true);
        else for (const b of blocks(s)) walk(b, loopVars, loop);
      }
    }
    walk(flow.body, new Set());
    const groups = new Map<string, typeof entries>();
    const valueParameters = new Set(
      flow.params.filter((p) => p.mode === "value").map((p) => p.name),
    );
    const effectTargets = new Map<string, Set<string>>();
    for (const id of new Set(entries.map((e) => e.target)))
      for (const effect of ir.effects.get(id) ?? []) {
        effectVisits++;
        const targets = effectTargets.get(effect) ?? new Set<string>();
        targets.add(id);
        effectTargets.set(effect, targets);
      }
    const mutationCache = new Map<string, boolean>();
    const canonical = (e: Expr): unknown => {
      switch (e.kind) {
        case "name":
          return ["local", e.name];
        case "literal":
          return ["literal", e.value];
        case "field":
          return ["field", canonical(e.base), e.name];
        case "call":
          return [
            "call",
            ir.info.get(nodeKey(e.span))?.target,
            e.args.map((a) => canonical(a.expr)),
          ];
        case "unary":
          return [e.kind, e.op, canonical(e.expr)];
        case "binary":
          return [e.kind, e.op, canonical(e.left), canonical(e.right)];
        case "record":
          return [
            e.kind,
            ir.info.get(nodeKey(e.span))?.type,
            e.fields.map((f) => [f.name, canonical(f.value)]),
          ];
        default:
          return [e.kind, ...exprChildren(e).map(canonical)];
      }
    };
    for (const e of entries) {
      const key =
          e.target +
          hash(json(e.stmt.args.map((a) => [a.mode, canonical(a.expr)]))),
        g = groups.get(key) ?? [];
      g.push(e);
      groups.set(key, g);
    }
    for (const group of groups.values()) {
      if (group.length < 2 && !group.some((e) => e.loop)) continue;
      const first = group[0]!,
        target = ir.symbols.get(first.target);
      if (!target || !callable(target)) continue;
      const inputsStable = (e: Expr, loopVars: Set<string>): boolean =>
        e.kind === "literal" ||
        (e.kind === "name" &&
          !loopVars.has(e.name) &&
          valueParameters.has(e.name));
      const stableArgs = group.every((e) =>
          e.stmt.args.every(
            (a) => a.mode === "value" && inputsStable(a.expr, e.loopVars),
          ),
        ),
        mutationAbsent =
          mutationCache.get(target.id) ??
          target.meta.effects.every((effect) => {
            effectVisits++;
            const targets = effectTargets.get(effect);
            return (
              !targets ||
              targets.size === 0 ||
              (targets.size === 1 && targets.has(target.id))
            );
          });
      mutationCache.set(target.id, mutationAbsent);
      const hoist = safeToSuggestHoist(
          target.meta.stable,
          stableArgs,
          mutationAbsent,
        ),
        message = `Repeated call candidate ${flow.name} -> ${target.name}${first.loop ? " inside repeated block" : ""}; ${hoist ? "stable inputs and the declared consistency allow investigating whether this call can run once" : "changing inputs, state or consistency may require every call"}`;
      results.push(
        result(
          ir,
          flow.id +
            "/repeated/" +
            hash(first.target + String(first.stmt.span.start)),
          "repeated-work",
          {
            outcome: "inconclusive",
            method: "heuristic",
            diagnostics: [
              finding(
                "W001",
                message,
                first.stmt.span,
                hoist ? "warning" : "info",
                group.slice(1).map((e) => e.stmt.span),
                [flow.name, target.name],
              ),
            ],
            witnessOrDerivation: {
              syntacticOccurrences: group.length,
              repeatedBlock: group.some((e) => e.loop),
              safeToInvestigateHoist: hoist,
              batching: "No suggestion without API capacity contract",
            },
            assumptions: hoist
              ? [
                  `${target.id}: stable consistent reads for identical arguments`,
                ]
              : [],
          },
        ),
      );
    }
  }
  ir.measurements.repeatedEffectVisits = effectVisits;
  return results;
}
