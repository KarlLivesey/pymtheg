import type {
  Callable,
  Expr,
  Stmt,
  TypeRef,
  Machine,
} from "../language/ast.js";
import { nodeKey, blocks } from "../language/ast.js";
import {
  blockedSymbols,
  callable,
  resourceResult,
  type ProjectIR,
  type Type,
} from "../semantic/core.js";
import { json, type Span } from "../shared/identity.js";
import {
  EvaluationViolation,
  expressionValue,
  type Value,
  type Environment,
} from "./values.js";
export class FlowUnsupported extends Error {}
export interface FlowScope {
  inputs?: Record<string, unknown[]>;
  results?: Record<string, unknown[]>;
  maxStates?: number;
}
interface Instruction {
  op:
    | "statement"
    | "for-enter"
    | "for-test"
    | "for-next"
    | "retry-enter"
    | "retry-test"
    | "end";
  stmt: Stmt | null;
  next: number;
  yes?: number;
  no?: number;
  arms?: Record<string, { target: number; binding: string | null }>;
  loop?: number;
}
interface Program {
  flow: Callable;
  code: Instruction[];
  entry: number;
  cancel: number | null;
}
export interface Frame {
  owner: number;
  flow: string;
  pc: number;
  env: Environment;
  binding: string | null;
  lastTag: string | null;
  loops: Record<string, { index: bigint; values: Value[] | bigint }>;
  cancelling: boolean;
  pending?: { op: string; binding: string | null };
}
export interface RuntimeResource {
  type: string;
  state: string;
  owner: number;
  settled: boolean;
}
export interface FlowState {
  protocols: Record<string, Environment>;
  resources: Record<string, RuntimeResource>;
  nextResource: number;
  nextOwner: number;
  frames: Frame[];
  status: "running" | "returned" | "cancelled" | "violated";
  result: Value;
  error: { code: string; message: string; span: Span; condition?: Span } | null;
}
export interface FlowEdge {
  state: FlowState;
  operation: string;
  span: Span;
}
export interface FlowProgram {
  ir: ProjectIR;
  entry: Callable;
  programs: Map<string, Program>;
  scope: FlowScope;
  assumptions: Set<string>;
  protocols: Map<string, { machine: Machine; submits: Set<string> }>;
  operationProtocols: Map<string, string>;
  usedScope: Set<string>;
}
function program(flow: Callable): Program {
  const code: Instruction[] = [];
  const add = (i: Instruction): number => (code.push(i), code.length - 1);
  const end = add({ op: "end", stmt: null, next: -1 });
  function block(body: Stmt[], next: number): number {
    for (const stmt of [...body].reverse()) {
      if (stmt.kind === "if") {
        next = add({
          op: "statement",
          stmt,
          next,
          yes: block(stmt.yes, next),
          no: block(stmt.no, next),
        });
      } else if (stmt.kind === "match") {
        const arms: Record<string, { target: number; binding: string | null }> =
          Object.create(null) as Record<
            string,
            { target: number; binding: string | null }
          >;
        for (const arm of stmt.arms)
          arms[arm.tag] = {
            target: block(arm.body, next),
            binding: arm.binding,
          };
        next = add({ op: "statement", stmt, next, arms });
      } else if (stmt.kind === "for") {
        const test = add({ op: "for-test", stmt, next }),
          increment = add({ op: "for-next", stmt, next: test, loop: test }),
          bodyEntry = block(stmt.body, increment);
        code[test]!.yes = bodyEntry;
        code[test]!.loop = test;
        next = add({ op: "for-enter", stmt, next: test, loop: test });
      } else if (stmt.kind === "retry") {
        const test = add({ op: "retry-test", stmt, next }),
          bodyEntry = block(stmt.body, test);
        code[test]!.yes = bodyEntry;
        code[test]!.loop = test;
        next = add({
          op: "retry-enter",
          stmt,
          next: bodyEntry,
          no: next,
          loop: test,
        });
      } else next = add({ op: "statement", stmt, next });
    }
    return next;
  }
  return {
    flow,
    code,
    entry: block(flow.body ?? [], end),
    cancel: flow.cancel ? block(flow.cancel, end) : null,
  };
}
export function compileFlow(
  ir: ProjectIR,
  name: string,
  rawScope: unknown = {},
  inspection: { allowHoles?: boolean } = {},
): FlowProgram {
  const entries = ir.declarations.filter(
    (d) => d.id === name || d.name === name,
  );
  const entry = entries[0];
  if (entries.length !== 1 || entry?.kind !== "flow")
    throw new FlowUnsupported("Select a unique structured flow");
  if (blockedSymbols(ir, !inspection.allowHoles).has(entry.id))
    throw new FlowUnsupported("Flow has unresolved source/type dependencies");
  if (
    typeof rawScope !== "object" ||
    rawScope === null ||
    Array.isArray(rawScope)
  )
    throw new FlowUnsupported("Flow scope must be an object");
  const scope = rawScope as FlowScope;
  for (const key of Object.keys(scope))
    if (!["inputs", "results", "maxStates"].includes(key))
      throw new FlowUnsupported(`Unknown flow scope setting ${key}`);
  for (const key of ["inputs", "results"] as const) {
    const value = scope[key];
    if (
      value !== undefined &&
      (typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !Object.values(value).every(Array.isArray))
    )
      throw new FlowUnsupported(
        `${key} must map names to arrays of finite values`,
      );
  }
  if (
    scope.maxStates !== undefined &&
    (!Number.isSafeInteger(scope.maxStates) ||
      scope.maxStates < 1 ||
      scope.maxStates > 100000)
  )
    throw new FlowUnsupported("maxStates must be 1..100000");
  const programs = new Map(
    ir.declarations
      .filter((d): d is Callable => d.kind === "flow")
      .map((d) => [d.id, program(d)]),
  );
  const reachable = new Set<string>(),
    queue = [entry.id];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of ir.edges)
      if (edge.from === id && ["call", "assumption"].includes(edge.kind))
        queue.push(edge.to);
  }
  for (const d of ir.declarations)
    if (
      d.kind === "op" &&
      reachable.has(d.id) &&
      !d.meta.protocol &&
      !d.meta.atomic &&
      d.meta.effects.some((e) => !e.startsWith("state."))
    )
      throw new FlowUnsupported(
        `Operation ${d.name} has external effects: declare an explicit atomic assumption or link a protocol before behavioural checking`,
      );
  const protocols = new Map<
      string,
      { machine: Machine; submits: Set<string> }
    >(),
    operationProtocols = new Map<string, string>();
  for (const d of ir.declarations)
    if (callable(d) && d.meta.protocol && reachable.has(d.id)) {
      const machine = ir.declarations.find(
        (m) =>
          m.kind === "machine" &&
          m.name === d.meta.protocol!.machine &&
          ir.edges.some((e) => e.from === d.id && e.to === m.id),
      );
      if (machine?.kind !== "machine")
        throw new FlowUnsupported("Unresolved operation protocol");
      if (
        d.params.length ||
        resourceResult(ir, ir.types.get(nodeKey(d.result.span)))
      )
        throw new FlowUnsupported(
          "Linked protocol operations currently require no parameters and no resource-valued result",
        );
      if (scope.results?.[d.name])
        throw new FlowUnsupported(
          "Linked protocol outcomes cannot be replaced by a result scope",
        );
      const instance = protocols.get(machine.id) ?? {
        machine,
        submits: new Set<string>(),
      };
      instance.submits.add(d.meta.protocol.submit);
      protocols.set(machine.id, instance);
      operationProtocols.set(d.id, machine.id);
    }
  return {
    ir,
    protocols,
    operationProtocols,
    usedScope: new Set(),
    entry,
    programs,
    scope,
    assumptions: new Set([
      "Sequential structured flow semantics; abstract operation outcomes are contract assumptions; safety only",
    ]),
  };
}
function decode(plan: FlowProgram, raw: unknown, type: Type): Value {
  switch (type.kind) {
    case "error":
      throw new FlowUnsupported("Unresolved value type");
    case "primitive":
      switch (type.name) {
        case "Unit":
          if (raw === null) return null;
          break;
        case "Bool":
          if (typeof raw === "boolean") return raw;
          break;
        case "String":
          if (typeof raw === "string") return raw;
          break;
        case "Int":
        case "Nat": {
          if (
            (typeof raw === "string" && /^-?\d+$/.test(raw)) ||
            (typeof raw === "number" && Number.isSafeInteger(raw))
          ) {
            const n = BigInt(raw);
            if (type.name === "Int" || n >= 0n) return n;
          }
          break;
        }
      }
      break;
    case "list":
      if (Array.isArray(raw))
        return raw.map((x) => decode(plan, x, type.element));
      break;
    case "result":
      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        "tag" in raw
      ) {
        const v = raw as { tag: unknown; value?: unknown };
        if (v.tag === "Ok")
          return { tag: "Ok", value: decode(plan, v.value ?? null, type.ok) };
        return decode(plan, raw, type.error);
      }
      break;
    case "nominal": {
      const d = plan.ir.symbols.get(type.id);
      if (d?.kind === "resource") return { resource: "@new:" + d.id };
      if (d?.kind === "type") {
        if (
          d.fields !== null &&
          raw &&
          typeof raw === "object" &&
          !Array.isArray(raw)
        ) {
          if (
            Object.keys(raw).some(
              (key) => !d.fields!.some((f) => f.name === key),
            )
          )
            throw new FlowUnsupported(`Unknown field in ${d.name} scope value`);
          const fields: Environment = Object.create(null) as Environment;
          for (const f of d.fields)
            fields[f.name] = decode(
              plan,
              (raw as Record<string, unknown>)[f.name],
              plan.ir.types.get(nodeKey(f.type.span))!,
            );
          return { record: d.name, fields };
        }
        if (d.fields === null) {
          const tag =
              typeof raw === "string"
                ? raw
                : raw && typeof raw === "object" && "tag" in raw
                  ? String(raw.tag)
                  : "",
            variant = d.variants.find((v) => v.name === tag);
          if (variant)
            return {
              tag,
              value: variant.payload
                ? decode(
                    plan,
                    typeof raw === "object" && raw && "value" in raw
                      ? raw.value
                      : undefined,
                    plan.ir.types.get(nodeKey(variant.payload.span))!,
                  )
                : null,
            };
        }
      }
      break;
    }
  }
  throw new FlowUnsupported(
    `Value ${JSON.stringify(raw)} is outside its declared type`,
  );
}
function product(parts: Value[][]): Value[][] {
  let rows: Value[][] = [[]];
  for (const values of parts) {
    if (rows.length * values.length > 10000)
      throw new FlowUnsupported(
        "Finite input product exceeds 10000 combinations",
      );
    rows = rows.flatMap((row) => values.map((value) => [...row, value]));
  }
  return rows;
}
function domain(
  plan: FlowProgram,
  type: Type,
  key: string,
  bound?: bigint,
  origin: "inputs" | "results" = "results",
): Value[] {
  const supplied = plan.scope[origin]?.[key];
  if (supplied) {
    plan.usedScope.add(origin + ":" + key);
    if (!supplied.length) throw new FlowUnsupported(`Empty domain for ${key}`);
    const values = supplied.map((raw) => decode(plan, raw, type));
    if (
      bound !== undefined &&
      values.some(
        (v) =>
          (typeof v === "bigint"
            ? v
            : Array.isArray(v)
              ? BigInt(v.length)
              : 0n) > bound,
      )
    )
      throw new FlowUnsupported(
        `Scope for ${key} exceeds its declared bound ${bound}`,
      );
    return values;
  }
  switch (type.kind) {
    case "error":
      throw new FlowUnsupported("Unresolved type domain");
    case "primitive":
      if (type.name === "Unit") return [null];
      if (type.name === "Bool") return [false, true];
      if (type.name === "Nat" && bound !== undefined && bound <= 1000n)
        return Array.from({ length: Number(bound) + 1 }, (_, i) => BigInt(i));
      throw new FlowUnsupported(
        `Provide an explicit finite domain for ${key} (${type.name})`,
      );
    case "list":
      throw new FlowUnsupported(
        `Provide explicit finite list inputs for ${key}`,
      );
    case "result":
      return [{ tag: "Ok", value: null }]
        .flatMap(() =>
          domain(plan, type.ok, key + ".Ok", undefined, origin).map(
            (value) => ({
              tag: "Ok",
              value,
            }),
          ),
        )
        .concat(
          domain(plan, type.error, key, undefined, origin) as {
            tag: string;
            value: Value;
          }[],
        );
    case "nominal": {
      const d = plan.ir.symbols.get(type.id);
      if (d?.kind === "resource") return [{ resource: "@new:" + d.id }];
      if (d?.kind === "type") {
        if (d.fields !== null)
          return product(
            d.fields.map((f) =>
              domain(
                plan,
                plan.ir.types.get(nodeKey(f.type.span))!,
                key + "." + f.name,
                undefined,
                origin,
              ),
            ),
          ).map((values) => ({
            record: d.name,
            fields: Object.fromEntries(
              d.fields!.map((f, i) => [f.name, values[i]!]),
            ),
          }));
        return d.variants.flatMap((v) =>
          v.payload
            ? domain(
                plan,
                plan.ir.types.get(nodeKey(v.payload.span))!,
                key + "." + v.name,
                undefined,
                origin,
              ).map((value) => ({ tag: v.name, value }))
            : [{ tag: v.name, value: null }],
        );
      }
      throw new FlowUnsupported(`Unknown nominal type ${key}`);
    }
  }
}
export function initialFlowStates(plan: FlowProgram): FlowState[] {
  const entry = plan.entry,
    p = plan.programs.get(entry.id)!;
  const rows = product(
    entry.params.map((param) =>
      domain(
        plan,
        plan.ir.types.get(nodeKey(param.type.span))!,
        param.name,
        entry.meta.bounds[param.name],
        "inputs",
      ),
    ),
  );
  const states: FlowState[] = rows.map((values) => ({
    protocols: Object.fromEntries(
      [...plan.protocols].map(([id, { machine }]) => [
        id,
        Object.fromEntries(
          machine.states.map((v) => [
            v.name,
            expressionValue(plan.ir, v.init, {}),
          ]),
        ),
      ]),
    ),
    resources: {},
    nextResource: 0,
    nextOwner: 1,
    frames: [
      {
        owner: 0,
        flow: entry.id,
        pc: p.entry,
        env: Object.fromEntries(
          entry.params.map((param, i) => [param.name, values[i]!]),
        ),
        binding: null,
        lastTag: null,
        loops: {},
        cancelling: false,
      },
    ],
    status: "running" as const,
    result: null,
    error: null,
  }));
  for (const state of states)
    for (const param of entry.params)
      state.frames[0]!.env[param.name] = materialize(
        plan,
        state,
        state.frames[0]!.env[param.name]!,
        param.mode === "borrow" ? -1 : 0,
      );
  const feasible = states.filter((s) =>
    entry.meta.requires.every(
      (e) => expressionValue(plan.ir, e, s.frames[0]!.env) === true,
    ),
  );
  if (!feasible.length)
    throw new FlowUnsupported(
      "No feasible initial state in the selected finite scope",
    );
  for (const s of feasible) checkProtocols(plan, s);
  return feasible;
}
const clone = (s: FlowState): FlowState => structuredClone(s);
function fail(s: FlowState, code: string, message: string, span: Span): void {
  s.status = "violated";
  s.error = { code, message, span };
}
function resourceIds(value: Value): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(resourceIds);
  if ("resource" in value) return [value.resource];
  if ("tag" in value) return resourceIds(value.value);
  return Object.values(value.fields).flatMap(resourceIds);
}
function materialize(
  plan: FlowProgram,
  state: FlowState,
  value: Value,
  owner: number,
): Value {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((v) => materialize(plan, state, v, owner));
  if ("resource" in value && value.resource.startsWith("@new:")) {
    const type = value.resource.slice(5),
      definition = plan.ir.symbols.get(type);
    if (definition?.kind !== "resource")
      throw new FlowUnsupported("Unknown resource type");
    const id = "r" + state.nextResource++;
    state.resources[id] = {
      type,
      state: definition.initial,
      owner,
      settled: false,
    };
    return { resource: id };
  }
  if ("tag" in value)
    return {
      tag: value.tag,
      value: materialize(plan, state, value.value, owner),
    };
  return value;
}
function unsettled(plan: FlowProgram, s: FlowState, owner: number): boolean {
  return Object.values(s.resources).some((r) => {
    const type = plan.ir.symbols.get(r.type);
    return (
      r.owner === owner &&
      !r.settled &&
      type?.kind === "resource" &&
      !type.terminal.includes(r.state)
    );
  });
}
function returned(plan: FlowProgram, s: FlowState, value: Value): void {
  const frame = s.frames.at(-1)!,
    flow = plan.programs.get(frame.flow)!.flow,
    env = { ...frame.env, result: value };
  if (!frame.cancelling)
    for (const post of flow.meta.ensures)
      if (expressionValue(plan.ir, post, env) !== true) {
        fail(s, "postcondition", "Postcondition failed", post.span);
        return;
      }
  const parent = s.frames.at(-2);
  if (!frame.cancelling)
    for (const id of resourceIds(value)) {
      const r = s.resources[id];
      if (r) r.owner = parent?.owner ?? -1;
    }
  if (unsettled(plan, s, frame.owner)) {
    fail(
      s,
      "resource",
      `${frame.cancelling ? "Cancellation" : "Return"} leaves an owned resource unsettled`,
      flow.span,
    );
    return;
  }
  s.frames.pop();
  if (!parent) {
    s.status = frame.cancelling ? "cancelled" : "returned";
    s.result = value;
    return;
  }
  if (frame.cancelling) {
    parent.cancelling = true;
    parent.pc = plan.programs.get(parent.flow)!.cancel ?? 0;
    return;
  }
  if (frame.binding) parent.env[frame.binding] = value;
  parent.lastTag =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "tag" in value
      ? value.tag
      : null;
}
function ordinarySuccessors(plan: FlowProgram, state: FlowState): FlowEdge[] {
  if (state.status !== "running") return [];
  const f = state.frames.at(-1)!,
    program = plan.programs.get(f.flow)!,
    instruction = program.code[f.pc]!,
    stmt = instruction.stmt,
    span = stmt?.span ?? program.flow.span;
  const next = clone(state),
    frame = next.frames.at(-1)!;
  const value = (e: Expr) => expressionValue(plan.ir, e, frame.env);
  const edge = (
    s: FlowState,
    operation: string = stmt?.kind ?? "return",
  ): FlowEdge => ({ state: s, operation, span });
  if (frame.pending) {
    const pending = frame.pending,
      d = plan.ir.symbols.get(pending.op);
    if (!d || !callable(d) || !d.meta.protocol)
      throw new FlowUnsupported("Invalid pending protocol call");
    const env = state.protocols[plan.operationProtocols.get(d.id)!]!;
    return d.meta.protocol.outcomes
      .filter((o) => expressionValue(plan.ir, o.guard, env) === true)
      .map((o) => {
        const response = clone(state),
          current = response.frames.at(-1)!;
        const output = expressionValue(plan.ir, o.value, env);
        if (pending.binding) current.env[pending.binding] = output;
        current.lastTag =
          output &&
          typeof output === "object" &&
          !Array.isArray(output) &&
          "tag" in output
            ? output.tag
            : null;
        delete current.pending;
        current.pc = instruction.next;
        return {
          state: response,
          operation: d.name + " response",
          span: o.span,
        };
      });
  }
  if (instruction.op === "end") {
    returned(plan, next, null);
    return [edge(next)];
  }
  if (!stmt) throw new FlowUnsupported("Missing flow instruction");
  if (stmt.kind === "unknown" || stmt.kind === "move")
    throw new FlowUnsupported(
      `Flow execution does not yet support ${stmt.kind}`,
    );
  if (instruction.op === "for-enter" && stmt.kind === "for") {
    const values = value(stmt.count);
    if (typeof values !== "bigint" && !Array.isArray(values))
      throw new FlowUnsupported("Invalid loop cardinality");
    frame.loops[String(instruction.loop)] = { index: 0n, values };
    frame.pc = instruction.next;
    return [edge(next, "for")];
  }
  if (instruction.op === "for-test" && stmt.kind === "for") {
    const loop = frame.loops[String(instruction.loop)]!,
      length =
        typeof loop.values === "bigint"
          ? loop.values
          : BigInt(loop.values.length);
    if (loop.index < length) {
      frame.env[stmt.name] =
        typeof loop.values === "bigint"
          ? loop.index
          : loop.values[Number(loop.index)]!;
      frame.pc = instruction.yes!;
    } else frame.pc = instruction.next;
    return [edge(next, "for")];
  }
  if (instruction.op === "for-next") {
    frame.loops[String(instruction.loop)]!.index++;
    frame.pc = instruction.next;
    return [edge(next, "for")];
  }
  if (instruction.op === "retry-enter" && stmt.kind === "retry") {
    const count = value(stmt.count);
    if (typeof count !== "bigint")
      throw new FlowUnsupported("Retry bound must be Nat");
    frame.loops[String(instruction.loop)] = { index: 1n, values: count };
    frame.pc = count === 0n ? instruction.no! : instruction.next;
    return [edge(next, "retry")];
  }
  if (instruction.op === "retry-test" && stmt.kind === "retry") {
    const loop = frame.loops[String(instruction.loop)]!;
    if (
      frame.lastTag === stmt.outcome &&
      loop.index < (loop.values as bigint)
    ) {
      loop.index++;
      frame.pc = instruction.yes!;
    } else frame.pc = instruction.next;
    return [edge(next, "retry")];
  }
  frame.pc = instruction.next;
  switch (stmt.kind) {
    case "let":
      frame.env[stmt.name] = value(stmt.expr);
      break;
    case "own": {
      const resource = plan.ir.declarations.find(
        (d) => d.kind === "resource" && d.name === stmt.resource,
      );
      if (!resource) throw new FlowUnsupported("Unknown resource");
      frame.env[stmt.name] = materialize(
        plan,
        next,
        { resource: "@new:" + resource.id },
        frame.owner,
      );
      break;
    }
    case "transition": {
      const ref = frame.env[stmt.name];
      if (!ref && frame.cancelling) break;
      if (
        !ref ||
        typeof ref !== "object" ||
        Array.isArray(ref) ||
        !("resource" in ref)
      )
        throw new FlowUnsupported("Invalid resource reference");
      const resource = next.resources[ref.resource],
        type = resource ? plan.ir.symbols.get(resource.type) : undefined;
      if (!resource || type?.kind !== "resource")
        throw new FlowUnsupported("Unknown resource state");
      // Cancellation handler transitions are conditional on acquisition and
      // caller ownership (docs/support.md), matching the ownership analysis.
      if (frame.cancelling && resource.owner !== frame.owner) break;
      if (
        resource.owner !== frame.owner ||
        !type.transitions.some(
          (t) => t.from === resource.state && t.to === stmt.state,
        )
      ) {
        fail(
          next,
          "resource",
          "Invalid ownership or lifecycle transition",
          stmt.span,
        );
        break;
      }
      resource.state = stmt.state;
      break;
    }
    case "assert":
      if (value(stmt.expr) !== true)
        fail(next, "assertion", "Source assertion failed", stmt.span);
      break;
    case "if":
      frame.pc = value(stmt.test) === true ? instruction.yes! : instruction.no!;
      break;
    case "match": {
      const outcome = value(stmt.expr);
      if (
        !outcome ||
        typeof outcome !== "object" ||
        Array.isArray(outcome) ||
        !("tag" in outcome)
      )
        throw new FlowUnsupported("Match requires a tagged value");
      const arm = instruction.arms?.[outcome.tag];
      if (!arm)
        throw new FlowUnsupported("Unhandled runtime outcome " + outcome.tag);
      if (arm.binding) frame.env[arm.binding] = outcome.value;
      frame.pc = arm.target;
      break;
    }
    case "return":
    case "propagate":
      returned(plan, next, value(stmt.expr));
      break;
    case "invoke": {
      const id = plan.ir.info.get(nodeKey(stmt.span))?.target,
        d = id ? plan.ir.symbols.get(id) : undefined;
      if (!d || !callable(d)) throw new FlowUnsupported("Unknown callee");
      if (
        frame.cancelling &&
        stmt.args.some(
          (a, i) =>
            a.expr.kind === "name" &&
            !Object.hasOwn(frame.env, a.expr.name) &&
            d.params[i] &&
            resourceResult(
              plan.ir,
              plan.ir.types.get(nodeKey(d.params[i]!.type.span)),
            ),
        )
      )
        return [edge(next, d.name)];
      const args = stmt.args.map((a) => value(a.expr)),
        env = Object.fromEntries(d.params.map((p, i) => [p.name, args[i]!]));
      for (const [name, bound] of Object.entries(d.meta.bounds))
        if (name !== "result") {
          const v = env[name],
            size =
              typeof v === "bigint"
                ? v
                : Array.isArray(v)
                  ? BigInt(v.length)
                  : null;
          if (size !== null && size > bound) {
            fail(
              next,
              "precondition",
              `Call exceeds ${name} bound ${bound}`,
              stmt.span,
            );
            return [edge(next, d.name)];
          }
        }
      for (const pre of d.meta.requires)
        if (expressionValue(plan.ir, pre, env) !== true) {
          fail(next, "precondition", "Call precondition failed", stmt.span);
          next.error!.condition = pre.span;
          return [edge(next, d.name)];
        }
      if (d.meta.protocol) {
        const machineId = plan.operationProtocols.get(d.id)!,
          machine = plan.protocols.get(machineId)!.machine;
        const event = machine.events.find(
          (e) => e.name === d.meta.protocol!.submit,
        )!;
        const env = state.protocols[machineId]!;
        if (expressionValue(plan.ir, event.guard, env) !== true) return [];
        frame.pc = f.pc;
        frame.pending = { op: d.id, binding: stmt.binding };
        applyProtocolEvent(plan, next, machine, event);
        return [edge(next, d.name + " submit")];
      }
      if (d.kind === "flow") {
        if (next.frames.length > 64)
          throw new FlowUnsupported("Call depth exceeds the supported bound");
        const child = plan.programs.get(d.id)!;
        const owner = next.nextOwner++;
        for (let i = 0; i < args.length; i++)
          if (d.params[i]?.mode === "take")
            for (const id of resourceIds(args[i]!)) {
              const r = next.resources[id];
              if (r) r.owner = owner;
            }
        next.frames.push({
          owner,
          flow: d.id,
          pc: child.entry,
          env,
          binding: stmt.binding,
          lastTag: null,
          loops: {},
          cancelling: false,
        });
        return [edge(next, d.name)];
      }
      if (d.kind === "rule") {
        const result = expressionValue(plan.ir, d.expr!, env);
        if (stmt.binding) frame.env[stmt.binding] = result;
        return [edge(next, d.name)];
      }
      if (
        resourceResult(plan.ir, plan.ir.types.get(nodeKey(d.result.span))) &&
        !d.meta.creates
      )
        throw new FlowUnsupported(`${d.name} must declare creates result`);
      plan.assumptions.add(
        `Abstract outcomes/effects of ${d.id} are environment contracts${d.meta.atomic ? "; atomic boundary explicitly assumed in source" : ""}`,
      );
      if (d.meta.ensures.length)
        plan.assumptions.add(
          `Postconditions of ${d.id} are assumed; the external implementation is not verified`,
        );
      const outputs = domain(
        plan,
        plan.ir.types.get(nodeKey(d.result.span))!,
        d.name,
        d.meta.bounds.result,
      ).filter((output) =>
        d.meta.ensures.every(
          (post) =>
            expressionValue(plan.ir, post, { ...env, result: output }) === true,
        ),
      );
      if (!outputs.length)
        throw new FlowUnsupported(
          `No feasible contract result for ${d.name} in selected scope`,
        );
      return outputs.map((output) => {
        const branch = clone(next),
          current = branch.frames.at(-1)!;
        const outcome =
          output &&
          typeof output === "object" &&
          !Array.isArray(output) &&
          "tag" in output
            ? output.tag
            : d.result.name === "Unit"
              ? "Unit"
              : "Return";
        for (let i = 0; i < args.length; i++)
          if (d.params[i]?.mode === "take") {
            const param = d.params[i]!;
            if (
              !d.meta.settles.some(
                (summary) =>
                  summary.param === param.name &&
                  summary.outcomes.includes(outcome),
              )
            )
              throw new FlowUnsupported(
                `No settlement contract for ${d.name}.${param.name} on ${outcome}`,
              );
            for (const id of resourceIds(args[i]!)) {
              const resource = branch.resources[id];
              if (resource) {
                resource.owner = -2;
                resource.settled = true;
              }
            }
          }
        const returned = materialize(plan, branch, output, current.owner);
        if (stmt.binding) current.env[stmt.binding] = returned;
        current.lastTag =
          output &&
          typeof output === "object" &&
          !Array.isArray(output) &&
          "tag" in output
            ? output.tag
            : null;
        return edge(branch, d.name);
      });
    }
    case "for":
    case "retry":
      throw new FlowUnsupported("Unexpected structured instruction");
  }
  return [edge(next)];
}
function checkProtocols(plan: FlowProgram, state: FlowState): void {
  for (const [id, { machine }] of plan.protocols) {
    const env = state.protocols[id]!;
    for (const v of machine.states) {
      const x = env[v.name];
      if (
        typeof x === "bigint" &&
        ((v.min !== null && x < v.min) || (v.max !== null && x > v.max))
      )
        throw new FlowUnsupported(
          `Protocol ${machine.name}.${v.name} leaves its declared domain`,
        );
    }
    for (const invariant of machine.invariants)
      if (expressionValue(plan.ir, invariant.expr, env) !== true) {
        fail(
          state,
          "environment",
          `Environment invariant ${machine.name}.${invariant.name} failed`,
          invariant.span,
        );
        return;
      }
  }
}
function applyProtocolEvent(
  plan: FlowProgram,
  state: FlowState,
  machine: Machine,
  event: Machine["events"][number],
): void {
  const old = state.protocols[machine.id]!;
  const updates = Object.fromEntries(
    event.updates.map((u) => [u.name, expressionValue(plan.ir, u.expr, old)]),
  );
  state.protocols[machine.id] = { ...old, ...updates };
  checkProtocols(plan, state);
}
function environmentSuccessors(
  plan: FlowProgram,
  state: FlowState,
): FlowEdge[] {
  if (state.status === "violated") return [];
  const edges: FlowEdge[] = [];
  for (const [id, { machine, submits }] of plan.protocols)
    for (const event of machine.events) {
      if (
        submits.has(event.name) ||
        expressionValue(plan.ir, event.guard, state.protocols[id]!) !== true
      )
        continue;
      const next = clone(state);
      applyProtocolEvent(plan, next, machine, event);
      edges.push({
        state: next,
        operation: machine.name + "." + event.name,
        span: event.span,
      });
    }
  return edges;
}
export function flowSuccessors(
  plan: FlowProgram,
  state: FlowState,
): FlowEdge[] {
  let ordinary: FlowEdge[];
  try {
    ordinary = ordinarySuccessors(plan, state);
  } catch (error) {
    if (!(error instanceof EvaluationViolation)) throw error;
    const failed = clone(state);
    fail(failed, error.code, error.message, error.span);
    ordinary = [{ state: failed, operation: error.code, span: error.span }];
  }
  const normal = [...ordinary, ...environmentSuccessors(plan, state)];
  if (state.status !== "running") return normal;
  const frame = state.frames.at(-1)!,
    program = plan.programs.get(frame.flow)!,
    instruction = program.code[frame.pc]!,
    stmt = instruction.stmt;
  if (
    frame.cancelling ||
    (instruction.op !== "end" &&
      !(
        instruction.op === "statement" &&
        stmt &&
        [
          "invoke",
          "transition",
          "own",
          "return",
          "propagate",
          "assert",
        ].includes(stmt.kind)
      ))
  )
    return normal;
  const cancelled = clone(state),
    current = cancelled.frames.at(-1)!;
  current.cancelling = true;
  delete current.pending;
  current.pc = program.cancel ?? 0;
  return [
    ...normal,
    {
      state: cancelled,
      operation: "cancel",
      span: stmt?.span ?? program.flow.span,
    },
  ];
}
export interface FlowGraph {
  scopeIssues?: string[];
  states: FlowState[];
  initial: number[];
  edges: { from: number; to: number; operation: string; span: Span }[];
  assumptions: string[];
  entryId: string;
}
export function flowGraph(plan: FlowProgram): FlowGraph {
  const states: FlowState[] = [],
    ids = new Map<string, number>(),
    edges: FlowGraph["edges"] = [],
    limit = plan.scope.maxStates ?? 5000;
  const put = (s: FlowState): number => {
    const key = json(s),
      existing = ids.get(key);
    if (existing !== undefined) return existing;
    if (states.length >= limit)
      throw new FlowUnsupported(
        `Flow graph exceeds maxStates=${limit}; no truncated check was performed`,
      );
    const id = states.length;
    states.push(s);
    ids.set(key, id);
    return id;
  };
  const initial = initialFlowStates(plan).map(put);
  for (let from = 0; from < states.length; from++) {
    for (const edge of flowSuccessors(plan, states[from]!)) {
      edges.push({
        from,
        to: put(edge.state),
        operation: edge.operation,
        span: edge.span,
      });
      if (edges.length > 100000)
        throw new FlowUnsupported("Flow transition budget exceeded");
    }
  }
  const scopeIssues: string[] = [];
  for (const origin of ["inputs", "results"] as const)
    for (const key of Object.keys(plan.scope[origin] ?? {}))
      if (!plan.usedScope.has(origin + ":" + key))
        scopeIssues.push(
          `Unused ${origin} scope key ${key}; it did not constrain this flow`,
        );
  if (scopeIssues.length && !states.some((state) => !!state.error))
    throw new FlowUnsupported(scopeIssues.join("; "));
  return {
    states,
    initial,
    edges,
    assumptions: [...plan.assumptions],
    ...(scopeIssues.length ? { scopeIssues } : {}),
    entryId: plan.entry.id,
  };
}

export function graphMachine(
  plan: FlowProgram,
  graph: FlowGraph,
): import("../language/ast.js").Machine {
  const span = plan.entry.span;
  const lit = (value: bigint | boolean): Expr => ({
    kind: "literal",
    value,
    span,
  });
  const ref = (): Expr => ({ kind: "name", name: "state", span });
  const comparison = (op: string, n: number): Expr => ({
    kind: "binary",
    op,
    left: ref(),
    right: lit(BigInt(n)),
    span,
  });
  const all = (xs: Expr[]): Expr =>
    xs.length === 0
      ? lit(true)
      : xs.length === 1
        ? xs[0]!
        : {
            kind: "binary",
            op: "&&",
            left: all(xs.slice(0, Math.floor(xs.length / 2))),
            right: all(xs.slice(Math.floor(xs.length / 2))),
            span,
          };
  const transitions = [
    ...graph.initial.map((to) => ({
      from: 0,
      to: to + 1,
      operation: "start",
      span,
    })),
    ...graph.edges.map((e) => ({ ...e, from: e.from + 1, to: e.to + 1 })),
  ];
  const reached = new Set(
    graph.states.flatMap((s) => s.frames.map((f) => f.flow)),
  );
  const queue = [...reached];
  for (let i = 0; i < queue.length; i++)
    for (const edge of plan.ir.edges)
      if (
        edge.from === queue[i] &&
        ["call", "rule"].includes(edge.kind) &&
        !reached.has(edge.to)
      ) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
  const declarations = plan.ir.declarations.filter(
    (d) => reached.has(d.id) && callable(d),
  ) as Callable[];
  const hasAssertion = (body: Stmt[]): boolean =>
    body.some((s) => s.kind === "assert" || blocks(s).some(hasAssertion));
  const kinds: string[] = [
    ...new Set(graph.states.flatMap((s) => (s.error ? [s.error.code] : []))),
  ];
  if (
    declarations.some(
      (d) => hasAssertion(d.body ?? []) || hasAssertion(d.cancel ?? []),
    )
  )
    kinds.push("assertion");
  if (declarations.some((d) => d.meta.requires.length))
    kinds.push("precondition");
  if (declarations.some((d) => d.kind !== "op" && d.meta.ensures.length))
    kinds.push("postcondition");
  if (graph.states.some((s) => Object.keys(s.resources).length))
    kinds.push("resource");
  if (plan.protocols.size) kinds.push("environment");
  if (!kinds.length) {
    kinds.push("execution");
    plan.assumptions.add(
      "No explicit assertion, concrete contract, acquired resource or linked invariant was exercised; executionSafe carries no business-safety claim",
    );
    graph.assumptions = [...plan.assumptions];
  }
  return {
    kind: "machine",
    id: plan.entry.id,
    name: plan.entry.name,
    span,
    states: [
      {
        name: "state",
        type: { name: "Nat", args: [], span },
        min: 0n,
        max: BigInt(graph.states.length),
        init: lit(0n),
        span,
      },
    ],
    events: transitions.map((e, i) => ({
      name: `${e.operation} [${i}]`,
      guard: comparison("==", e.from),
      updates: [{ name: "state", expr: lit(BigInt(e.to)), span: e.span }],
      span: e.span,
    })),
    invariants: [...new Set(kinds)].map((code) => ({
      name:
        code === "assertion"
          ? "assertionsHold"
          : code === "precondition"
            ? "callContractsHold"
            : code === "resource"
              ? "resourcesSettled"
              : code === "environment"
                ? "environmentInvariantsHold"
                : code === "execution"
                  ? "executionSafe"
                  : "postconditionsHold",
      expr: all(
        graph.states.flatMap((s, i) =>
          s.error?.code === code ? [comparison("!=", i + 1)] : [],
        ),
      ),
      span:
        graph.states.find((s) => s.error?.code === code)?.error?.span ?? span,
    })),
  };
}
export function graphDisplay(
  state: FlowState,
): Record<string, string | boolean> {
  const display: Record<string, string | boolean> = Object.create(
    null,
  ) as Record<string, string | boolean>;
  display.status = state.status;
  for (const [id, env] of Object.entries(state.protocols))
    for (const [name, value] of Object.entries(env))
      display[`${id.split("#").at(-1)}.${name}`] =
        typeof value === "boolean" ? value : String(value);
  for (const [id, r] of Object.entries(state.resources)) {
    const name = r.type.split("#").at(-1);
    display[`${name} ${id}`] = r.settled
      ? "settled by contract"
      : `${r.state} · ${r.owner < 0 ? "transferred" : "owned"}`;
  }
  for (const frame of state.frames) {
    const prefix = frame.flow.split("#").at(-1)!;
    for (const [name, value] of Object.entries(frame.env))
      display[`${prefix}.${name}`] =
        typeof value === "boolean"
          ? value
          : typeof value === "bigint"
            ? String(value)
            : json(value).trim();
  }
  if (state.status !== "running") display.result = json(state.result).trim();
  if (state.error) display.violation = state.error.message;
  return display;
}
