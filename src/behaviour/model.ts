import { evaluateScalar as evaluate } from "../shared/scalar-expression.js";
export { evaluateScalar as evaluate } from "../shared/scalar-expression.js";
import { machineScope } from "../shared/config.js";
import type { Machine, Expr } from "../language/ast.js";
import { exprChildren } from "../language/ast.js";
import { blockedSymbols, type ProjectIR } from "../semantic/core.js";
import { backendOperator, type Scalar } from "../shared/operators.js";
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
  quint: string;
  tla: string;
  config: string;
  hash: string;
  snapshotId: string;
  machine: Machine;
  variables: { source: string; generated: string; span: Span }[];
  events: { source: string; index: number; span: Span }[];
  properties: { source: string; generated: string; span: Span }[];
  assumptions: string[];
  bounds: Record<string, string>;
}
function mappingFor(
  d: Machine,
): Pick<GeneratedModel, "variables" | "events" | "properties"> {
  const variables = [...d.states]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s, i) => ({ source: s.name, generated: `v${i}`, span: s.span })),
    events = [...d.events]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e, i) => ({ source: e.name, index: i, span: e.span })),
    properties = [...d.invariants]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p, i) => ({ source: p.name, generated: `p${i}`, span: p.span }));
  return { variables, events, properties };
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
      lowered.model.hash = hash(
        lowered.model.quint +
          lowered.model.tla +
          lowered.model.config +
          json(lowered.model.flow),
      );
      return lowered;
    } catch (error) {
      return { kind: "incomplete", reasons: [String(error)] };
    }
  }
  if (d.kind !== "machine")
    return { kind: "unsupported", reasons: ["Select a flow or machine entry"] };
  const reasons: string[] = [];
  function supported(e: Expr): void {
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
        "Backend integer literal exceeds exact supported interchange range",
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
        `Backend domain ${s.name} exceeds supported interchange range`,
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
  const names = new Map(variables.map((v) => [v.source, v.generated]));
  function emit(e: Expr, target: "quint" | "tlc"): string {
    switch (e.kind) {
      case "literal":
        return typeof e.value === "boolean"
          ? target === "quint"
            ? String(e.value)
            : e.value
              ? "TRUE"
              : "FALSE"
          : String(e.value);
      case "name": {
        const n = names.get(e.name);
        if (!n) throw Error(`Unknown state ${e.name}`);
        return n;
      }
      case "unary":
        return e.op === "!"
          ? target === "quint"
            ? `not(${emit(e.expr, target)})`
            : `~(${emit(e.expr, target)})`
          : `(-${emit(e.expr, target)})`;
      case "binary":
        return `(${emit(e.left, target)} ${backendOperator[e.op]![target]} ${emit(e.right, target)})`;
      default:
        throw Error(`Unreachable unsupported expression ${e.kind}`);
    }
  }
  const qVars = variables.map(
      (v) =>
        `  var ${v.generated}: ${d.states.find((s) => s.name === v.source)!.type.name === "Bool" ? "bool" : "int"}`,
    ),
    allVars = [...variables.map((v) => v.generated), "eventId"];
  const qAssign = (values: string[]): string => `all { ${values.join(", ")}, }`;
  const qInit = qAssign([
    ...variables.map(
      (v) =>
        `${v.generated}' = ${emit(d.states.find((s) => s.name === v.source)!.init, "quint")}`,
    ),
    "eventId' = -2",
  ]);
  const qEvents = events.map((e) => {
    const src = d.events.find((x) => x.name === e.source)!;
    return `  action e${e.index} = ${qAssign([emit(src.guard, "quint"), ...variables.map((v) => `${v.generated}' = ${src.updates.some((u) => u.name === v.source) ? emit(src.updates.find((u) => u.name === v.source)!.expr, "quint") : v.generated}`), `eventId' = ${e.index}`])}`;
  });
  const qEnabled = d.events.length
      ? d.events.map((e) => `(${emit(e.guard, "quint")})`).join(" or ")
      : "false",
    qStutter = qAssign([
      `not(${qEnabled})`,
      ...variables.map((v) => `${v.generated}' = ${v.generated}`),
      "eventId' = -1",
    ]);
  const qDomain =
    variables
      .map((v) => {
        const s = d.states.find((s) => s.name === v.source)!;
        return s.type.name === "Bool"
          ? "true"
          : `(${s.min} <= ${v.generated} and ${v.generated} <= ${s.max})`;
      })
      .join(" and ") || "true";
  const quint = `module generated {\n${qVars.join("\n")}\n  var eventId: int\n  action init = ${qInit}\n${qEvents.join("\n")}\n  action idle = ${qStutter}\n  action step = any { ${[...events.map((e) => "e" + e.index), "idle"].join(", ")}, }\n  val domain = ${qDomain}\n${properties.map((p) => `  val ${p.generated} = ${emit(d.invariants.find((i) => i.name === p.source)!.expr, "quint")}`).join("\n")}\n  val safety = ${["domain", ...properties.map((p) => p.generated)].join(" and ")}\n}\n`;
  const tlaConj = (values: string[]): string =>
    values.map((s) => "/\\ " + s).join("\n");
  const tInit = tlaConj([
    ...variables.map(
      (v) =>
        `${v.generated} = ${emit(d.states.find((s) => s.name === v.source)!.init, "tlc")}`,
    ),
    "eventId = -2",
  ]);
  const tEvents = events.map((e) => {
    const src = d.events.find((x) => x.name === e.source)!;
    return `E${e.index} ==\n${tlaConj([emit(src.guard, "tlc"), ...variables.map((v) => `${v.generated}' = ${src.updates.some((u) => u.name === v.source) ? emit(src.updates.find((u) => u.name === v.source)!.expr, "tlc") : v.generated}`), `eventId' = ${e.index}`])}`;
  });
  const tEnabled = d.events.length
      ? d.events.map((e) => `(${emit(e.guard, "tlc")})`).join(" \\/ ")
      : "FALSE",
    tIdle = tlaConj([
      `~(${tEnabled})`,
      ...variables.map((v) => `${v.generated}' = ${v.generated}`),
      "eventId' = -1",
    ]),
    tDomain = variables
      .map((v) => {
        const s = d.states.find((s) => s.name === v.source)!;
        return s.type.name === "Bool"
          ? `${v.generated} \\in BOOLEAN`
          : `${v.generated} \\in ${s.min}..${s.max}`;
      })
      .join(" /\\ ");
  const tla = `---- MODULE Generated ----\nEXTENDS Integers\nVARIABLES ${allVars.join(", ")}\nInit ==\n${tInit}\n${tEvents.join("\n")}\nIdle ==\n${tIdle}\nNext == ${[...events.map((e) => "E" + e.index), "Idle"].join(" \\/ ")}\nDomain == ${tDomain}\n${properties.map((p) => `${p.generated} == ${emit(d.invariants.find((i) => i.name === p.source)!.expr, "tlc")}`).join("\n")}\nSafety == ${["Domain", ...properties.map((p) => p.generated)].join(" /\\ ")}\n====\n`,
    config = "INIT Init\nNEXT Next\nINVARIANT Safety\n";
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
      quint,
      tla,
      config,
      hash: hash(quint + tla + config),
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
        model.hash ===
          hash(model.quint + model.tla + model.config + json(model.flow)) &&
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
    model.hash === hash(model.quint + model.tla + model.config) &&
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
