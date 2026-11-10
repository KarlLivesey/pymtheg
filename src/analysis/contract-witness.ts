import type { ProjectIR, Type } from "../semantic/core.js";
import { nodeKey, type Callable, type Expr } from "../language/ast.js";
import type { Span } from "../shared/identity.js";
import { tryFlow } from "../behaviour/trial.js";
import { initialFacts, type Facts } from "./facts.js";
import { witnessInputs } from "./witness-inputs.js";

/** Bounded source executions can confirm a violation, never establish universal safety. */
export function contractWitnessSearch(ir: ProjectIR) {
  const cache = new Map<
    string,
    {
      inputs: Record<string, unknown>;
      trial: ReturnType<typeof tryFlow>;
      error?: { code: string; span: Span; condition?: Span };
    }
  >();
  const same = (a: Span | undefined, b: Span) =>
    a?.file === b.file && a.start === b.start && a.end === b.end;
  return (
    owner: Callable,
    env: Facts,
    call: Span,
    condition: Expr,
    mode: "precondition" | "postcondition" = "precondition",
  ) => {
    if (owner.kind !== "flow") return null;
    let remainingSteps = 64000;
    const priorities = witnessInputs(ir, owner, call, condition, mode);
    const roles = priorities.roles;
    const entry = initialFacts(owner, ir);
    function values(
      type: Type | undefined,
      name: string,
      depth = 0,
    ): unknown[] {
      if (!type || depth > 3) return [];
      const local = env.get(name),
        original = entry.get(name);
      const range = local?.bindingId === original?.bindingId ? local : original;
      if (type.kind === "primitive") {
        if (type.name === "Unit") return [null];
        if (type.name === "String")
          return [...new Set(["", ...priorities.strings(name)])].slice(0, 8);
        if (type.name === "Bool")
          return range?.kind === "boolean" && range.value !== null
            ? [range.value]
            : [false, true];
        if (type.name === "Int" || type.name === "Nat") {
          const r = range?.kind === "integer" ? range : null;
          return [
            ...new Set(
              [
                r?.min,
                r?.max,
                ...priorities.numbers(name),
                0n,
                1n,
                -1n,
                2n,
                -2n,
                3n,
                -3n,
                5n,
                -5n,
              ].filter(
                (n): n is bigint =>
                  n !== undefined &&
                  n !== null &&
                  (type.name !== "Nat" || n >= 0n) &&
                  (r?.min == null || n >= r.min) &&
                  (r?.max == null || n <= r.max) &&
                  !r?.excluded?.includes(n),
              ),
            ),
          ]
            .slice(0, 12)
            .map(String);
        }
      }
      if (type.kind === "list")
        return [
          [],
          ...values(type.element, "", depth + 1)
            .slice(0, 3)
            .map((v) => [v]),
        ];
      if (type.kind === "nominal") {
        const d = ir.symbols.get(type.id);
        if (d?.kind !== "type") return [];
        if (d.fields) {
          const record: Record<string, unknown> = {};
          for (const f of d.fields) {
            const v = values(ir.types.get(nodeKey(f.type.span)), "", depth + 1);
            if (!v.length) return [];
            record[f.name] = v[0];
          }
          return [record];
        }
        return d.variants
          .filter((v) => !v.payload)
          .map((v) => v.name)
          .slice(0, 4);
      }
      return [];
    }
    const variableInputs = new Set(
      [...owner.params]
        .filter((p) => roles.has(p.name))
        .sort(
          (a, b) =>
            Number(priorities.targets.has(b.name)) -
              Number(priorities.targets.has(a.name)) ||
            ((roles.get(a.name) ?? "") < (roles.get(b.name) ?? "")
              ? -1
              : (roles.get(a.name) ?? "") > (roles.get(b.name) ?? "")
                ? 1
                : 0),
        )
        .slice(0, 8)
        .map((p) => p.name),
    );
    const choices = owner.params
      .map((p) => ({
        name: p.name,
        role: roles.get(p.name) ?? "\uffff",
        target: priorities.targets.has(p.name),
        boolean: p.type.name === "Bool",
        values: variableInputs.has(p.name)
          ? values(ir.types.get(nodeKey(p.type.span)), p.name)
          : values(ir.types.get(nodeKey(p.type.span)), p.name).slice(0, 1),
      }))
      .sort((a, b) => (a.role === b.role ? 0 : a.role < b.role ? -1 : 1));
    if (choices.some((c) => !c.values.length)) return null;
    const inputs: Record<string, unknown> = {};
    let attempts = 0;
    const tried = new Set<string>();
    function attempt(indices: number[]): ReturnType<typeof confirmed> | null {
      if (attempts >= 64 || remainingSteps <= 0) return null;
      for (const [i, choice] of choices.entries())
        inputs[choice.name] = choice.values[indices[i]!]!;
      const key = owner.id + JSON.stringify(inputs);
      if (tried.has(key)) return null;
      tried.add(key);
      attempts++;
      let seen = cache.get(key);
      if (!seen) {
        let error: { code: string; span: Span; condition?: Span } | undefined;
        const trial = tryFlow(ir, owner.id, inputs, {
          maxSteps: Math.min(1000, remainingSteps),
          onViolation: (e) => {
            error = e;
          },
        });
        seen = { inputs: { ...inputs }, trial, ...(error ? { error } : {}) };
        cache.set(key, seen);
        while (cache.size > 256) cache.delete(cache.keys().next().value!);
      }
      remainingSteps -= seen.trial.steps;
      return seen ? confirmed(seen) : null;
    }
    function confirmed(seen: NonNullable<ReturnType<typeof cache.get>>) {
      return seen.trial.completion === "violated" &&
        seen.error?.code === mode &&
        (mode === "postcondition"
          ? same(seen.error.span, condition.span)
          : same(seen.error.span, call) &&
            same(seen.error.condition, condition.span))
        ? {
            kind:
              mode === "precondition"
                ? "source-call-counterexample"
                : "source-return-counterexample",
            entry: owner.id,
            inputs: seen.inputs,
            ...(mode === "precondition" ? { call } : {}),
            condition: condition.span,
            steps: seen.trial.steps,
            assumptions: seen.trial.assumptions,
            sourceReplay: true,
          }
        : null;
    }
    // Roles describe canonical parameter contexts, independent of spelling,
    // declaration order and Boolean conjunct order. Unused lets add no candidates.
    const base = choices.map(() => 0);
    let found = attempt(base);
    if (found) return found;
    const boundaries = [...base],
      fixed = new Set<string>();
    const dimensions = new Map(choices.map((c, i) => [c.name, i]));
    for (let pass = 0; pass < choices.length; pass++)
      for (const relation of priorities.relations) {
        const pending = [...relation.terms].filter(
          ([name]) => !fixed.has(name),
        );
        if (pending.length !== 1) continue;
        const [name, coefficient] = pending[0]!,
          dimension = dimensions.get(name);
        if (dimension === undefined) continue;
        let numerator = -relation.constant,
          complete = true;
        for (const [other, factor] of relation.terms)
          if (other !== name) {
            const i = dimensions.get(other),
              value =
                i === undefined
                  ? undefined
                  : choices[i]!.values[boundaries[i]!];
            if (typeof value !== "string" || !/^[-]?\d+$/.test(value)) {
              complete = false;
              break;
            }
            numerator -= factor * BigInt(value);
          }
        if (!complete || numerator % coefficient) continue;
        const value = String(numerator / coefficient),
          index = choices[dimension]!.values.indexOf(value);
        if (index < 0) continue;
        boundaries[dimension] = index;
        fixed.add(name);
      }
    found = attempt(boundaries);
    if (found) return found;
    const width = Math.max(1, ...choices.map((c) => c.values.length));
    for (let value = 1; value < Math.min(width, 5); value++)
      for (let i = 0; i < choices.length; i++) {
        if (value >= choices[i]!.values.length) continue;
        const indices = [...base];
        indices[i] = value;
        found = attempt(indices);
        if (found) return found;
      }
    // Give target inputs a Boolean guard's other polarity before a Cartesian
    // prefix spends the fixed allowance on unrelated numeric dimensions.
    for (let flag = 0; flag < choices.length; flag++) {
      if (!choices[flag]!.boolean) continue;
      for (let boolean = 1; boolean < choices[flag]!.values.length; boolean++)
        for (let i = 0; i < choices.length; i++) {
          if (i === flag || !choices[i]!.target) continue;
          for (let value = 0; value < choices[i]!.values.length; value++) {
            const indices = [...base];
            indices[flag] = boolean;
            indices[i] = value;
            found = attempt(indices);
            if (found) return found;
          }
        }
    }
    for (let value = 1; value < width; value++) {
      found = attempt(choices.map((c) => value % c.values.length));
      if (found) return found;
    }
    for (let value = 1; value < width; value++)
      for (let i = 0; i < choices.length; i++) {
        if (value >= choices[i]!.values.length) continue;
        const indices = [...base];
        indices[i] = value;
        found = attempt(indices);
        if (found) return found;
      }
    function pairs(
      i: number,
      indices: number[],
    ): ReturnType<typeof confirmed> | null {
      if (attempts >= 64 || remainingSteps <= 0) return null;
      if (i === choices.length) return attempt(indices);
      for (let value = 0; value < choices[i]!.values.length; value++) {
        indices[i] = value;
        const witness = pairs(i + 1, indices);
        if (witness) return witness;
        if (attempts >= 64 || remainingSteps <= 0) break;
      }
      return null;
    }
    return pairs(0, [...base]);
  };
}
