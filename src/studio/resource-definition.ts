import { resourceDefinitionSchema } from "./declaration-data.js";
import { checkSourceName } from "./signature-source.js";

/** Shared form validation, independent of source generation and browser state. */
export function validateResourceDefinition(value: unknown) {
  const item = resourceDefinitionSchema.parse(value);
  checkSourceName(item.name, "Resource");
  if (!item.terminal.length)
    throw Error("Choose at least one cleanup-complete state.");
  const states = new Set(item.states);
  if (states.size !== item.states.length)
    throw Error("Each resource state needs a different name.");
  for (const state of states) checkSourceName(state, "State");
  const member = (state: string) => {
    if (!states.has(state)) throw Error("Choose a declared state: " + state);
  };
  member(item.initial);
  item.terminal.forEach(member);
  if (new Set(item.terminal).size !== item.terminal.length)
    throw Error("Choose each cleanup state once.");
  const edges = new Set<string>();
  for (const edge of item.transitions) {
    member(edge.from);
    member(edge.to);
    const key = edge.from + "->" + edge.to;
    if (edges.has(key)) throw Error("Choose each allowed transition once.");
    edges.add(key);
  }
  return item;
}
