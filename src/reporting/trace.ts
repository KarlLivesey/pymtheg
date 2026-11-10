import type { AnalysisResult } from "./report.js";
import type { Span } from "../shared/identity.js";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export interface TraceStep {
  index: number;
  operation: string;
  span: Span | null;
  values: Record<string, unknown>;
  changes: { name: string; before: unknown; after: unknown }[];
}
export function traceSteps(result: AnalysisResult): TraceStep[] {
  const witness = result.witnessOrDerivation;
  if (
    !object(witness) ||
    !Array.isArray(witness.states) ||
    !Array.isArray(witness.events)
  )
    return [];
  const events = witness.events;
  const equal = (a: unknown, b: unknown) =>
    JSON.stringify(a, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ) ===
    JSON.stringify(b, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  let eventIndex = 0;
  let previous: Record<string, unknown> = {};
  return witness.states.map((raw, index) => {
    if (!object(raw) || !object(raw.values))
      throw Error("Malformed stored trace state");
    const event = index === 0 || raw.event === -1 ? null : events[eventIndex++];
    if (
      index > 0 &&
      raw.event !== -1 &&
      (!object(event) ||
        typeof event.operation !== "string" ||
        !object(event.span))
    )
      throw Error("Stored trace is missing a source event");
    const values = raw.values,
      changes = Object.keys({ ...previous, ...values })
        .filter((key) => !equal(previous[key], values[key]))
        .map((name) => ({
          name,
          before: previous[name] ?? null,
          after: values[name] ?? null,
        }));
    previous = values;
    return {
      index,
      operation:
        index === 0
          ? "Initial state"
          : raw.event === -1
            ? "No enabled event (stutter)"
            : object(event) && typeof event.operation === "string"
              ? event.operation
              : "Unmapped event",
      span:
        object(event) && object(event.span)
          ? (event.span as unknown as Span)
          : null,
      values,
      changes,
    };
  });
}
