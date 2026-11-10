import type { ResourceDefinition } from "./declaration-data.js";
import { validateResourceDefinition } from "./resource-definition.js";
import { compareText } from "../shared/order.js";
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const edgeKey = (edge: ResourceDefinition["transitions"][number]) =>
  edge.from + "→" + edge.to;

export function resourceChanges(
  base: ResourceDefinition,
  next: ResourceDefinition,
): string[] {
  const changes: string[] = [];
  for (const state of next.states)
    if (!base.states.includes(state)) changes.push("Add state " + state);
  for (const state of base.states)
    if (!next.states.includes(state)) changes.push("Remove state " + state);
  if (base.initial !== next.initial)
    changes.push(`Starting state: ${base.initial} → ${next.initial}`);
  for (const state of next.terminal)
    if (!base.terminal.includes(state))
      changes.push("Cleanup complete in " + state);
  for (const state of base.terminal)
    if (!next.terminal.includes(state))
      changes.push("Cleanup no longer complete in " + state);
  const before = new Set(base.transitions.map(edgeKey)),
    after = new Set(next.transitions.map(edgeKey));
  for (const edge of after)
    if (!before.has(edge)) changes.push("Add transition " + edge);
  for (const edge of before)
    if (!after.has(edge)) changes.push("Remove transition " + edge);
  return changes;
}

export function mergeResourceDefinitions(
  base: ResourceDefinition,
  local: ResourceDefinition,
  current: ResourceDefinition,
) {
  const conflicts: string[] = [];
  for (const [label, value] of [
    ["Original", base],
    ["Your edited", local],
    ["Current", current],
  ] as const) {
    try {
      validateResourceDefinition(value);
    } catch (error) {
      conflicts.push(
        `${label} lifecycle needs correction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (conflicts.length) return { definition: null, conflicts };
  const scalar = <T>(key: string, before: T, mine: T, theirs: T): T => {
    if (equal(mine, before)) return theirs;
    if (equal(theirs, before) || equal(mine, theirs)) return mine;
    conflicts.push("Both versions changed " + key + " differently.");
    return mine;
  };
  const members = (before: string[], mine: string[], theirs: string[]) => {
    const original = new Set(before),
      a = new Set(mine),
      b = new Set(theirs);
    return [...new Set([...theirs, ...mine, ...before])].filter((value) =>
      original.has(value)
        ? a.has(value) && b.has(value)
        : a.has(value) || b.has(value),
    );
  };
  const originalStates = new Set(base.states);
  const additionsOnly = (states: string[]) =>
    equal(
      states.filter((state) => originalStates.has(state)),
      base.states,
    );
  const combineAdditions =
    !equal(local.states, base.states) &&
    !equal(current.states, base.states) &&
    !equal(local.states, current.states) &&
    additionsOnly(local.states) &&
    additionsOnly(current.states);
  const states = combineAdditions
    ? [
        ...base.states,
        ...[...new Set([...local.states, ...current.states])]
          .filter((state) => !originalStates.has(state))
          .sort(compareText),
      ]
    : scalar("the state list", base.states, local.states, current.states);
  const initial = scalar(
    "the starting state",
    base.initial,
    local.initial,
    current.initial,
  );
  if (base.name !== local.name || base.name !== current.name)
    conflicts.push("The resource identity changed.");
  const keys = members(
    base.transitions.map(edgeKey),
    local.transitions.map(edgeKey),
    current.transitions.map(edgeKey),
  );
  const edges = new Map(
    [...base.transitions, ...current.transitions, ...local.transitions].map(
      (edge) => [edgeKey(edge), edge],
    ),
  );
  const candidate: ResourceDefinition = {
    kind: "resource",
    name: base.name,
    states,
    initial,
    terminal: members(base.terminal, local.terminal, current.terminal),
    transitions: keys.map((key) => edges.get(key)!),
  };
  if (!conflicts.length) {
    try {
      validateResourceDefinition(candidate);
    } catch (error) {
      conflicts.push(
        "Combined rules need correction: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  return { definition: conflicts.length ? null : candidate, conflicts };
}
