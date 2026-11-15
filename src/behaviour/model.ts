import { evaluateScalar as evaluate } from "../shared/scalar-expression.js";
export { evaluateScalar as evaluate } from "../shared/scalar-expression.js";
import { machineScope } from "../shared/config.js";
import type { Machine, Expr } from "../language/ast.js";
import { exprChildren } from "../language/ast.js";
import { blockedSymbols, type ProjectIR } from "../semantic/core.js";
import { scalarBinaryOperators, type Scalar } from "../shared/operators.js";
import {
  compileFlow,
  flowGraph,
  graphMachine,
  flowSuccessors,
  initialFlowStates,
  graphDisplay,
  type FlowGraph,
  type FlowScope,
} from "./flow.js";
import { hash, type Span, json } from "../shared/identity.js";
export type State = Record<string, Scalar>;
export interface GeneratedModel {
  flow?: {
    sourceId: string;
    definitionHash: string;
    scope: FlowScope;
    graph: FlowGraph;
  };
  hash: string;
  snapshotId: string;
  machine: Machine;
  variables: { source: string; span: Span }[];
  events: { source: string; index: number; span: Span }[];
  properties: { source: string; span: Span }[];
  assumptions: string[];
  bounds: Record<string, string>;
}
function mappingFor(
  d: Machine,
): Pick<GeneratedModel, "variables" | "events" | "properties"> {
  const variables = [...d.states]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ source: s.name, span: s.span })),
    events = [...d.events]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e, i) => ({ source: e.name, index: i, span: e.span })),
    properties = [...d.invariants]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ source: p.name, span: p.span }));
  return { variables, events, properties };
}
/** Identity of the lowered machine and its source mapping. */
function machineModelHash(m: Machine): string {
  return hash(json({ machine: m, mapping: mappingFor(m) }));
}
function flowModelHash(model: GeneratedModel): string {
  return hash(machineModelHash(model.machine) + json(model.flow));
}
export type Preflight =
  | { kind: "supported"; model: GeneratedModel }
  | { kind: "unsupported" | "incomplete"; reasons: string[] };
export function initial(m: Machine): State {
  return Object.fromEntries(
    m.states.map((s) => [s.name, evaluate(s.init, {})]),
  );
}
export function domainValid(m: Machine, s: State): boolean {
  return m.states.every((v) =>
    v.type.name === "Bool"
      ? typeof s[v.name] === "boolean"
      : typeof s[v.name] === "bigint" &&
        v.min !== null &&
        v.max !== null &&
        (s[v.name] as bigint) >= v.min &&
        (s[v.name] as bigint) <= v.max,
  );
}
export function step(m: Machine, s: State, eventName: string | null): State {
  if (eventName === null) {
    if (m.events.some((e) => evaluate(e.guard, s) === true))
      throw Error("Stutter while event enabled");
    return { ...s };
  }
  const event = m.events.find((e) => e.name === eventName);
  if (!event || evaluate(event.guard, s) !== true)
    throw Error(`Disabled or unknown source event ${eventName}`);
  const next = { ...s };
  for (const u of event.updates) next[u.name] = evaluate(u.expr, s);
  return next;
}
export function lower(
  ir: ProjectIR,
  entry: string,
  scope: unknown = {},
): Preflight {
  const matches = ir.declarations.filter((d) => d.name === entry);
  if (matches.length !== 1)
    return {
      kind: "unsupported",
      reasons: [
        `Entry ${entry} is unknown or ambiguous. Available entries: ${
          ir.declarations
            .filter((d) => d.kind === "flow" || d.kind === "machine")
            .map((d) => d.name)
            .join(", ") || "none"
        }.`,
      ],
    };
  const d = matches[0]!;
  if (blockedSymbols(ir).has(d.id))
    return {
      kind: "incomplete",
      reasons: ["Entry depends on a hole, parse error or typing error"],
    };
  if (d.kind === "flow") {
    try {
      const plan = compileFlow(ir, entry, scope),
        graph = flowGraph(plan),
        machine = graphMachine(plan, graph);
      const adapted: ProjectIR = {
        ...ir,
        declarations: ir.declarations.map((x) => (x.id === d.id ? machine : x)),
        symbols: new Map(ir.symbols).set(d.id, machine),
      };
      const lowered = lower(adapted, entry);
      if (lowered.kind !== "supported") return lowered;
      lowered.model.flow = {
        sourceId: d.id,
        definitionHash: hash(json(d)),
        scope: plan.scope,
        graph,
      };
      lowered.model.assumptions.push(
        ...graph.assumptions,
        "Finite source-state graph; no unbounded executions are represented",
      );
      lowered.model.bounds = {
        ...lowered.model.bounds,
        sourceStates: String(graph.states.length),
        inputScope: json(plan.scope),
      };
      lowered.model.hash = flowModelHash(lowered.model);
      return lowered;
    } catch (error) {
      return { kind: "incomplete", reasons: [String(error)] };
    }
  }
  if (d.kind !== "machine")
    return { kind: "unsupported", reasons: ["Select a flow or machine entry"] };
  const reasons: string[] = [];
  const stateNames = new Set(d.states.map((s) => s.name));
  function supported(e: Expr): void {
    if (e.kind === "name" && !stateNames.has(e.name))
      reasons.push(`Unknown state ${e.name} at ${e.span.start}`);
    if (e.kind === "unary" && e.op !== "!" && e.op !== "-")
      reasons.push(`Unsupported operator ${e.op} at ${e.span.start}`);
    if (e.kind === "binary" && !scalarBinaryOperators.has(e.op))
      reasons.push(`Unsupported operator ${e.op} at ${e.span.start}`);
    if (
      e.kind === "literal" &&
      typeof e.value !== "bigint" &&
      typeof e.value !== "boolean"
    )
      reasons.push("Behavioural literals support Bool and Int/Nat only");
    if (!["literal", "name", "unary", "binary"].includes(e.kind))
      reasons.push(`Unsupported expression ${e.kind} at ${e.span.start}`);
    if (
      e.kind === "literal" &&
      typeof e.value === "bigint" &&
      (e.value > 9007199254740991n || e.value < -9007199254740991n)
    )
      reasons.push(
        "Behavioural integer literal exceeds the supported exact range",
      );
    for (const c of exprChildren(e)) supported(c);
  }
  for (const s of d.states) {
    supported(s.init);
    if (
      s.min !== null &&
      (s.min < -9007199254740991n || s.max! > 9007199254740991n)
    )
      reasons.push(
        `Behavioural domain ${s.name} exceeds the supported exact range`,
      );
  }
  for (const e of d.events) {
    supported(e.guard);
    for (const u of e.updates) supported(u.expr);
  }
  for (const p of d.invariants) supported(p.expr);
  if (reasons.length)
    return { kind: "unsupported", reasons: [...new Set(reasons)] };
  try {
    if (!domainValid(d, initial(d)))
      return {
        kind: "incomplete",
        reasons: ["Initial state violates declared domains"],
      };
  } catch (e) {
    return { kind: "incomplete", reasons: [String(e)] };
  }
  const { variables, events, properties } = mappingFor(d);
  const bounds = Object.fromEntries(
    d.states.map((s) => [
      s.name,
      s.type.name === "Bool" ? "Bool" : `${s.min}..${s.max}`,
    ]),
  );
  let scopeAssumptions: string[];
  try {
    scopeAssumptions = machineScope(scope, bounds);
  } catch (error) {
    return { kind: "incomplete", reasons: [String(error)] };
  }
  return {
    kind: "supported",
    model: {
      hash: machineModelHash(d),
      snapshotId: ir.snapshot.id,
      machine: d,
      variables,
      events,
      properties,
      assumptions: [
        "Events are atomic simultaneous updates; deadlock stutters; safety only; one finite machine instance",
        ...scopeAssumptions,
      ],
      bounds,
    },
  };
}
export interface TraceState {
  values: State;
  event: number;
}
export interface DomainViolation {
  state: string;
  value: string;
  minimum: string;
  maximum: string;
  span: Span;
  declarationSpan: Span;
  event: string;
}
export function replay(
  model: GeneratedModel,
  trace: TraceState[],
  ir?: ProjectIR,
): {
  valid: boolean;
  violated: string[];
  events: { operation: string; span: Span }[];
  domainViolations: DomainViolation[];
  reason: string | null;
} {
  const events: { operation: string; span: Span }[] = [];
  const domainViolations: DomainViolation[] = [];
  try {
    if (!trace.length) throw Error("Empty witness");
    const equal = (a: State, b: State): boolean =>
      model.variables.every((v) => a[v.source] === b[v.source]) &&
      Object.keys(a).length === Object.keys(b).length;
    if (
      trace[0]!.event !== -2 ||
      !equal(initial(model.machine), trace[0]!.values)
    )
      throw Error("Initial state mismatch");
    for (let i = 0; i < trace.length; i++) {
      const t = trace[i]!;
      if (i) {
        const event = model.events.find((e) => e.index === t.event);
        if (!event && t.event !== -1) throw Error("Invalid source event ID");
        const expected = step(
          model.machine,
          trace[i - 1]!.values,
          event?.source ?? null,
        );
        if (!equal(expected, t.values))
          throw Error("Source transition mismatch");
        if (event) events.push({ operation: event.source, span: event.span });
      }
      if (!domainValid(model.machine, t.values)) {
        if (model.flow || i === 0 || i !== trace.length - 1)
          throw Error(
            "Witness violates source data domain before its final source event",
          );
        const event = model.events.find((e) => e.index === t.event);
        const sourceEvent = model.machine.events.find(
          (e) => e.name === event?.source,
        );
        if (!sourceEvent) throw Error("Domain violation has no source event");
        for (const state of model.machine.states) {
          const value = t.values[state.name];
          if (state.type.name === "Bool") continue;
          if (
            typeof value !== "bigint" ||
            state.min === null ||
            state.max === null
          )
            throw Error("Invalid source state value or domain");
          if (value >= state.min && value <= state.max) continue;
          const update = sourceEvent.updates.find((u) => u.name === state.name);
          if (!update) throw Error("Domain violation has no source assignment");
          domainViolations.push({
            state: state.name,
            value: String(value),
            minimum: String(state.min),
            maximum: String(state.max),
            span: update.expr.span,
            declarationSpan: state.span,
            event: sourceEvent.name,
          });
        }
        if (!domainViolations.length) throw Error("Invalid source data domain");
      }
    }
    if (model.flow) {
      if (!ir) throw Error("Source IR required for flow replay");
      const source = ir.symbols.get(model.flow.sourceId);
      if (source?.kind !== "flow") throw Error("Missing source flow");
      const plan = compileFlow(ir, source.name, model.flow.scope),
        graph = model.flow.graph;
      for (let i = 1; i < trace.length; i++) {
        const from = Number(trace[i - 1]!.values.state),
          to = Number(trace[i]!.values.state);
        if (from === 0) {
          if (
            !initialFlowStates(plan).some(
              (s) => json(s) === json(graph.states[to - 1]),
            )
          )
            throw Error("Flow initial state mismatch");
        } else if (
          trace[i]!.event !== -1 &&
          !flowSuccessors(plan, graph.states[from - 1]!).some(
            (edge) => json(edge.state) === json(graph.states[to - 1]),
          )
        )
          throw Error("Flow source-step mismatch");
      }
    }
    const last = trace.at(-1)!.values,
      violated = model.machine.invariants.flatMap((i) => {
        try {
          return evaluate(i.expr, last) !== true ? [i.name] : [];
        } catch (error) {
          if (domainViolations.length) return [];
          throw error;
        }
      });
    if (!violated.length && !domainViolations.length)
      throw Error("Trace does not end in an invariant violation");
    return { valid: true, violated, events, domainViolations, reason: null };
  } catch (e) {
    return {
      valid: false,
      violated: [],
      events,
      domainViolations: [],
      reason: String(e),
    };
  }
}

export function sourceMappingValid(
  model: GeneratedModel,
  ir: ProjectIR,
): boolean {
  const source = ir.symbols.get(model.machine.id);
  if (model.flow) {
    if (
      source?.kind !== "flow" ||
      model.flow.sourceId !== source.id ||
      model.flow.definitionHash !== hash(json(source))
    )
      return false;
    try {
      const expected = graphMachine(
        compileFlow(ir, source.name, model.flow.scope),
        model.flow.graph,
      );
      return (
        model.snapshotId === ir.snapshot.id &&
        model.hash === flowModelHash(model) &&
        json(expected) === json(model.machine) &&
        json(mappingFor(expected)) ===
          json({
            variables: model.variables,
            events: model.events,
            properties: model.properties,
          })
      );
    } catch {
      return false;
    }
  }
  if (source?.kind !== "machine") return false;
  return (
    model.snapshotId === ir.snapshot.id &&
    model.hash === machineModelHash(model.machine) &&
    hash(json(source)) === hash(json(model.machine)) &&
    json(mappingFor(source)) ===
      json({
        variables: model.variables,
        events: model.events,
        properties: model.properties,
      })
  );
}
export function displayTrace(
  model: GeneratedModel,
  trace: TraceState[],
): unknown {
  return model.flow
    ? trace.map((t) => ({
        event: t.event,
        values:
          t.values.state === 0n
            ? { status: "initializing" }
            : graphDisplay(
                model.flow!.graph.states[Number(t.values.state) - 1]!,
              ),
      }))
    : trace;
}
/** The model the built-in engines check, as JSON for `emit --target json`. */
export function modelDocument(ir: ProjectIR, model: GeneratedModel): string {
  return json({
    schema: "pymtheg.model/v1",
    snapshotId: model.snapshotId,
    modelHash: model.hash,
    machine: model.machine,
    variables: model.variables,
    events: model.events,
    properties: model.properties,
    assumptions: model.assumptions,
    bounds: model.bounds,
    ...(model.flow
      ? {
          flow: {
            sourceId: model.flow.sourceId,
            scope: model.flow.scope,
            sourceStates: model.flow.graph.states.map(graphDisplay),
          },
        }
      : {}),
    sources: ir.snapshot.sources.map((s) => ({ file: s.file, hash: s.hash })),
  });
}
