import { authoringExpression as expression } from "./authoring-expression.js";
import { validateNumericRange } from "./numeric-range.js";
import { checkSourceName } from "./signature-source.js";
import { machineDefinitionSchema } from "./machine-data.js";

/** Create finite-machine syntax only. The canonical checker owns its meaning. */
export function machineDefinitionSource(value: unknown): string {
  const item = machineDefinitionSchema.parse(value);
  checkSourceName(item.name, "Event model");
  const stateNames = new Set<string>();
  const names = (name: string, kind: string, seen: Set<string>) => {
    checkSourceName(name, kind);
    if (seen.has(name)) throw Error(`${kind} names must be distinct: ${name}`);
    seen.add(name);
  };
  const states = item.states.map((state) => {
    names(state.name, "State", stateNames);
    let range = "";
    if (state.type !== "Bool") {
      const { min, max } = validateNumericRange(
        state.min,
        state.max,
        state.type,
        `State ${state.name}`,
      );
      range = ` in ${min}..${max}`;
    }
    return `  state ${state.name}: ${state.type}${range} = ${expression(state.initial, "Starting value for " + state.name)};`;
  });
  const eventNames = new Set<string>();
  const events = item.events.map((event) => {
    names(event.name, "Event", eventNames);
    const assigned = new Set<string>();
    const updates = event.updates.map((update) => {
      if (!stateNames.has(update.state))
        throw Error(`Event ${event.name}: choose a declared state to update.`);
      if (assigned.has(update.state))
        throw Error(`Event ${event.name}: assign ${update.state} only once.`);
      assigned.add(update.state);
      return `    ${update.state} = ${expression(update.value, "New value for " + update.state)};`;
    });
    return `  event ${event.name} when ${expression(event.guard, "When " + event.name + " may happen")} {\n${updates.join("\n")}\n  }`;
  });
  const invariantNames = new Set<string>();
  const invariants = item.invariants.map((rule) => {
    names(rule.name, "Safety rule", invariantNames);
    return `  invariant ${rule.name} = ${expression(rule.expression, "Safety rule " + rule.name)};`;
  });
  const source = `machine ${item.name} {\n${[...states, ...events, ...invariants].join("\n")}\n}\n`;
  if (Buffer.byteLength(source) > 256 * 1024)
    throw Error(
      "This event model exceeds the 256 KiB authoring limit. Split it into smaller models.",
    );
  return source;
}
