import type { Span } from "../shared/identity.js";
export interface Located {
  span: Span;
}
export interface TypeRef extends Located {
  name: string;
  args: TypeRef[];
}
export interface Arg {
  mode: "value" | "take" | "borrow";
  expr: Expr;
}
export type Expr = Located &
  (
    | { kind: "literal"; value: bigint | boolean | string | null }
    | { kind: "name"; name: string }
    | { kind: "field"; base: Expr; name: string }
    | { kind: "call"; name: string; args: Arg[] }
    | { kind: "record"; name: string; fields: { name: string; value: Expr }[] }
    | { kind: "list"; items: Expr[] }
    | { kind: "unary"; op: string; expr: Expr }
    | { kind: "binary"; op: string; left: Expr; right: Expr }
    | { kind: "unknown"; reason: string }
  );
export interface Param extends Located {
  name: string;
  type: TypeRef;
  mode: Arg["mode"];
}
export interface CostAnnotation extends Located {
  kind: "cost" | "overhead" | "budget";
  metric: string;
  quality: "exact" | "upper";
  expr: Expr;
}
export interface Meta {
  clauses?: { kind: string; span: Span }[];
  effects: string[];
  effectSpans?: Span[];
  costs: CostAnnotation[];
  bounds: Record<string, bigint>;
  requires: Expr[];
  ensures: Expr[];
  settles: { param: string; outcomes: string[] }[];
  stable: boolean;
  creates: boolean;
  atomic?: boolean;
  protocol?: {
    machine: string;
    submit: string;
    outcomes: { value: Expr; guard: Expr; span: Span }[];
    span: Span;
  };
}
export type Stmt = Located & {
  bodySpan?: Span;
  yesSpan?: Span;
  noSpan?: Span;
} & (
    | { kind: "let"; name: string; expr: Expr }
    | { kind: "invoke"; name: string; args: Arg[]; binding: string | null }
    | { kind: "if"; test: Expr; yes: Stmt[]; no: Stmt[] }
    | {
        kind: "match";
        expr: Expr;
        arms: {
          tag: string;
          binding: string | null;
          body: Stmt[];
          bodySpan?: Span;
          span: Span;
        }[];
      }
    | { kind: "for"; name: string; count: Expr; body: Stmt[] }
    | { kind: "retry"; count: Expr; outcome: string; body: Stmt[] }
    | { kind: "return" | "propagate" | "assert"; expr: Expr }
    | {
        kind: "own";
        name: string;
        resource: string;
        nameSpan?: Span;
        resourceSpan?: Span;
      }
    | { kind: "move"; name: string; nameSpan?: Span }
    | {
        kind: "transition";
        name: string;
        state: string;
        nameSpan?: Span;
        stateSpan?: Span;
      }
    | { kind: "unknown"; reason: string; reasonSpan?: Span }
  );
export interface BaseDecl extends Located {
  nameSpan?: Span;
  name: string;
  id: string;
}
export interface TypeDecl extends BaseDecl {
  kind: "type";
  fields: { name: string; type: TypeRef; span: Span }[] | null;
  variants: { name: string; payload: TypeRef | null; span: Span }[];
}
export interface Resource extends BaseDecl {
  kind: "resource";
  states: string[];
  initial: string;
  terminal: string[];
  transitions: { from: string; to: string }[];
}
export interface Callable extends BaseDecl {
  kind: "op" | "flow" | "rule";
  params: Param[];
  paramsSpan?: Span;
  result: TypeRef;
  meta: Meta;
  body: Stmt[] | null;
  bodySpan?: Span;
  expr: Expr | null;
  cancel: Stmt[] | null;
  cancelSpan?: Span;
}
export interface Machine extends BaseDecl {
  kind: "machine";
  states: {
    name: string;
    type: TypeRef;
    min: bigint | null;
    max: bigint | null;
    minSpan?: Span;
    maxSpan?: Span;
    init: Expr;
    span: Span;
  }[];
  events: {
    name: string;
    guard: Expr;
    updates: { name: string; expr: Expr; span: Span }[];
    span: Span;
  }[];
  invariants: { name: string; expr: Expr; span: Span }[];
}
export type Decl = TypeDecl | Resource | Callable | Machine;
export interface Parsed {
  declarations: Decl[];
  imports: { path: string; span: Span }[];
}
export const nodeKey = (s: Span): string => `${s.file}:${s.start}:${s.end}`;
export function exprChildren(e: Expr): Expr[] {
  switch (e.kind) {
    case "literal":
    case "name":
    case "unknown":
      return [];
    case "field":
      return [e.base];
    case "call":
      return e.args.map((a) => a.expr);
    case "record":
      return e.fields.map((f) => f.value);
    case "list":
      return e.items;
    case "unary":
      return [e.expr];
    case "binary":
      return [e.left, e.right];
  }
}
export function expressions(s: Stmt): Expr[] {
  switch (s.kind) {
    case "let":
    case "return":
    case "propagate":
    case "assert":
    case "match":
      return [s.expr];
    case "invoke":
      return s.args.map((a) => a.expr);
    case "if":
      return [s.test];
    case "for":
    case "retry":
      return [s.count];
    default:
      return [];
  }
}
export function blocks(s: Stmt): Stmt[][] {
  switch (s.kind) {
    case "if":
      return [s.yes, s.no];
    case "match":
      return s.arms.map((a) => a.body);
    case "for":
    case "retry":
      return [s.body];
    default:
      return [];
  }
}
