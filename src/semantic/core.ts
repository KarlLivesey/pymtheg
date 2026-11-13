import { evaluateScalar } from "../shared/scalar-expression.js";
import { nearbyName } from "../shared/names.js";
import { effectCovered, outcomeHandled } from "../shared/judgements.js";
import type {
  Decl,
  Callable,
  TypeRef,
  Expr,
  Stmt,
  Arg,
  Resource,
} from "../language/ast.js";
import { nodeKey, exprChildren, blocks } from "../language/ast.js";
import type { Snapshot } from "../language/project.js";
import { finding, type Finding, type Span, json } from "../shared/identity.js";
export type Type =
  | { kind: "primitive"; name: "Int" | "Nat" | "Bool" | "String" | "Unit" }
  | { kind: "nominal"; id: string }
  | { kind: "list"; element: Type }
  | { kind: "result"; ok: Type; error: Type }
  | { kind: "error" };
export const errorType: Type = { kind: "error" };
export const primitive = (
  name: Extract<Type, { kind: "primitive" }>["name"],
): Type => ({ kind: "primitive", name });
export const typeKey = (t: Type): string => {
  switch (t.kind) {
    case "primitive":
      return t.name;
    case "nominal":
      return t.id;
    case "list":
      return `List<${typeKey(t.element)}>`;
    case "result":
      return `Result<${typeKey(t.ok)},${typeKey(t.error)}>`;
    case "error":
      return "?";
  }
};
export const compatible = (actual: Type, expected: Type): boolean =>
  actual.kind === "error" ||
  expected.kind === "error" ||
  typeKey(actual) === typeKey(expected) ||
  (actual.kind === "primitive" &&
    actual.name === "Nat" &&
    expected.kind === "primitive" &&
    expected.name === "Int");
export interface ExprInfo {
  type: Type;
  target: string | null;
  local: string | null;
  suggestions?: string[];
  suggestionsComplete?: boolean;
}
export interface Edge {
  from: string;
  to: string;
  kind: "call" | "type" | "rule" | "import" | "assumption";
}
export interface ProjectIR {
  schemaVersion: "1";
  snapshot: Snapshot;
  declarations: Decl[];
  symbols: Map<string, Decl>;
  visibleSymbols: Map<string, Map<string, string[]>>;
  info: Map<string, ExprInfo>;
  blockResources: Map<
    string,
    { bindings: { name: string; resourceId: string }[]; total: number }
  >;
  types: Map<string, Type>;
  edges: Edge[];
  diagnostics: Finding[];
  holes: Set<string>;
  effects: Map<string, Set<string>>;
  measurements: Record<string, number>;
}
export const callable = (d: Decl): d is Callable =>
  ["rule", "op", "flow"].includes(d.kind);
export function resourceResult(
  ir: ProjectIR,
  t: Type | undefined,
): { resource: Resource; wrapped: boolean } | null {
  if (!t) return null;
  const inner = t.kind === "result" ? t.ok : t;
  if (inner.kind !== "nominal") return null;
  const d = ir.symbols.get(inner.id);
  return d?.kind === "resource"
    ? { resource: d, wrapped: t.kind === "result" }
    : null;
}
export function variants(ir: ProjectIR, t: Type): Map<string, Type | null> {
  if (t.kind === "result") {
    const v = variants(ir, t.error);
    return new Map([["Ok", t.ok], ...v]);
  }
  if (t.kind === "nominal") {
    const d = ir.symbols.get(t.id);
    if (d?.kind === "type" && d.fields === null)
      return new Map(
        d.variants.map((v) => [
          v.name,
          v.payload
            ? (ir.types.get(nodeKey(v.payload.span)) ?? errorType)
            : null,
        ]),
      );
  }
  return new Map();
}
export function typecheck(snapshot: Snapshot): ProjectIR {
  const ir: ProjectIR = {
    schemaVersion: "1",
    snapshot,
    declarations: snapshot.sources.flatMap((s) => s.parsed.declarations),
    symbols: new Map(),
    visibleSymbols: new Map(),
    info: new Map(),
    blockResources: new Map(),
    types: new Map(),
    edges: [],
    diagnostics: [...snapshot.diagnostics],
    holes: new Set(),
    effects: new Map(),
    measurements: {},
  };
  const byFile = new Map<string, Map<string, Decl>>(),
    visible = new Map<string, Map<string, Decl[]>>();
  const sourcesByFile = new Map(snapshot.sources.map((s) => [s.file, s]));
  const syntaxByFile = new Map<string, Span[]>();
  const visibleSyntax = new Map<string, Span[]>();
  for (const diagnostic of snapshot.diagnostics)
    if (diagnostic.code === "P001" || diagnostic.code === "P002") {
      const spans = syntaxByFile.get(diagnostic.span.file) ?? [];
      spans.push(diagnostic.span);
      syntaxByFile.set(diagnostic.span.file, spans);
    }
  const add = (
    code: string,
    msg: string,
    span: Span,
    related: Span[] = [],
    severity: Finding["severity"] = "error",
  ): void => {
    ir.diagnostics.push(finding(code, msg, span, severity, related));
  };
  for (const d of ir.declarations) {
    const m = byFile.get(d.span.file) ?? new Map<string, Decl>();
    const old = m.get(d.name);
    if (old) add("N001", `Duplicate declaration ${d.name}`, d.span, [old.span]);
    else {
      m.set(d.name, d);
      ir.symbols.set(d.id, d);
    }
    byFile.set(d.span.file, m);
  }
  for (const source of snapshot.sources) {
    const seen = new Set<string>(),
      v = new Map<string, Decl[]>();
    function collect(f: string): void {
      if (seen.has(f)) return;
      seen.add(f);
      for (const d of byFile.get(f)?.values() ?? []) {
        const a = v.get(d.name) ?? [];
        a.push(d);
        v.set(d.name, a);
      }
      for (const i of sourcesByFile.get(f)?.imports ?? []) collect(i);
    }
    collect(source.file);
    visibleSyntax.set(
      source.file,
      [...seen].flatMap((file) => syntaxByFile.get(file) ?? []),
    );
    visible.set(source.file, v);
    ir.visibleSymbols.set(
      source.file,
      new Map([...v].map(([name, ds]) => [name, ds.map((d) => d.id)])),
    );
  }
  let nameHintBudget = 2048;
  function hint(name: string, candidates: Iterable<string>) {
    if (nameHintBudget <= 0) return "";
    const limit = Math.min(128, nameHintBudget);
    nameHintBudget -= limit;
    const match = nearbyName(name, candidates, limit);
    return match ? `; did you mean ${match}?` : "";
  }
  function lookup(
    name: string,
    span: Span,
    owner: Decl,
    kind: Edge["kind"] = "type",
    quiet = false,
  ): Decl | undefined {
    function* candidates() {
      if (kind === "type")
        yield* ["Int", "Nat", "Bool", "String", "Unit", "List", "Result"];
      yield* visible.get(span.file)?.keys() ?? [];
    }
    const ds = visible.get(span.file)?.get(name) ?? [];
    if (ds.length !== 1) {
      if (!quiet)
        add(
          "N002",
          ds.length
            ? `Ambiguous name ${name}`
            : visibleSyntax.get(span.file)?.length
              ? `Cannot resolve ${name} while visible source has syntax errors. Fix the related syntax error first, then check this name again.`
              : `Unknown name ${name}${hint(name, candidates())}`,
          span,
          ds.length
            ? ds.map((d) => d.span)
            : (visibleSyntax.get(span.file) ?? []),
        );
      return undefined;
    }
    const d = ds[0]!;
    ir.edges.push({ from: owner.id, to: d.id, kind });
    return d;
  }
  function resolve(t: TypeRef, owner: Decl): Type {
    const old = ir.types.get(nodeKey(t.span));
    if (old) return old;
    let r: Type = errorType;
    if (["Int", "Nat", "Bool", "String", "Unit"].includes(t.name)) {
      r = primitive(t.name as Extract<Type, { kind: "primitive" }>["name"]);
      if (t.args.length)
        add("T001", `${t.name} takes no type arguments`, t.span);
    } else if (t.name === "List" && t.args.length === 1)
      r = { kind: "list", element: resolve(t.args[0]!, owner) };
    else if (t.name === "Result" && t.args.length === 2) {
      const error = resolve(t.args[1]!, owner);
      const domain =
        error.kind === "nominal" ? ir.symbols.get(error.id) : undefined;
      if (
        error.kind !== "error" &&
        (domain?.kind !== "type" || domain.fields !== null)
      )
        add(
          "T001",
          "Result error argument must be a named closed union",
          t.args[1]!.span,
        );
      if (
        domain?.kind === "type" &&
        domain.variants.some((v) => v.name === "Ok")
      )
        add(
          "T001",
          "Result error variants cannot redefine its Ok success tag",
          t.args[1]!.span,
          [domain.span],
        );
      r = { kind: "result", ok: resolve(t.args[0]!, owner), error };
    } else if (["List", "Result"].includes(t.name))
      add("T001", `Invalid type argument count for ${t.name}`, t.span);
    else {
      if (
        !visible.get(t.span.file)?.has(t.name) &&
        (t.name === "Option" || t.name === "Map")
      ) {
        add(
          "T001",
          t.name === "Option"
            ? "Option is not built in. Declare a closed union, for example type MaybeText = Some(String) | None; then use MaybeText"
            : "Map is not built in. For bounded key/value data, declare an entry record and use List<Entry>; dictionary operations need explicit contracts",
          t.span,
        );
        ir.types.set(nodeKey(t.span), r);
        return r;
      }
      const d = lookup(t.name, t.span, owner);
      if (d && (d.kind === "type" || d.kind === "resource")) {
        r = { kind: "nominal", id: d.id };
        if (t.args.length) add("T001", "User types are not generic", t.span);
      } else if (d) add("T001", `${t.name} is not a type`, t.span, [d.span]);
    }
    ir.types.set(nodeKey(t.span), r);
    return r;
  }
  for (const d of ir.declarations) {
    if (callable(d)) {
      for (const p of d.params) resolve(p.type, d);
      resolve(d.result, d);
    } else if (d.kind === "type") {
      for (const f of d.fields ?? []) resolve(f.type, d);
      for (const v of d.variants) if (v.payload) resolve(v.payload, d);
    } else if (d.kind === "machine")
      for (const s of d.states) resolve(s.type, d);
  }
  for (const d of ir.declarations) {
    if (d.kind === "type") {
      const seen = new Set<string>();
      for (const f of d.fields ?? d.variants) {
        if (seen.has(f.name)) add("N001", `Duplicate member ${f.name}`, f.span);
        seen.add(f.name);
      }
    }
    if (d.kind === "resource") {
      if (new Set(d.states).size !== d.states.length)
        add("R001", "Duplicate resource state", d.span);
      for (const s of [
        d.initial,
        ...d.terminal,
        ...d.transitions.flatMap((t) => [t.from, t.to]),
      ])
        if (!d.states.includes(s))
          add("R001", `Unknown resource state ${s}`, d.span);
    }
  }
  // Container ownership is deliberately excluded, rather than losing obligations.
  const resourceTypes = new Set(
    ir.declarations.filter((d) => d.kind === "resource").map((d) => d.id),
  );
  const reverseTypes = new Map<string, Set<string>>();
  for (const edge of ir.edges)
    if (edge.kind === "type" && ir.symbols.get(edge.from)?.kind === "type") {
      const users = reverseTypes.get(edge.to) ?? new Set<string>();
      users.add(edge.from);
      reverseTypes.set(edge.to, users);
    }
  const queue = [...resourceTypes];
  for (let i = 0; i < queue.length; i++)
    for (const user of reverseTypes.get(queue[i]!) ?? [])
      if (!resourceTypes.has(user)) {
        resourceTypes.add(user);
        queue.push(user);
      }
  const containsResource = (t: Type): boolean =>
    t.kind === "nominal"
      ? resourceTypes.has(t.id)
      : t.kind === "list"
        ? containsResource(t.element)
        : t.kind === "result"
          ? containsResource(t.ok) || containsResource(t.error)
          : false;
  for (const d of ir.declarations) {
    if (
      ["Int", "Nat", "Bool", "String", "Unit", "List", "Result"].includes(
        d.name,
      )
    )
      add("N001", "Declaration shadows a built-in type", d.span);
    if (d.kind === "type" && resourceTypes.has(d.id))
      add(
        "O007",
        "Resources inside records/unions are unsupported until owned-container semantics exist",
        d.span,
      );
    if (callable(d)) {
      for (const p of d.params) {
        const t = ir.types.get(nodeKey(p.type.span))!;
        const direct =
          t.kind === "nominal" && ir.symbols.get(t.id)?.kind === "resource";
        if (direct && p.mode === "value")
          add("O001", "Resource parameters require take or borrow", p.span);
        if (!direct && p.mode !== "value")
          add(
            "O007",
            "Take/borrow modes currently require a resource type",
            p.span,
          );
        if (!direct && containsResource(t))
          add(
            "O007",
            "Owned collections or nested resources are unsupported",
            p.span,
          );
        if (d.kind === "rule" && direct)
          add(
            "O007",
            "Resource parameters in pure rules are unsupported",
            p.span,
          );
      }
      const t = ir.types.get(nodeKey(d.result.span))!;
      if (containsResource(t) && !resourceResult(ir, t))
        add(
          "O007",
          "Owned resources inside operation result containers are unsupported",
          d.result.span,
        );
    }
  }
  type Env = Map<string, { type: Type; span: Span }>;
  // Arithmetic expressions whose Int type comes from a subtraction, so a Nat
  // mismatch can say why and suggest a bounded Int (S21). "nat" means the
  // subtraction started from a Nat; "int" means its left side was already Int.
  const subtractions = new WeakMap<Span, "nat" | "int">();
  function expect(
    a: Type,
    b: Type,
    span: Span,
    related: Span[] = [],
    natHint = "If the value can go below zero, change Nat to Int in its declaration. For machine state, keep a finite range, for example `state count: Int in 0..3 = 0;`.",
  ): void {
    if (!compatible(a, b)) {
      const subtraction =
        typeKey(a) === "Int" && typeKey(b) === "Nat"
          ? subtractions.get(span)
          : undefined;
      add(
        "T002",
        `Expected ${typeKey(b)}, got ${typeKey(a)}` +
          (subtraction === "nat"
            ? `. Subtracting from a Nat gives an Int, because the result may be below zero. ${natHint}`
            : subtraction === "int"
              ? `. The result of this subtraction is Int, and the target is Nat. ${natHint}`
              : ""),
        span,
        related,
      );
    }
  }
  function bind(env: Env, name: string, type: Type, span: Span): void {
    if (env.has(name))
      add("N001", `Duplicate local ${name}`, span, [env.get(name)!.span]);
    env.set(name, { type, span });
  }
  function invocation(
    name: string,
    args: Arg[],
    span: Span,
    env: Env,
    owner: Decl,
    pure: boolean,
  ): Type {
    const d = lookup(name, span, owner, pure ? "rule" : "call");
    if (!d || !callable(d)) {
      if (d) add("T003", `${name} is not callable`, span, [d.span]);
      for (const a of args) expression(a.expr, env, owner);
      return errorType;
    }
    ir.info.set(nodeKey(span), {
      type: resolve(d.result, d),
      target: d.id,
      local: null,
    });
    if (args.length !== d.params.length)
      add(
        "T004",
        `${name} expects ${d.params.length} arguments, got ${args.length}`,
        span,
        [d.span],
      );
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!,
        p = d.params[i];
      const actual = expression(
        a.expr,
        env,
        owner,
        p ? resolve(p.type, d) : undefined,
      );
      if (p) {
        expect(actual, resolve(p.type, d), a.expr.span, [p.span]);
        if (a.mode === "borrow" && actual.kind === "nominal") {
          const resource = ir.symbols.get(actual.id);
          if (
            resource?.kind === "resource" &&
            [...(ir.effects.get(d.id) ?? new Set(d.meta.effects))].some(
              (effect) =>
                effect === "state." + resource.name ||
                effect === "write." + resource.name,
            )
          )
            add(
              "O005",
              "Borrowed resource passed to a mutating operation",
              a.expr.span,
              [p.span],
            );
        }
        if (a.mode !== p.mode)
          add(
            "O001",
            `${name}.${p.name} requires ${p.mode} passing, got ${a.mode}`,
            a.expr.span,
            [p.span],
          );
      }
    }
    if (pure && d.kind !== "rule")
      add(
        "E001",
        `Pure expression calls effectful operation ${name}. In a flow, use call ${sourcesByFile.get(span.file)?.text.slice(span.start, span.end).slice(0, 160) || name + "(input)"} as result; then use result in the expression.`,
        span,
        [d.span],
      );
    return resolve(d.result, d);
  }
  function variantOrigins(t: Type | undefined): Span[] {
    if (!t) return [];
    if (t.kind === "result") return variantOrigins(t.error);
    if (t.kind === "nominal") {
      const d = ir.symbols.get(t.id);
      return d ? [d.span] : [];
    }
    return [];
  }
  function expression(e: Expr, env: Env, owner: Decl, expected?: Type): Type {
    let t: Type = errorType,
      target: string | null = null,
      local: string | null = null;
    switch (e.kind) {
      case "literal":
        t =
          e.value === null
            ? primitive("Unit")
            : primitive(
                typeof e.value === "boolean"
                  ? "Bool"
                  : typeof e.value === "string"
                    ? "String"
                    : e.value >= 0n
                      ? "Nat"
                      : "Int",
              );
        break;
      case "unknown":
        ir.holes.add(owner.id);
        add("U001", `Unknown decision: ${e.reason}`, e.span, [], "warning");
        break;
      case "name": {
        const v = env.get(e.name);
        if (v) {
          t = v.type;
          local = e.name;
        } else {
          const vs = expected
            ? variants(ir, expected)
            : new Map<string, Type | null>();
          if (vs.has(e.name) && vs.get(e.name) === null) t = expected!;
          else
            add(
              "N002",
              `Unknown value or variant ${e.name}${hint(e.name, [...env.keys(), ...vs.keys()])}`,
              e.span,
              variantOrigins(expected),
            );
        }
        break;
      }
      case "field": {
        const b = expression(e.base, env, owner);
        if (b.kind === "list" && e.name === "count") t = primitive("Nat");
        else if (b.kind === "nominal") {
          const d = ir.symbols.get(b.id);
          const f =
            d?.kind === "type"
              ? d.fields?.find((f) => f.name === e.name)
              : undefined;
          if (f) t = resolve(f.type, d!);
          else
            add(
              "T005",
              `Unknown field ${e.name} on ${typeKey(b)}`,
              e.span,
              d ? [d.span] : [],
            );
        } else if (b.kind !== "error")
          add("T005", `Field ${e.name} on non-record ${typeKey(b)}`, e.span);
        break;
      }
      case "call": {
        const vs = expected
          ? variants(ir, expected)
          : new Map<string, Type | null>();
        if (vs.has(e.name)) {
          const payload = vs.get(e.name);
          if (e.args.length !== (payload ? 1 : 0))
            add(
              "T004",
              `Variant ${e.name} expects ${payload ? 1 : 0} payloads`,
              e.span,
            );
          for (const a of e.args) {
            const at = expression(a.expr, env, owner, payload ?? undefined);
            if (payload) expect(at, payload, a.expr.span);
          }
          t = expected!;
        } else {
          t = invocation(e.name, e.args, e.span, env, owner, true);
          target = ir.info.get(nodeKey(e.span))?.target ?? null;
        }
        break;
      }
      case "record": {
        const d = lookup(e.name, e.span, owner);
        if (d?.kind !== "type" || d.fields === null) {
          if (d)
            add("T005", `${e.name} is not a record type`, e.span, [d.span]);
          break;
        }
        t = { kind: "nominal", id: d.id };
        const seen = new Set<string>();
        for (const f of e.fields) {
          if (seen.has(f.name))
            add("N001", `Duplicate field ${f.name}`, f.value.span);
          seen.add(f.name);
          const declared = d.fields.find((x) => x.name === f.name);
          if (!declared)
            add("T005", `Unknown field ${f.name}`, f.value.span, [d.span]);
          const a = expression(
            f.value,
            env,
            owner,
            declared ? resolve(declared.type, d) : undefined,
          );
          if (declared)
            expect(a, resolve(declared.type, d), f.value.span, [declared.span]);
        }
        for (const f of d.fields)
          if (!seen.has(f.name))
            add("T005", `Missing field ${f.name}`, e.span, [f.span]);
        break;
      }
      case "list": {
        const wanted = expected?.kind === "list" ? expected.element : undefined;
        let element = wanted ?? errorType;
        for (const item of e.items) {
          const it = expression(item, env, owner, wanted);
          if (element.kind === "error") element = it;
          else expect(it, element, item.span);
        }
        t = { kind: "list", element };
        break;
      }
      case "unary": {
        const a = expression(e.expr, env, owner);
        expect(a, primitive(e.op === "!" ? "Bool" : "Int"), e.expr.span);
        t = primitive(e.op === "!" ? "Bool" : "Int");
        break;
      }
      case "binary": {
        const bool = ["&&", "||"].includes(e.op),
          cmp = ["==", "!=", "<", "<=", ">", ">="].includes(e.op);
        const a = expression(e.left, env, owner),
          b = expression(e.right, env, owner);
        if (bool) {
          expect(a, primitive("Bool"), e.left.span);
          expect(b, primitive("Bool"), e.right.span);
        } else if (["==", "!="].includes(e.op)) {
          if (!compatible(a, b) && !compatible(b, a))
            add("T002", "Incompatible equality operands", e.span);
        } else {
          expect(a, primitive("Int"), e.left.span);
          expect(b, primitive("Int"), e.right.span);
        }
        t =
          bool || cmp
            ? primitive("Bool")
            : primitive(
                e.op === "-"
                  ? "Int"
                  : a.kind === "primitive" &&
                      a.name === "Nat" &&
                      b.kind === "primitive" &&
                      b.name === "Nat"
                    ? "Nat"
                    : "Int",
              );
        if (!bool && !cmp) {
          const origin =
            e.op === "-"
              ? typeKey(a) === "Nat"
                ? "nat"
                : "int"
              : (subtractions.get(e.left.span) ??
                subtractions.get(e.right.span));
          if (origin) subtractions.set(e.span, origin);
        }
        break;
      }
    }
    if (containsResource(t) && !resourceResult(ir, t))
      add(
        "O007",
        "Resource-containing values require unsupported owned-container semantics",
        e.span,
      );
    let suggestions: string[] | undefined,
      suggestionsComplete: boolean | undefined;
    if (e.kind === "unknown" && expected && expected.kind !== "error") {
      suggestions = [];
      let scanned = 0;
      for (const [name, candidate] of env) {
        scanned++;
        if (
          candidate.type.kind !== "error" &&
          compatible(candidate.type, expected)
        )
          suggestions.push(name);
        if (scanned >= 256 || suggestions.length >= 20) break;
      }
      suggestionsComplete = scanned === env.size;
      ir.measurements.inputSuggestionVisits =
        (ir.measurements.inputSuggestionVisits ?? 0) + scanned;
    }
    ir.info.set(nodeKey(e.span), {
      type: t,
      target,
      local,
      ...(suggestions
        ? { suggestions, suggestionsComplete: suggestionsComplete! }
        : {}),
    });
    return t;
  }
  function consumes(name: string, body: Stmt[]): boolean {
    for (const s of body) {
      if (
        (s.kind === "match" || s.kind === "return" || s.kind === "propagate") &&
        s.expr.kind === "name" &&
        s.expr.name === name
      )
        return true;
      if (s.kind === "if" && consumes(name, s.yes) && consumes(name, s.no))
        return true;
      if (s.kind === "return" || s.kind === "propagate") return false;
    }
    return false;
  }
  function statements(
    body: Stmt[],
    env: Env,
    owner: Callable,
    bodySpan?: Span,
  ): boolean {
    let terminated = false;
    const pending = new Map<string, { type: Type; span: Span }>();
    for (const s of body) {
      if (terminated) {
        add(
          "C001",
          "Unreachable statement after return",
          s.span,
          [],
          "warning",
        );
        break;
      }
      switch (s.kind) {
        case "let": {
          const t = expression(s.expr, env, owner);
          bind(env, s.name, t, s.span);
          break;
        }
        case "invoke": {
          const t = invocation(s.name, s.args, s.span, env, owner, false);
          if (s.binding) {
            bind(env, s.binding, t, s.span);
            if (variants(ir, t).size)
              pending.set(s.binding, { type: t, span: s.span });
          } else if (variants(ir, t).size)
            add(
              "C002",
              `Unhandled declared outcomes: ${[...variants(ir, t).keys()].join(", ")}`,
              s.span,
            );
          break;
        }
        case "if": {
          expect(
            expression(s.test, env, owner),
            primitive("Bool"),
            s.test.span,
          );
          const a = statements(s.yes, new Map(env), owner, s.yesSpan),
            b = statements(s.no, new Map(env), owner, s.noSpan);
          terminated = a && b;
          break;
        }
        case "match": {
          const t = expression(s.expr, env, owner),
            vs = variants(ir, t),
            seen = new Set<string>();
          if (!vs.size && t.kind !== "error")
            add("C002", "Match requires a tagged outcome", s.expr.span);
          let all = s.arms.length > 0;
          for (const arm of s.arms) {
            if (seen.has(arm.tag))
              add("C002", `Duplicate handler ${arm.tag}`, arm.span);
            seen.add(arm.tag);
            if (t.kind !== "error" && !vs.has(arm.tag))
              add(
                "T006",
                `Unknown variant ${arm.tag}`,
                arm.span,
                variantOrigins(t),
              );
            const local = new Map(env),
              payload = vs.get(arm.tag);
            if (arm.binding) {
              if (t.kind !== "error" && !payload)
                add("T006", `Variant ${arm.tag} has no payload`, arm.span);
              bind(local, arm.binding, payload ?? errorType, arm.span);
            } else if (payload)
              add(
                "T006",
                `Variant ${arm.tag} requires a payload binding`,
                arm.span,
              );
            all = statements(arm.body, local, owner, arm.bodySpan) && all;
          }
          for (const v of vs.keys())
            if (!seen.has(v))
              add("C002", `Unhandled declared outcome ${v}`, s.span);
          if (s.expr.kind === "name") pending.delete(s.expr.name);
          terminated = all && outcomeHandled(vs.keys(), seen);
          break;
        }
        case "for":
        case "retry": {
          const t = expression(s.count, env, owner);
          if (t.kind !== "list") expect(t, primitive("Nat"), s.count.span);
          const local = new Map(env);
          if (s.kind === "for")
            bind(
              local,
              s.name,
              t.kind === "list" ? t.element : primitive("Nat"),
              s.span,
            );
          if (s.kind === "retry") {
            const tags = new Set(
              ir.declarations
                .filter(callable)
                .flatMap((d) => [...variants(ir, resolve(d.result, d)).keys()]),
            );
            if (!tags.has(s.outcome))
              add("C002", `Unknown retry outcome ${s.outcome}`, s.span);
          }
          statements(s.body, local, owner, s.bodySpan);
          break;
        }
        case "assert": {
          expect(
            expression(s.expr, env, owner),
            primitive("Bool"),
            s.expr.span,
          );
          break;
        }
        case "return": {
          const expected = resolve(owner.result, owner),
            t = expression(s.expr, env, owner, expected);
          expect(t, expected, s.expr.span, [owner.result.span]);
          if (s.expr.kind === "name") pending.delete(s.expr.name);
          terminated = true;
          break;
        }
        case "propagate": {
          const actual = expression(s.expr, env, owner),
            expected = resolve(owner.result, owner);
          expect(actual, expected, s.expr.span, [owner.result.span]);
          if (s.expr.kind === "name") pending.delete(s.expr.name);
          terminated = true;
          break;
        }
        case "own": {
          const d = lookup(s.resource, s.span, owner);
          if (d?.kind === "resource") {
            bind(env, s.name, { kind: "nominal", id: d.id }, s.span);
            ir.info.set(nodeKey(s.span), {
              type: { kind: "nominal", id: d.id },
              target: d.id,
              local: s.name,
            });
          } else if (d)
            add("T001", `${s.resource} is not a resource`, s.span, [d.span]);
          break;
        }
        case "move":
        case "transition":
          if (!env.has(s.name))
            add("N002", `Unknown resource ${s.name}`, s.span);
          else {
            const type = env.get(s.name)!.type;
            ir.info.set(nodeKey(s.span), {
              type,
              target: type.kind === "nominal" ? type.id : null,
              local: s.name,
            });
          }
          break;
        case "unknown":
          ir.holes.add(owner.id);
          add("U001", `Unknown decision: ${s.reason}`, s.span, [], "warning");
          break;
      }
    }
    for (const [name, v] of pending)
      if (!consumes(name, body))
        add(
          "C002",
          `Result ${name} has unhandled declared outcomes: ${[...variants(ir, v.type).keys()].join(", ")}`,
          v.span,
        );
    if (bodySpan) {
      const bindings: { name: string; resourceId: string }[] = [];
      let total = 0;
      for (const [name, { type }] of env) {
        if (
          type.kind === "nominal" &&
          ir.symbols.get(type.id)?.kind === "resource"
        ) {
          total++;
          if (bindings.length < 100)
            bindings.push({ name, resourceId: type.id });
        }
      }
      ir.blockResources.set(nodeKey(bodySpan), { bindings, total });
    }
    return terminated;
  }
  for (const d of ir.declarations) {
    if (callable(d)) {
      if (
        d.meta.creates &&
        (d.kind !== "op" ||
          !resourceResult(ir, ir.types.get(nodeKey(d.result.span))))
      )
        add(
          "O009",
          "creates result requires an abstract resource-valued operation",
          d.span,
        );
      if (d.meta.atomic && (d.kind !== "op" || d.meta.protocol))
        add(
          "B010",
          "atomic is an abstract operation assumption and cannot be combined with a protocol",
          d.span,
        );
      const env: Env = new Map();
      for (const p of d.params) bind(env, p.name, resolve(p.type, d), p.span);
      if (d.meta.protocol) {
        const p = d.meta.protocol,
          machine = lookup(p.machine, p.span, d, "assumption");
        if (d.kind !== "op")
          add("B010", "Only abstract operations can link a protocol", p.span);
        if (!machine || machine.kind !== "machine")
          add("B010", "Protocol must name a finite machine", p.span);
        else {
          ir.edges.push({ from: d.id, to: machine.id, kind: "assumption" });
          if (!machine.events.some((e) => e.name === p.submit))
            add("B010", `Unknown submit event ${p.submit}`, p.span, [
              machine.span,
            ]);
          const protocolEnv: Env = new Map();
          for (const state of machine.states)
            bind(
              protocolEnv,
              state.name,
              resolve(state.type, machine),
              state.span,
            );
          const seen = new Set<string>();
          for (const outcome of p.outcomes) {
            expect(
              expression(outcome.guard, protocolEnv, d),
              primitive("Bool"),
              outcome.guard.span,
            );
            expect(
              expression(outcome.value, protocolEnv, d, resolve(d.result, d)),
              resolve(d.result, d),
              outcome.value.span,
            );
            const tag =
              outcome.value.kind === "call" || outcome.value.kind === "name"
                ? outcome.value.name
                : null;
            if (tag) seen.add(tag);
          }
          for (const tag of variants(ir, resolve(d.result, d)).keys())
            if (!seen.has(tag))
              add("B010", `Protocol is missing outcome ${tag}`, p.span);
          if (!p.outcomes.length)
            add("B010", "Protocol needs observable outcomes", p.span);
        }
      }
      const costEnv = new Map(env);
      Object.keys(d.meta.bounds).forEach((n, i) => {
        if (!env.has(n))
          add(
            "N002",
            `Bound ${n} names no parameter of ${d.name}. ${d.params.length ? "Choose one of: " + d.params.map((p) => p.name).join(", ") + "." : "This component has no parameters; remove the bound."}`,
            d.meta.clauses?.filter((c) => c.kind === "bound")[i]?.span ??
              d.span,
          );
      });
      for (const c of d.meta.costs) {
        if (["latency", "peak_memory", "peak_live_bytes"].includes(c.metric))
          add(
            "K005",
            "Latency/peak memory require different algebras and are unsupported",
            c.span,
          );
        expect(expression(c.expr, costEnv, d), primitive("Nat"), c.expr.span);
        if (d.kind !== "op" && c.kind === "cost")
          add(
            "K001",
            "Concrete callables use overhead or budget; total cost belongs to abstract operations",
            c.span,
          );
        if (d.kind === "op" && c.kind === "overhead")
          add("K001", "Abstract operations use cost summaries", c.span);
      }
      for (const e of d.meta.requires)
        expect(expression(e, env, d), primitive("Bool"), e.span);
      const postEnv = new Map(env);
      postEnv.set("result", {
        type: resolve(d.result, d),
        span: d.result.span,
      });
      for (const e of d.meta.ensures)
        expect(expression(e, postEnv, d), primitive("Bool"), e.span);
      if (d.expr) {
        const expected = resolve(d.result, d);
        expect(expression(d.expr, env, d, expected), expected, d.expr.span, [
          d.result.span,
        ]);
      }
      if (d.body) {
        const returns = statements(d.body, new Map(env), d, d.bodySpan);
        if (!returns && typeKey(resolve(d.result, d)) !== "Unit")
          add(
            "C003",
            "Flow can finish without returning its declared result",
            d.span,
          );
      }
      if (d.cancel) {
        const cancelEnv = new Map(env);
        const ownLocals = (body: Stmt[]): void => {
          for (const s of body) {
            if (s.kind === "own") {
              const r = lookup(s.resource, s.span, d);
              if (r?.kind === "resource" && !cancelEnv.has(s.name))
                bind(cancelEnv, s.name, { kind: "nominal", id: r.id }, s.span);
            }
            if (s.kind === "invoke" && s.binding) {
              const rr = resourceResult(ir, ir.info.get(nodeKey(s.span))?.type);
              if (rr && !rr.wrapped && !cancelEnv.has(s.binding))
                bind(
                  cancelEnv,
                  s.binding,
                  { kind: "nominal", id: rr.resource.id },
                  s.span,
                );
            }
            if (s.kind === "match") {
              const t = ir.info.get(nodeKey(s.expr.span))?.type;
              if (t) {
                const vs = variants(ir, t);
                for (const arm of s.arms) {
                  const payload = vs.get(arm.tag),
                    rr = resourceResult(ir, payload ?? undefined);
                  if (arm.binding && rr && !cancelEnv.has(arm.binding))
                    bind(
                      cancelEnv,
                      arm.binding,
                      { kind: "nominal", id: rr.resource.id },
                      arm.span,
                    );
                }
              }
            }
            for (const b of blocks(s)) ownLocals(b);
          }
        };
        if (d.body) ownLocals(d.body);
        statements(d.cancel, cancelEnv, d, d.cancelSpan);
      }
      for (const summary of d.meta.settles) {
        const param = d.params.find((p) => p.name === summary.param);
        if (!param || param.mode !== "take")
          add(
            "O002",
            `Settlement requires a take parameter: ${summary.param}`,
            d.span,
          );
        const allowed = new Set([
          ...variants(ir, resolve(d.result, d)).keys(),
          "Cancelled",
          ...(typeKey(resolve(d.result, d)) === "Unit" ? ["Unit"] : []),
        ]);
        for (const v of summary.outcomes)
          if (!allowed.has(v))
            add("O002", `Unknown settlement outcome ${v}`, d.span);
      }
    } else if (d.kind === "machine") {
      const env: Env = new Map();
      for (const s of d.states) bind(env, s.name, resolve(s.type, d), s.span);
      for (const s of d.states) {
        expect(
          expression(s.init, new Map(), d),
          resolve(s.type, d),
          s.init.span,
          [s.span],
        );
        if (!["Int", "Nat", "Bool"].includes(typeKey(resolve(s.type, d))))
          add("B001", "Machine state must be Bool/Int/Nat", s.span);
        if (
          typeKey(resolve(s.type, d)) !== "Bool" &&
          (s.min === null || s.max === null)
        )
          add(
            "B001",
            "Integer machine state requires an explicit finite domain",
            s.span,
          );
        if (
          s.min !== null &&
          s.max !== null &&
          (s.min > s.max ||
            (typeKey(resolve(s.type, d)) === "Nat" && s.min < 0n))
        )
          add("B001", "Invalid state domain", s.span);
        if (s.min !== null && s.max !== null && s.min <= s.max) {
          try {
            const value = evaluateScalar(s.init, {});
            if (typeof value === "bigint" && (value < s.min || value > s.max))
              add(
                "B012",
                `Starting value ${value} for ${s.name} is outside its declared range ${s.min}..${s.max}`,
                s.init.span,
                [s.span],
              );
          } catch {
            // Unknown or unsupported initial expressions retain their existing
            // diagnostics; do not invent a constant or a successful evaluation.
          }
        }
      }
      const seen = new Set<string>();
      for (const e of d.events) {
        if (seen.has(e.name)) add("N001", `Duplicate event ${e.name}`, e.span);
        seen.add(e.name);
        expect(expression(e.guard, env, d), primitive("Bool"), e.guard.span);
        const assigned = new Set<string>();
        for (const u of e.updates) {
          if (assigned.has(u.name))
            add("N001", `Duplicate assignment ${u.name}`, u.span);
          assigned.add(u.name);
          const target = env.get(u.name);
          if (!target) add("N002", `Unknown state ${u.name}`, u.span);
          const t = expression(u.expr, env, d, target?.type);
          const state = d.states.find((s) => s.name === u.name);
          if (target)
            expect(
              t,
              target.type,
              u.expr.span,
              [target.span],
              state && state.min !== null && state.max !== null
                ? `Change Nat to Int in the declaration of ${state.name}, keeping its range: \`state ${state.name}: Int in ${state.min}..${state.max} = ${sourcesByFile.get(state.init.span.file)?.text.slice(state.init.span.start, state.init.span.end) ?? "0"};\``
                : undefined,
            );
        }
      }
      for (const i of d.invariants) {
        if (seen.has(i.name))
          add("N001", `Duplicate machine member ${i.name}`, i.span);
        seen.add(i.name);
        expect(expression(i.expr, env, d), primitive("Bool"), i.span);
      }
      if (!d.states.length || !d.invariants.length)
        add("B001", "Machine needs states and at least one invariant", d.span);
    }
  }
  // Fixed point effects with explicit target identities, and path reconstruction.
  const outgoing = new Map<string, Edge[]>();
  for (const e of ir.edges)
    if (["call", "rule"].includes(e.kind)) {
      const a = outgoing.get(e.from) ?? [];
      a.push(e);
      outgoing.set(e.from, a);
    }
  for (const d of ir.declarations)
    if (callable(d)) {
      const direct = new Set(d.kind === "op" ? d.meta.effects : []);
      const states = new Map(d.params.map((p) => [p.name, p.type.name]));
      const localEffects = (body: Stmt[]): void => {
        for (const s of body) {
          if (s.kind === "own") {
            states.set(s.name, s.resource);
            direct.add("state." + s.resource);
          }
          if (s.kind === "transition" && states.has(s.name))
            direct.add("state." + states.get(s.name));
          for (const b of blocks(s)) localEffects(b);
        }
      };
      if (d.body) localEffects(d.body);
      if (d.cancel) localEffects(d.cancel);
      for (const summary of d.meta.settles) {
        const p = d.params.find((p) => p.name === summary.param);
        if (p) direct.add("state." + p.type.name);
      }
      if (d.kind === "op") {
        const returned = resourceResult(
          ir,
          ir.types.get(nodeKey(d.result.span)),
        );
        if (returned) direct.add("state." + returned.resource.name);
      }
      ir.effects.set(d.id, direct);
    }
  const callers = new Map<string, Set<string>>();
  for (const [from, edges] of outgoing)
    for (const edge of edges) {
      const users = callers.get(edge.to) ?? new Set<string>();
      users.add(from);
      callers.set(edge.to, users);
    }
  const effectQueue = [...ir.effects.keys()];
  let effectPropagations = 0;
  for (let i = 0; i < effectQueue.length; i++) {
    const target = effectQueue[i]!;
    for (const caller of callers.get(target) ?? []) {
      const current = ir.effects.get(caller) ?? new Set<string>();
      let changed = false;
      for (const effect of ir.effects.get(target) ?? []) {
        effectPropagations++;
        if (!current.has(effect)) {
          current.add(effect);
          changed = true;
        }
      }
      ir.effects.set(caller, current);
      if (changed) effectQueue.push(caller);
    }
  }
  ir.measurements.effectPropagations = effectPropagations;
  for (const d of ir.declarations)
    if (callable(d))
      for (const effect of ir.effects.get(d.id) ?? [])
        if (!effectCovered(d.meta.effects, effect, d.kind === "rule")) {
          const queue: [string, string[]][] = [[d.id, [d.name]]],
            seen = new Set<string>();
          let path = [d.name];
          for (let q = 0; q < queue.length; q++) {
            const [id, p] = queue[q]!;
            if (seen.has(id)) continue;
            seen.add(id);
            const target = ir.symbols.get(id);
            if (
              target &&
              callable(target) &&
              target.kind === "op" &&
              target.meta.effects.includes(effect)
            ) {
              path = p;
              break;
            }
            for (const e of outgoing.get(id) ?? [])
              queue.push([e.to, [...p, ir.symbols.get(e.to)?.name ?? e.to]]);
          }
          ir.diagnostics.push(
            finding(
              "E002",
              `${d.kind === "rule" ? "Pure rule" : "Effect declaration"} does not cover ${effect}`,
              d.span,
              "error",
              [],
              path,
            ),
          );
        }
  // Cyclic pure-rule definitions are outside the total expression subset.
  const ruleEdges = new Map<string, string[]>();
  for (const d of ir.declarations)
    if (d.kind === "rule")
      ruleEdges.set(
        d.id,
        (outgoing.get(d.id) ?? [])
          .filter((e) => ir.symbols.get(e.to)?.kind === "rule")
          .map((e) => e.to),
      );
  const colour = new Map<string, number>();
  for (const root of ruleEdges.keys()) {
    if (colour.has(root)) continue;
    const stack: { id: string; index: number }[] = [{ id: root, index: 0 }];
    colour.set(root, 1);
    while (stack.length) {
      const top = stack.at(-1)!,
        edges = ruleEdges.get(top.id) ?? [];
      if (top.index >= edges.length) {
        colour.set(top.id, 2);
        stack.pop();
        continue;
      }
      const child = edges[top.index++]!;
      if (colour.get(child) === 1) {
        const d = ir.symbols.get(child)!;
        add("T007", "Recursive pure rules are unsupported", d.span);
      } else if (!colour.has(child)) {
        colour.set(child, 1);
        stack.push({ id: child, index: 0 });
      }
    }
  }
  // Unresolved syntax affects the module; holes/errors propagate over resolved dependencies.
  for (const s of snapshot.sources)
    if (s.recovered) for (const d of s.parsed.declarations) ir.holes.add(d.id);
  ir.measurements.symbols = ir.symbols.size;
  ir.measurements.edges = ir.edges.length;
  ir.measurements.typedExpressions = ir.info.size;
  return ir;
}
export function diagnosticsBySymbol(ir: ProjectIR): Map<string, Finding[]> {
  const groups = new Map<string, Decl[]>(),
    out = new Map<string, Finding[]>();
  for (const d of ir.declarations) {
    const a = groups.get(d.span.file) ?? [];
    a.push(d);
    groups.set(d.span.file, a);
  }
  for (const a of groups.values())
    a.sort((x, y) => x.span.start - y.span.start);
  for (const f of ir.diagnostics) {
    const ds = groups.get(f.span.file) ?? [];
    let lo = 0,
      hi = ds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ds[mid]!.span.start <= f.span.start) lo = mid + 1;
      else hi = mid;
    }
    const d = ds[lo - 1];
    if (d && f.span.start < d.span.end) {
      const fs = out.get(d.id) ?? [];
      fs.push(f);
      out.set(d.id, fs);
    }
  }
  return out;
}
export function blockedSymbols(
  ir: ProjectIR,
  includeHoles = true,
): Set<string> {
  const blocked = new Set(includeHoles ? ir.holes : []);
  for (const source of ir.snapshot.sources)
    if (source.recovered)
      for (const d of source.parsed.declarations) blocked.add(d.id);
  for (const [id, findings] of diagnosticsBySymbol(ir))
    if (findings.some((f) => f.severity === "error")) blocked.add(id);
  const reverse = new Map<string, string[]>();
  for (const e of ir.edges) {
    const a = reverse.get(e.to) ?? [];
    a.push(e.from);
    reverse.set(e.to, a);
  }
  const queue = [...blocked];
  for (let i = 0; i < queue.length; i++)
    for (const user of reverse.get(queue[i]!) ?? [])
      if (!blocked.has(user)) {
        blocked.add(user);
        queue.push(user);
      }
  return blocked;
}
export function expressionType(ir: ProjectIR, e: Expr): Type {
  return ir.info.get(nodeKey(e.span))?.type ?? errorType;
}
