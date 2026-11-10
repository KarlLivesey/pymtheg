import {
  blocks,
  exprChildren,
  expressions,
  nodeKey,
  type Callable,
  type Expr,
  type Stmt,
} from "../language/ast.js";
import { signedIntegerLiteral } from "../shared/integer-literal.js";
import { hash, type Span } from "../shared/identity.js";
import { affine, type Affine } from "./facts.js";
import type { ProjectIR } from "../semantic/core.js";

/** Canonical sampling priorities only; confirmations execute the original typed IR. */
export function witnessInputs(
  ir: ProjectIR,
  owner: Callable,
  call: Span,
  condition: Expr,
  mode: "precondition" | "postcondition",
) {
  type Fact = {
    inputs: Set<string>;
    numbers: Set<bigint>;
    strings: Set<string>;
    keys: Map<string, string>;
    linear: Affine | null;
    atoms?: Fact[];
  };
  const mentioned = new Set<string>(),
    pending: Expr[] = [...owner.meta.requires, ...owner.meta.ensures];
  const statements = [...(owner.body ?? [])];
  while (statements.length) {
    const s = statements.pop()!;
    for (const e of expressions(s)) pending.push(e);
    for (const nested of blocks(s))
      for (const child of nested) statements.push(child);
  }
  while (pending.length) {
    const e = pending.pop()!;
    if (e.kind === "name") mentioned.add(e.name);
    for (const child of exprChildren(e)) pending.push(child);
  }
  const names = owner.params
      .filter((p) => mentioned.has(p.name))
      .map((p) => p.name),
    contexts = new Map(names.map((n) => [n, new Set<string>()]));
  const numbers = new Map(names.map((n) => [n, new Set<bigint>()])),
    strings = new Map(names.map((n) => [n, new Set<string>()]));
  const typeKey = (t: Callable["params"][number]["type"]): string =>
    JSON.stringify([t.name, t.args.map(typeKey)]);
  const types = new Map(owner.params.map((p) => [p.name, typeKey(p.type)]));
  const cache = new WeakMap<Expr, WeakMap<Map<string, Fact>, Fact>>();
  const relations: Affine[] = [];
  const targets = new Set<string>();
  const essential = new Map(names.map((n) => [n, new Set<bigint>()]));
  let visits = 0,
    equationVisits = 0;
  const empty = (): Fact => ({
    inputs: new Set(),
    numbers: new Set(),
    strings: new Set(),
    keys: new Map(names.map((n) => [n, "unknown"])),
    linear: null,
  });
  function fact(e: Expr, env: Map<string, Fact>, depth = 0): Fact {
    if (++visits > 12000 || depth > 32) return empty();
    const cached = cache.get(e)?.get(env);
    if (cached) return cached;
    if (e.kind === "name" && env.has(e.name)) return env.get(e.name)!;
    const children = exprChildren(e).map((c) => fact(c, env, depth + 1));
    if (e.kind === "call") {
      const target = ir.info.get(nodeKey(e.span))?.target,
        decl = target ? ir.symbols.get(target) : undefined;
      if (decl?.kind === "rule" && decl.expr) {
        const args = new Map(
          decl.params.map((p, i) => [p.name, children[i] ?? empty()]),
        );
        return remember(e, env, fact(decl.expr, args, depth + 1));
      }
    }
    if (e.kind === "unary" && e.op === "!")
      return remember(e, env, children[0] ?? empty());
    if (e.kind === "binary" && ["==", "!="].includes(e.op)) {
      if (e.left.kind === "literal" && typeof e.left.value === "boolean")
        return remember(e, env, children[1] ?? empty());
      if (e.right.kind === "literal" && typeof e.right.value === "boolean")
        return remember(e, env, children[0] ?? empty());
    }
    const inputs = new Set(children.flatMap((c) => [...c.inputs])),
      numeric = new Set(children.flatMap((c) => [...c.numbers])),
      texts = new Set(children.flatMap((c) => [...c.strings]));
    const integer = signedIntegerLiteral(e);
    if (integer !== null) numeric.add(integer);
    if (e.kind === "literal" && typeof e.value === "string") texts.add(e.value);
    const linear = affine(e, (node) =>
      node.kind === "name"
        ? (env.get(node.name)?.linear ?? null)
        : node.kind === "call"
          ? (cache.get(node)?.get(env)?.linear ?? null)
          : undefined,
    );
    let difference: Affine | null = null;
    const comparison =
      e.kind === "binary" && ["==", "!=", "<", "<=", ">", ">="].includes(e.op);
    if (comparison && children[0]?.linear && children[1]?.linear) {
      const a = children[0].linear,
        b = children[1].linear,
        terms = new Map(a.terms);
      for (const [n, v] of b.terms) terms.set(n, (terms.get(n) ?? 0n) - v);
      difference = {
        constant: a.constant - b.constant,
        terms: new Map([...terms].filter(([, v]) => v !== 0n)),
      };
      numeric.clear();
      for (const coefficient of difference.terms.values())
        numeric.add(-difference.constant / coefficient);
    }
    const keys = new Map<string, string>();
    for (const name of names) {
      const child = children.map((c) => c.keys.get(name) ?? "unknown");
      let shape: unknown;
      if (difference) {
        let divisor = abs(difference.constant);
        for (const v of difference.terms.values())
          divisor = gcd(divisor, abs(v));
        if (!divisor) divisor = 1n;
        const normalized = (sign: bigint) =>
          JSON.stringify([
            [...difference!.terms]
              .map(([n, v]) => [
                n === name ? "self" : (types.get(n) ?? "local"),
                String((sign * v) / divisor),
              ])
              .sort((a, b) =>
                JSON.stringify(a).localeCompare(JSON.stringify(b)),
              ),
            String((sign * difference!.constant) / divisor),
          ]);
        shape = [
          "comparison",
          ["==", "!="].includes((e as Extract<Expr, { kind: "binary" }>).op)
            ? "equality"
            : "order",
          [normalized(1n), normalized(-1n)].sort()[0],
        ];
      } else if (integer !== null) shape = ["integer", String(integer)];
      else
        switch (e.kind) {
          case "name":
            shape = ["local"];
            break;
          case "literal":
            shape = [
              "literal",
              typeof e.value === "boolean" ? "boolean" : e.value,
            ];
            break;
          case "binary":
            shape = [
              "binary",
              comparison
                ? ["==", "!="].includes(e.op)
                  ? "equality"
                  : "order"
                : e.op,
              comparison ? child.sort() : child,
            ];
            break;
          case "unary":
            shape = ["unary", e.op, child];
            break;
          case "field":
            shape = ["field", e.name, child];
            break;
          case "call":
            shape = ["call", e.args.map((a) => a.mode), child];
            break;
          case "record":
            shape = ["record", e.name, e.fields.map((f) => f.name), child];
            break;
          case "unknown":
            shape = ["unknown"];
            break;
          default:
            shape = [e.kind, child];
        }
      keys.set(name, hash(JSON.stringify(shape)));
    }
    const atoms =
      e.kind === "binary" && ["&&", "||"].includes(e.op)
        ? children.flatMap((c) => c.atoms ?? [c])
        : undefined;
    return remember(e, env, {
      inputs,
      numbers: numeric,
      strings: texts,
      keys,
      linear,
      ...(atoms ? { atoms } : {}),
    });
  }
  function remember(e: Expr, env: Map<string, Fact>, value: Fact) {
    const entries = cache.get(e) ?? new WeakMap<Map<string, Fact>, Fact>();
    entries.set(env, value);
    cache.set(e, entries);
    return value;
  }
  function abs(n: bigint) {
    return n < 0n ? -n : n;
  }
  function gcd(a: bigint, b: bigint): bigint {
    while (b) {
      const r = a % b;
      a = b;
      b = r;
    }
    return a;
  }
  const initial = new Map<string, Fact>();
  for (const p of owner.params)
    initial.set(p.name, {
      inputs: new Set([p.name]),
      numbers: new Set(),
      strings: new Set(),
      linear: { constant: 0n, terms: new Map([[p.name, 1n]]) },
      keys: new Map(
        names.map((n) => [
          n,
          JSON.stringify(n === p.name ? ["self"] : ["input", typeKey(p.type)]),
        ]),
      ),
    });
  function observe(e: Expr, env: Map<string, Fact>, label: string) {
    const f = fact(e, env);
    for (const atom of f.atoms ?? [f])
      for (const name of atom.inputs) {
        contexts.get(name)!.add(JSON.stringify([label, atom.keys.get(name)]));
        for (const n of atom.numbers) numbers.get(name)!.add(n);
        for (const s of atom.strings) strings.get(name)!.add(s);
      }
    // Shared affine semantics supplies exact integer boundary equations; replay
    // alone decides reachability and violations.
    function equations(expr: Expr, scope: Map<string, Fact>, depth = 0) {
      if (depth > 16 || ++equationVisits > 12000) return;
      if (expr.kind === "call") {
        const target = ir.info.get(nodeKey(expr.span))?.target,
          d = target ? ir.symbols.get(target) : undefined;
        if (d?.kind === "rule" && d.expr)
          equations(
            d.expr,
            new Map(
              d.params.map((p, i) => [
                p.name,
                expr.args[i] ? fact(expr.args[i]!.expr, scope) : empty(),
              ]),
            ),
            depth + 1,
          );
      }
      if (
        expr.kind === "binary" &&
        ["==", "!=", "<", "<=", ">", ">="].includes(expr.op)
      ) {
        const a = fact(expr.left, scope).linear,
          b = fact(expr.right, scope).linear;
        if (a && b) {
          const terms = new Map(a.terms);
          for (const [n, v] of b.terms) terms.set(n, (terms.get(n) ?? 0n) - v);
          relations.push({
            constant: a.constant - b.constant,
            terms: new Map([...terms].filter(([, v]) => v !== 0n)),
          });
        }
      }
      for (const child of exprChildren(expr))
        equations(child, scope, depth + 1);
    }
    equations(e, env);
    return f;
  }
  const contract = fact(condition, new Map());
  function target(f: Fact) {
    for (const name of f.inputs) {
      targets.add(name);
      contexts
        .get(name)!
        .add(JSON.stringify(["target-input", f.keys.get(name)]));
      for (const n of contract.numbers) {
        const coefficient = f.linear?.terms.get(name),
          value = coefficient ? (n - f.linear!.constant) / coefficient : n;
        numbers.get(name)!.add(value);
        essential.get(name)!.add(value);
      }
      for (const s of contract.strings) strings.get(name)!.add(s);
    }
  }
  for (const e of owner.meta.requires) observe(e, initial, "predicate");
  for (const e of owner.meta.ensures) observe(e, initial, "result-contract");
  function body(statements: Stmt[], inherited: Map<string, Fact>) {
    const env = new Map(inherited);
    for (const s of statements) {
      if (s.kind === "let") {
        env.set(s.name, fact(s.expr, env));
        continue;
      }
      for (const [index, e] of expressions(s).entries()) {
        const f = observe(
          e,
          env,
          s.kind === "if" || s.kind === "assert"
            ? "predicate"
            : s.kind + ":" + index,
        );
        if (
          mode === "precondition" &&
          s.kind === "invoke" &&
          s.span.file === call.file &&
          s.span.start === call.start &&
          s.span.end === call.end
        )
          target(f);
        if (mode === "postcondition" && s.kind === "return") target(f);
      }
      if (s.kind === "for") {
        const nested = new Map(env);
        nested.delete(s.name);
        body(s.body, nested);
      } else if (s.kind === "match")
        for (const arm of s.arms) {
          const nested = new Map(env);
          if (arm.binding) nested.delete(arm.binding);
          body(arm.body, nested);
        }
      else for (const nested of blocks(s)) body(nested, env);
      if (s.kind === "own") env.delete(s.name);
      if (s.kind === "invoke" && s.binding) env.delete(s.binding);
    }
  }
  body(owner.body ?? [], initial);
  // Canonical integer roots and one-variable inverse candidates are collected
  // after the target's values, so a guard zone != code+5 can try code=7, zone=12.
  for (let pass = 0; pass < 2; pass++) {
    const prior = new Map(
      [...numbers].map(([n, v]) => [
        n,
        [...v].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, 12),
      ]),
    );
    for (const relation of relations)
      for (const [name, coefficient] of relation.terms) {
        const candidates = [-relation.constant];
        for (const [other, factor] of relation.terms)
          if (other !== name)
            for (const n of prior.get(other) ?? [])
              candidates.push(-relation.constant - factor * n);
        const values = numbers.get(name);
        if (!values) continue;
        for (const n of candidates) values.add(n / coefficient);
      }
  }
  const roles = new Map<string, string>();
  for (const [name, uses] of contexts)
    if (uses.size) roles.set(name, JSON.stringify([...uses].sort()));
  const relationKey = (r: Affine) => {
    let divisor = abs(r.constant);
    for (const v of r.terms.values()) divisor = gcd(divisor, abs(v));
    if (!divisor) divisor = 1n;
    return [1n, -1n]
      .map((sign) =>
        JSON.stringify([
          [...r.terms]
            .map(([n, v]) => [roles.get(n) ?? "", String((sign * v) / divisor)])
            .sort(),
          String((sign * r.constant) / divisor),
        ]),
      )
      .sort()[0]!;
  };
  const canonicalRelations = [
    ...new Map(relations.map((r) => [relationKey(r), r])).entries(),
  ]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, r]) => r);
  for (const r of canonicalRelations)
    if (r.terms.size === 1) {
      const [name, k] = [...r.terms][0]!;
      essential.get(name)?.add(-r.constant / k);
    }
  const numericOrder = (a: bigint, b: bigint) =>
    abs(a) === abs(b) ? (a < b ? -1 : a > b ? 1 : 0) : abs(a) < abs(b) ? -1 : 1;
  for (let pass = 0; pass < names.length; pass++)
    for (const r of canonicalRelations)
      for (const [name, k] of r.terms) {
        let sums = [-r.constant];
        for (const [other, factor] of r.terms)
          if (other !== name) {
            const values = [...(essential.get(other) ?? [])]
              .sort(numericOrder)
              .slice(0, 8);
            sums = sums
              .flatMap((s) => values.map((v) => s - factor * v))
              .slice(0, 24);
          }
        const into = essential.get(name);
        if (into) for (const sum of sums) if (into.size < 12) into.add(sum / k);
      }
  return {
    roles,
    targets,
    relations: canonicalRelations,
    numbers: (name: string) =>
      [
        ...[...(essential.get(name) ?? [])].sort(numericOrder),
        ...[...(numbers.get(name) ?? [])].sort(numericOrder),
      ].flatMap((n) => [n, n - 1n, n + 1n, -n]),
    strings: (name: string) => [...(strings.get(name) ?? [])].sort(),
  };
}
