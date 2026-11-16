// SPDX-License-Identifier: MIT
import type { Expr, Machine } from "../language/ast.js";
import type { ProjectIR } from "../semantic/core.js";
import {
  domainValid,
  evaluate,
  initial,
  replay,
  step,
  type GeneratedModel,
  type State,
  type TraceState,
} from "./model.js";

export type Completion =
  | "complete"
  | "state_budget"
  | "domain_boundary"
  | "cancelled"
  | "timed_out"
  | "engine_error";
export interface PropertyVerdict {
  property: string;
  verdict: "passed" | "violated" | "incomplete" | "no_violation_found";
  /** Present only after successful source replay. Includes the initial state. */
  trace?: TraceState[];
}
export interface ExploreResult {
  method: "exhaustive" | "sample";
  completion: Completion;
  properties: PropertyVerdict[];
  domain: PropertyVerdict;
  /** Null when the coordinator terminates a worker before receiving a result. */
  measurements: {
    statesVisited: number;
    transitionsTaken: number;
    depthReached: number;
    samples: number;
  } | null;
  /** Sampler configuration and a deterministic fingerprint of all chosen events. */
  sampling?: {
    seed: string;
    maxSteps: number;
    maxSamples: number;
    fingerprint: string;
  };
  error?: string;
}
export interface ExploreOptions {
  stateBudget?: number;
}
export interface SampleOptions {
  seed: string;
  maxSteps: number;
  maxSamples: number;
}
export function unresolved(
  model: GeneratedModel,
  method: ExploreResult["method"],
  completion: Completion,
  error?: string,
): ExploreResult {
  return {
    method,
    completion,
    properties: model.properties.map((p) => ({
      property: p.source,
      verdict: "incomplete",
    })),
    domain: { property: "state-domains", verdict: "incomplete" },
    measurements: null,
    ...(error === undefined ? {} : { error }),
  };
}
function integer(value: number, minimum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw Error(`${name} must be a safe integer >= ${minimum}`);
}
/** Type-tagged, length-delimited encoding, independent of object insertion order. */
export function canonicalState(state: State): string {
  return JSON.stringify(
    Object.keys(state)
      .sort()
      .map((key) => {
        const value = state[key]!;
        return [key, typeof value, String(value)];
      }),
  );
}

interface EventPlan {
  index: number;
  name: string;
  guard: Expr;
  machine: Machine;
  order: number;
}
/** Only index an exact equality guard; all other guards retain full evaluation. */
function eventPlans(model: GeneratedModel): (state: State) => EventPlan[] {
  const declarations = new Map(model.machine.events.map((e) => [e.name, e]));
  const fallback: EventPlan[] = [];
  const indexes = new Map<string, Map<string, EventPlan[]>>();
  for (const [order, mapping] of model.events.entries()) {
    const event = declarations.get(mapping.source);
    if (!event) throw Error(`Missing event ${mapping.source}`);
    const plan = {
      index: mapping.index,
      name: event.name,
      guard: event.guard,
      order,
      // step() owns simultaneous update semantics. Its named lookup is O(1)
      // in this one-event view; no other event affects a named step.
      machine: { ...model.machine, events: [event] },
    };
    const guard = event.guard;
    let name: string | undefined;
    let literal: Expr | undefined;
    if (guard.kind === "binary" && guard.op === "==") {
      if (guard.left.kind === "name" && guard.right.kind === "literal") {
        name = guard.left.name;
        literal = guard.right;
      } else if (guard.right.kind === "name" && guard.left.kind === "literal") {
        name = guard.right.name;
        literal = guard.left;
      }
    }
    if (name !== undefined && literal?.kind === "literal") {
      let index = indexes.get(name);
      if (!index) indexes.set(name, (index = new Map()));
      const key = canonicalState({ value: literal.value });
      const bucket = index.get(key) ?? [];
      bucket.push(plan);
      index.set(key, bucket);
    } else fallback.push(plan);
  }
  return (state) => {
    const candidates = [...fallback];
    for (const [name, index] of indexes)
      candidates.push(
        ...(index.get(canonicalState({ value: state[name]! })) ?? []),
      );
    candidates.sort((a, b) => a.order - b.order);
    return candidates.filter((p) => evaluate(p.guard, state) === true);
  };
}
interface Node {
  values: State;
  event: number;
  parent: number;
  depth: number;
}
function traceTo(nodes: Node[], index: number): TraceState[] {
  const trace: TraceState[] = [];
  while (index >= 0) {
    const node = nodes[index]!;
    trace.push({ values: node.values, event: node.event });
    index = node.parent;
  }
  return trace.reverse();
}
function inspector(
  model: GeneratedModel,
  result: ExploreResult,
  ir?: ProjectIR,
) {
  const invariants = new Map(model.machine.invariants.map((p) => [p.name, p]));
  return (state: State, witness: () => TraceState[]): boolean => {
    const validDomain = domainValid(model.machine, state);
    const failed = result.properties.filter((p) => {
      if (p.verdict === "violated") return false;
      const invariant = invariants.get(p.property);
      if (!invariant) throw Error(`Missing invariant ${p.property}`);
      try {
        return evaluate(invariant.expr, state) !== true;
      } catch (error) {
        if (validDomain) throw error;
        return false;
      }
    });
    const domainFailed = !validDomain && result.domain.verdict !== "violated";
    if (failed.length || domainFailed) {
      const trace = witness();
      const validation = replay(model, trace, ir);
      if (
        !validation.valid ||
        failed.some((p) => !validation.violated.includes(p.property)) ||
        (domainFailed && !validation.domainViolations.length)
      )
        throw Error(
          `Witness replay failed: ${validation.reason ?? "property disagreement"}`,
        );
      for (const property of [
        ...failed,
        ...(domainFailed ? [result.domain] : []),
      ]) {
        property.verdict = "violated";
        property.trace = trace;
      }
    }
    return validDomain;
  };
}
function finish(result: ExploreResult): ExploreResult {
  for (const property of [...result.properties, result.domain])
    if (property.verdict !== "violated")
      property.verdict =
        result.completion !== "complete"
          ? "incomplete"
          : result.method === "exhaustive"
            ? "passed"
            : "no_violation_found";
  return result;
}

export function explore(
  model: GeneratedModel,
  options: ExploreOptions = {},
  ir?: ProjectIR,
): ExploreResult {
  const result = unresolved(model, "exhaustive", "complete");
  result.measurements = {
    statesVisited: 0,
    transitionsTaken: 0,
    depthReached: 0,
    samples: 0,
  };
  try {
    const budget = options.stateBudget ?? 1_000_000;
    integer(budget, 1, "stateBudget");
    const enabled = eventPlans(model),
      inspect = inspector(model, result, ir);
    const first = initial(model.machine);
    const nodes: Node[] = [{ values: first, event: -2, parent: -1, depth: 0 }];
    const seen = new Set([canonicalState(first)]);
    result.measurements.statesVisited = 1;
    const valid: boolean[] = [inspect(first, () => traceTo(nodes, 0))];
    if (!valid[0]) result.completion = "domain_boundary";
    search: for (let head = 0; head < nodes.length; head++) {
      if (!valid[head]) continue;
      const node = nodes[head]!;
      const events = enabled(node.values);
      // Deadlocks have one implicit stuttering transition; no new state.
      if (!events.length) result.measurements.transitionsTaken++;
      for (const event of events) {
        const next = step(event.machine, node.values, event.name);
        result.measurements.transitionsTaken++;
        const key = canonicalState(next);
        if (seen.has(key)) continue;
        if (seen.size === budget) {
          result.completion = "state_budget";
          break search;
        }
        seen.add(key);
        const index = nodes.length;
        nodes.push({
          values: next,
          event: event.index,
          parent: head,
          depth: node.depth + 1,
        });
        result.measurements.statesVisited++;
        result.measurements.depthReached = node.depth + 1;
        valid.push(inspect(next, () => traceTo(nodes, index)));
        if (!valid[index]) result.completion = "domain_boundary";
      }
    }
    return finish(result);
  } catch (error) {
    // An engine failure invalidates all verdicts, including any earlier witnesses.
    return {
      ...unresolved(model, "exhaustive", "engine_error", String(error)),
      measurements: result.measurements,
    };
  }
}

/** FNV-1a seed hashing followed by Mulberry32; all arithmetic is uint32. */
function seedHash(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++)
    value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return value >>> 0;
}
export function sample(
  model: GeneratedModel,
  options: SampleOptions,
  ir?: ProjectIR,
): ExploreResult {
  const result = unresolved(model, "sample", "complete");
  result.measurements = {
    statesVisited: 0,
    transitionsTaken: 0,
    depthReached: 0,
    samples: 0,
  };
  try {
    if (typeof options.seed !== "string") throw Error("seed must be a string");
    integer(options.maxSteps, 0, "maxSteps");
    integer(options.maxSamples, 1, "maxSamples");
    let rng = seedHash(options.seed),
      fingerprint = 2166136261;
    const random = () => {
      rng = (rng + 0x6d2b79f5) >>> 0;
      let t = Math.imul(rng ^ (rng >>> 15), rng | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const enabled = eventPlans(model),
      inspect = inspector(model, result, ir);
    const seen = new Set<string>();
    for (let n = 0; n < options.maxSamples; n++) {
      result.measurements.samples++;
      let state = initial(model.machine);
      const trace: TraceState[] = [{ values: state, event: -2 }];
      fingerprint = Math.imul(fingerprint ^ 0xfffffffe, 16777619) >>> 0;
      seen.add(canonicalState(state));
      if (!inspect(state, () => [...trace])) {
        result.completion = "domain_boundary";
        continue;
      }
      for (let depth = 1; depth <= options.maxSteps; depth++) {
        const events = enabled(state);
        const event = events.length
          ? events[Math.floor(random() * events.length)]!
          : null;
        state = event
          ? step(event.machine, state, event.name)
          : step(model.machine, state, null);
        trace.push({ values: state, event: event?.index ?? -1 });
        fingerprint =
          Math.imul(fingerprint ^ (event?.index ?? -1), 16777619) >>> 0;
        result.measurements.transitionsTaken++;
        result.measurements.depthReached = Math.max(
          result.measurements.depthReached,
          depth,
        );
        seen.add(canonicalState(state));
        if (!inspect(state, () => [...trace])) {
          result.completion = "domain_boundary";
          break;
        }
      }
    }
    result.measurements.statesVisited = seen.size;
    result.sampling = {
      ...options,
      fingerprint: fingerprint.toString(16).padStart(8, "0"),
    };
    return finish(result);
  } catch (error) {
    return {
      ...unresolved(model, "sample", "engine_error", String(error)),
      measurements: result.measurements,
    };
  }
}
