// SPDX-License-Identifier: MIT
import { lex, type Token } from "./lexer.js";
import { finding, type Span, type Finding } from "../shared/identity.js";
import type {
  Expr,
  Arg,
  TypeRef,
  Param,
  Meta,
  Stmt,
  Decl,
  Parsed,
  Callable,
  Machine,
} from "./ast.js";
const precedence: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
};
const declarationStarts = [
  "import",
  "type",
  "resource",
  "op",
  "rule",
  "flow",
  "machine",
];
const semicolonBoundaries = new Set([
  ...declarationStarts,
  "let",
  "call",
  "return",
  "propagate",
  "if",
  "match",
  "for",
  "retry",
  "assert",
  "own",
  "move",
  "transition",
  "unknown",
  "state",
  "event",
  "invariant",
  "initial",
  "terminal",
  "}",
  "<eof>",
]);
class ParseError extends Error {
  constructor(
    readonly token: Token,
    message: string,
  ) {
    super(message);
  }
}
export function parse(
  file: string,
  source: string,
): Parsed & { diagnostics: Finding[]; tokenCount: number } {
  const { tokens, diagnostics } = lex(file, source);
  let p = 0,
    depth = 0;
  const peek = (): Token => tokens[p]!;
  const take = (): Token => tokens[p++]!;
  const is = (s: string): boolean => peek().text === s;
  const eat = (s: string): boolean => (is(s) ? (take(), true) : false);
  const need = (s: string): Token => {
    if (!is(s)) {
      const previous = tokens[p - 1];
      if (s === ";" && previous && semicolonBoundaries.has(peek().text))
        throw new ParseError(
          { ...previous, span: { ...previous.span, start: previous.span.end } },
          `Expected ';' after '${previous.text}'. Add ';' at the highlighted position to finish this statement or declaration.`,
        );
      throw new ParseError(peek(), `Expected '${s}', found '${peek().text}'`);
    }
    return take();
  };
  const id = (): string => {
    if (peek().kind !== "id")
      throw new ParseError(peek(), "Expected identifier");
    return take().text;
  };
  const qualified = (): string => {
    let n = id();
    while (eat(".")) n += "." + id();
    return n;
  };
  const str = (): string => {
    const t = take();
    if (t.kind !== "str") throw new ParseError(t, "Expected quoted string");
    try {
      return JSON.parse(t.text) as string;
    } catch {
      throw new ParseError(t, "Invalid string");
    }
  };
  const span = (start: Span): Span => ({
    ...start,
    end: tokens[Math.max(0, p - 1)]!.span.end,
  });
  const list = (end: string, f: () => void): void => {
    if (!is(end)) {
      f();
      while (eat(",")) f();
    }
    need(end);
  };
  const names = (): string[] => {
    const a = [qualified()];
    while (eat(",")) a.push(qualified());
    return a;
  };
  function typeRef(): TypeRef {
    const start = peek().span,
      name = qualified(),
      args: TypeRef[] = [];
    if (eat("<"))
      list(">", () => {
        args.push(typeRef());
      });
    if (is("["))
      throw new ParseError(
        peek(),
        `Use List<${name}> for a list type instead of ${name}[]`,
      );
    if (is("?"))
      throw new ParseError(
        peek(),
        `Optional results use an explicit outcome type, for example type MaybeValue = None | Some(${name}); then return MaybeValue. The '?' shorthand is not supported.`,
      );
    return { name, args, span: span(start) };
  }
  function args(): Arg[] {
    need("(");
    const a: Arg[] = [];
    list(")", () => {
      const mode = eat("take") ? "take" : eat("borrow") ? "borrow" : "value";
      a.push({ mode, expr: expr() });
    });
    return a;
  }
  function expr(min = 0): Expr {
    if (++depth > 200)
      throw new ParseError(peek(), "Expression nesting exceeds 200");
    if (["{", ";", ")", "]", ",", "}"].includes(peek().text)) {
      const token = peek();
      diagnostics.push(
        finding(
          "P002",
          "An expression is missing here. Enter a value or input name, or use an explicit unknown question.",
          token.span,
        ),
      );
      depth--;
      return {
        kind: "unknown",
        reason: "Missing expression",
        span: { ...token.span, end: token.span.start },
      };
    }
    const t = take();
    let e: Expr;
    if (t.kind === "int")
      e = { kind: "literal", value: BigInt(t.text), span: t.span };
    else if (t.kind === "str") {
      let v: string;
      try {
        v = JSON.parse(t.text) as string;
      } catch {
        throw new ParseError(t, "Invalid string");
      }
      e = { kind: "literal", value: v, span: t.span };
    } else if (["true", "false", "unit"].includes(t.text))
      e = {
        kind: "literal",
        value: t.text === "unit" ? null : t.text === "true",
        span: t.span,
      };
    else if (t.text === "unknown")
      e = { kind: "unknown", reason: str(), span: span(t.span) };
    else if (t.text === "await" && peek().kind === "id")
      throw new ParseError(
        t,
        `Describe this as a separate call statement, for example call ${peek().text}(input) as result; then use result. Model delayed outcomes with an event machine; JavaScript-style await is not supported.`,
      );
    else if (t.text === "!" || t.text === "-")
      e = { kind: "unary", op: t.text, expr: expr(7), span: span(t.span) };
    else if (t.text === "(") {
      e = expr();
      need(")");
      e = { ...e, span: span(t.span) };
    } else if (t.text === "[") {
      const items: Expr[] = [];
      list("]", () => {
        items.push(expr());
      });
      e = { kind: "list", items, span: span(t.span) };
    } else if (t.kind === "id") {
      let name = t.text;
      while (eat(".")) name += "." + id();
      if (is("(")) e = { kind: "call", name, args: args(), span: span(t.span) };
      else if (
        is("{") &&
        tokens[p + 1]?.kind === "id" &&
        tokens[p + 2]?.text === ":"
      ) {
        take();
        const fields: { name: string; value: Expr }[] = [];
        list("}", () => {
          const name = id();
          need(":");
          fields.push({ name, value: expr() });
        });
        e = { kind: "record", name, fields, span: span(t.span) };
      } else {
        const parts = name.split(".");
        e = { kind: "name", name: parts[0]!, span: t.span };
        for (const n of parts.slice(1))
          e = { kind: "field", base: e, name: n, span: span(t.span) };
      }
    } else throw new ParseError(t, `Expected expression, found '${t.text}'`);
    while (true) {
      if (eat(".")) {
        e = { kind: "field", base: e, name: id(), span: span(t.span) };
        continue;
      }
      const op = peek().text,
        prec = precedence[op];
      if (prec === undefined || prec < min) break;
      take();
      const right = expr(prec + 1);
      e = { kind: "binary", op, left: e, right, span: span(t.span) };
    }
    depth--;
    return e;
  }
  function params(): Param[] {
    need("(");
    const a: Param[] = [];
    list(")", () => {
      const start = peek().span,
        mode = eat("take") ? "take" : eat("borrow") ? "borrow" : "value",
        name = id();
      if (is("?"))
        throw new ParseError(
          peek(),
          "Optional inputs use an explicit outcome type, for example type MaybeValue = None | Some(Nat); then value: MaybeValue. The '?' shorthand is not supported.",
        );
      need(":");
      a.push({ mode, name, type: typeRef(), span: span(start) });
    });
    return a;
  }
  function meta(): Meta {
    const m: Meta = {
      clauses: [],
      effects: [],
      effectSpans: [],
      costs: [],
      bounds: Object.create(null) as Record<string, bigint>,
      requires: [],
      ensures: [],
      settles: [],
      stable: false,
      creates: false,
    };
    while (true) {
      const start = peek().span,
        k = peek().text;
      if (eat("effects")) {
        need("(");
        if (!is(")")) m.effects.push(...names());
        need(")");
        m.effectSpans!.push(span(start));
      } else if (k === "cost" || k === "overhead" || k === "budget") {
        take();
        const metric = id();
        let quality: "exact" | "upper" = "upper";
        if (k === "budget") need("<=");
        else if (eat("exact")) quality = "exact";
        else need("upper");
        m.costs.push({
          kind: k,
          metric,
          quality,
          expr: expr(),
          span: span(start),
        });
      } else if (eat("bound")) {
        const n = id();
        need("<=");
        const t = take();
        if (t.kind !== "int")
          throw new ParseError(t, "Bound must be a nonnegative integer");
        m.bounds[n] = BigInt(t.text);
      } else if (eat("requires")) m.requires.push(expr());
      else if (eat("ensures")) m.ensures.push(expr());
      else if (eat("settles")) {
        const param = id();
        need("on");
        need("(");
        const outcomes = names();
        need(")");
        m.settles.push({ param, outcomes });
      } else if (eat("protocol")) {
        const machine = id();
        need("{");
        need("submit");
        const submit = id();
        need(";");
        const outcomes: NonNullable<Meta["protocol"]>["outcomes"] = [];
        while (!is("}") && peek().kind !== "eof") {
          const start = peek().span;
          need("outcome");
          const value = expr();
          need("when");
          const guard = expr();
          need(";");
          outcomes.push({ value, guard, span: span(start) });
        }
        need("}");
        m.protocol = { machine, submit, outcomes, span: span(start) };
      } else if (eat("creates")) {
        need("result");
        m.creates = true;
      } else if (eat("atomic")) m.atomic = true;
      else if (eat("stable")) m.stable = true;
      else break;
      m.clauses!.push({ kind: k, span: span(start) });
    }
    return m;
  }
  function block(): { body: Stmt[]; span: Span } {
    if (++depth > 200)
      throw new ParseError(peek(), "Block nesting exceeds 200");
    const start = need("{").span;
    const a: Stmt[] = [];
    while (!is("}") && peek().kind !== "eof") a.push(stmt());
    need("}");
    depth--;
    return { body: a, span: span(start) };
  }
  function stmt(): Stmt {
    const t = take();
    let s: Stmt;
    switch (t.text) {
      case "let": {
        const name = id();
        need("=");
        const e = expr();
        need(";");
        s = { kind: "let", name, expr: e, span: span(t.span) };
        break;
      }
      case "call": {
        const name = qualified(),
          a = args(),
          binding = eat("as") ? id() : null;
        need(";");
        s = { kind: "invoke", name, args: a, binding, span: span(t.span) };
        break;
      }
      case "if": {
        const test = expr(),
          yes = block(),
          no = eat("else") ? block() : null;
        s = {
          kind: "if",
          test,
          yes: yes.body,
          no: no?.body ?? [],
          yesSpan: yes.span,
          ...(no ? { noSpan: no.span } : {}),
          span: span(t.span),
        };
        break;
      }
      case "match": {
        const e = expr();
        need("{");
        const arms: Extract<Stmt, { kind: "match" }>["arms"] = [];
        while (!is("}") && peek().kind !== "eof") {
          const start = peek().span,
            tag = id();
          let binding: string | null = null;
          if (eat("(")) {
            binding = id();
            need(")");
          }
          need("=>");
          const body = block();
          arms.push({
            tag,
            binding,
            body: body.body,
            bodySpan: body.span,
            span: span(start),
          });
        }
        need("}");
        s = { kind: "match", expr: e, arms, span: span(t.span) };
        break;
      }
      case "for": {
        const name = id();
        need("in");
        const count = expr(),
          body = block();
        s = {
          kind: "for",
          name,
          count,
          body: body.body,
          bodySpan: body.span,
          span: span(t.span),
        };
        break;
      }
      case "retry": {
        const count = expr();
        need("on");
        const outcome = id(),
          body = block();
        s = {
          kind: "retry",
          count,
          outcome,
          body: body.body,
          bodySpan: body.span,
          span: span(t.span),
        };
        break;
      }
      case "return":
      case "propagate":
      case "assert": {
        const e = expr();
        need(";");
        s = { kind: t.text, expr: e, span: span(t.span) };
        break;
      }
      case "own": {
        const nameSpan = peek().span;
        const name = id();
        need(":");
        const resourceStart = peek().span;
        const resource = qualified();
        const resourceSpan = span(resourceStart);
        need(";");
        s = {
          kind: "own",
          name,
          resource,
          nameSpan,
          resourceSpan,
          span: span(t.span),
        };
        break;
      }
      case "move": {
        const nameSpan = peek().span;
        const name = id();
        need(";");
        s = { kind: "move", name, nameSpan, span: span(t.span) };
        break;
      }
      case "transition": {
        const nameSpan = peek().span;
        const name = id();
        need("->");
        const stateSpan = peek().span;
        const state = id();
        need(";");
        s = {
          kind: "transition",
          name,
          state,
          nameSpan,
          stateSpan,
          span: span(t.span),
        };
        break;
      }
      case "unknown": {
        const reasonSpan = peek().span,
          reason = str();
        need(";");
        s = { kind: "unknown", reason, reasonSpan, span: span(t.span) };
        break;
      }
      case "while":
        throw new ParseError(
          t,
          "Use a bounded for loop, for example for i in attempts { ... }, with an explicit bound. Unbounded while loops are not supported.",
        );
      case "await":
        throw new ParseError(
          t,
          "Use call operation(input) as result; for a component call. Model asynchronous delivery and uncertainty with a finite event machine; JavaScript-style await is not supported.",
        );
      default:
        if (t.kind === "id" && is("("))
          throw new ParseError(
            t,
            `Use call ${t.text}(input); for a component call, or call ${t.text}(input) as result; when it returns a value. For a pure rule, use its value in let or return.`,
          );
        if (t.kind === "id" && is("="))
          throw new ParseError(
            t,
            `Local values are immutable. Use let nextValue = ...; to name the next value, or an explicit state-machine event for a state change; '${t.text} = ...' is not a statement.`,
          );
        throw new ParseError(t, `Expected statement, found '${t.text}'`);
    }
    return s;
  }
  function declaration(): Decl {
    const start = take(),
      nameStart = peek().span,
      name = qualified(),
      base = {
        name,
        id: `${file}#${name}`,
        span: start.span,
        nameSpan: span(nameStart),
      };
    switch (start.text) {
      case "type": {
        need("=");
        const variants: Extract<Decl, { kind: "type" }>["variants"] = [];
        let fields: Extract<Decl, { kind: "type" }>["fields"] = null;
        if (eat("{")) {
          fields = [];
          const f = fields;
          list("}", () => {
            const s = peek().span,
              name = id();
            if (is("?"))
              throw new ParseError(
                peek(),
                "Optional fields use an explicit outcome type, for example type MaybeValue = None | Some(Nat); then value: MaybeValue. The '?' shorthand is not supported.",
              );
            need(":");
            f.push({ name, type: typeRef(), span: span(s) });
          });
        } else {
          if (is("|"))
            throw new ParseError(
              peek(),
              "Write union variants without a leading '|', for example Ready | Done",
            );
          do {
            if (peek().kind === "str")
              throw new ParseError(
                peek(),
                "Use named union variants, for example Ready | Done; quoted string-literal unions are not supported",
              );
            const s = peek().span,
              name = id();
            let payload: TypeRef | null = null;
            if (eat("(")) {
              payload = typeRef();
              need(")");
            }
            variants.push({ name, payload, span: span(s) });
          } while (eat("|"));
        }
        need(";");
        return {
          ...base,
          kind: "type",
          fields,
          variants,
          span: span(start.span),
        };
      }
      case "resource": {
        need("{");
        need("states");
        const states = names();
        need(";");
        need("initial");
        const initial = id();
        need(";");
        need("terminal");
        const terminal = names();
        need(";");
        const transitions: { from: string; to: string }[] = [];
        while (!is("}")) {
          const from = id();
          need("->");
          const to = id();
          need(";");
          transitions.push({ from, to });
        }
        need("}");
        return {
          ...base,
          kind: "resource",
          states,
          initial,
          terminal,
          transitions,
          span: span(start.span),
        };
      }
      case "op":
      case "flow":
      case "rule": {
        const paramsStart = peek().span,
          ps = params(),
          paramsSpan = span(paramsStart);
        need("->");
        const result = typeRef();
        const m = meta();
        let body: Stmt[] | null = null,
          ex: Expr | null = null,
          cancel: Stmt[] | null = null;
        let bodySpan: Span | undefined, cancelSpan: Span | undefined;
        if (start.text === "rule") {
          need("=");
          ex = expr();
          need(";");
        } else if (start.text === "op") need(";");
        else {
          const parsed = block();
          body = parsed.body;
          bodySpan = parsed.span;
          if (eat("on")) {
            need("cancel");
            const parsedCancel = block();
            cancel = parsedCancel.body;
            cancelSpan = parsedCancel.span;
          }
        }
        return {
          ...base,
          kind: start.text,
          params: ps,
          paramsSpan,
          result,
          meta: m,
          body,
          ...(bodySpan ? { bodySpan } : {}),
          expr: ex,
          cancel,
          ...(cancelSpan ? { cancelSpan } : {}),
          span: span(start.span),
        } satisfies Callable;
      }
      case "machine": {
        const states: Machine["states"] = [],
          events: Machine["events"] = [],
          invariants: Machine["invariants"] = [];
        need("{");
        while (!is("}") && peek().kind !== "eof") {
          const t = take(),
            n = id();
          if (t.text === "state") {
            need(":");
            const type = typeRef();
            let min: bigint | null = null,
              max: bigint | null = null;
            let minSpan: Span | undefined, maxSpan: Span | undefined;
            if (eat("in")) {
              const minStart = peek().span.start;
              const negative = eat("-");
              const a = take();
              if (a.kind !== "int") throw new ParseError(a, "Expected integer");
              min = BigInt(a.text) * (negative ? -1n : 1n);
              minSpan = { ...a.span, start: minStart };
              need("..");
              const maxStart = peek().span.start;
              const neg = eat("-"),
                b = take();
              if (b.kind !== "int") throw new ParseError(b, "Expected integer");
              max = BigInt(b.text) * (neg ? -1n : 1n);
              maxSpan = { ...b.span, start: maxStart };
            }
            need("=");
            const init = expr();
            need(";");
            states.push({
              name: n,
              type,
              min,
              max,
              ...(minSpan ? { minSpan } : {}),
              ...(maxSpan ? { maxSpan } : {}),
              init,
              span: span(t.span),
            });
          } else if (t.text === "event") {
            need("when");
            const guard = expr(),
              updates: Machine["events"][number]["updates"] = [];
            need("{");
            while (!is("}") && peek().kind !== "eof") {
              const s = peek().span,
                name = id();
              need("=");
              const e = expr();
              need(";");
              updates.push({ name, expr: e, span: span(s) });
            }
            need("}");
            events.push({ name: n, guard, updates, span: span(t.span) });
          } else if (t.text === "invariant") {
            need("=");
            const e = expr();
            need(";");
            invariants.push({ name: n, expr: e, span: span(t.span) });
          } else throw new ParseError(t, "Expected state, event, or invariant");
        }
        need("}");
        return {
          ...base,
          kind: "machine",
          states,
          events,
          invariants,
          span: span(start.span),
        };
      }
      default:
        throw new ParseError(start, `Unknown declaration '${start.text}'`);
    }
  }
  const declarations: Decl[] = [],
    imports: Parsed["imports"] = [];
  while (peek().kind !== "eof") {
    const before = p;
    try {
      if (eat("import")) {
        const start = tokens[p - 1]!.span,
          path = str();
        need(";");
        imports.push({ path, span: span(start) });
      } else declarations.push(declaration());
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      diagnostics.push(finding("P002", e.message, e.token.span));
      depth = 0;
      if (p === before) p++;
      while (peek().kind !== "eof" && !declarationStarts.includes(peek().text))
        p++;
    }
  }
  return { declarations, imports, diagnostics, tokenCount: tokens.length };
}
