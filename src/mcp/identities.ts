import { identity } from "../shared/identity-values.js";
import { relativeSource } from "../studio/interface-search.js";
import type { AgentWorkspace } from "./workspace.js";
import type { AnalysisResult } from "../reporting/report.js";
export function agentSource(root: string, value: string): string {
  return value === root ? "." : relativeSource(root, value);
}
/** Translate provenance only. Modelled values and authored text stay exact. */
export function propertyOutput(root: string, result: AnalysisResult) {
  const witness = result.witnessOrDerivation;
  let translated = witness;
  if (witness && typeof witness === "object" && !Array.isArray(witness)) {
    const data = witness as Record<string, unknown>;
    if (
      result.analysisKind === "rule-copies" &&
      Array.isArray(data.definitions)
    )
      translated = {
        ...data,
        definitions: data.definitions.map((id: unknown) =>
          typeof id === "string" ? agentSource(root, id) : id,
        ),
      };
    if (
      ["source-call-counterexamples", "source-return-counterexamples"].includes(
        String(data.kind),
      ) &&
      Array.isArray(data.examples)
    )
      translated = {
        ...data,
        examples: data.examples.map((example: unknown) => {
          if (!example || typeof example !== "object") return example;
          const value = example as Record<string, unknown>;
          return {
            ...value,
            entry:
              typeof value.entry === "string"
                ? agentSource(root, value.entry)
                : value.entry,
            call: interfaceOutput(root, { span: value.call }).span,
            condition: interfaceOutput(root, { span: value.condition }).span,
          };
        }),
      };
    if (Array.isArray(data.events))
      translated = {
        ...data,
        events: data.events.map((event: unknown) => {
          if (!event || typeof event !== "object" || !("span" in event))
            return event;
          return {
            ...event,
            span: interfaceOutput(root, { span: event.span }).span,
          };
        }),
      };
  }
  return {
    ...result,
    propertyId: agentSource(root, result.propertyId),
    diagnostics: result.diagnostics.map((d) => interfaceOutput(root, { ...d })),
    witnessOrDerivation: translated,
  };
}
export async function resolveSymbolId(
  workspace: AgentWorkspace,
  value: string,
): Promise<string> {
  const split = value.lastIndexOf("#");
  if (split < 1 || !/^\w+$/.test(value.slice(split + 1)))
    throw Error(`Use a symbol ID such as file${identity.extension}#component`);
  return (
    (await workspace.access.path(value.slice(0, split), "buffer")) +
    value.slice(split)
  );
}
/** Only interface identity/location fields are translated; source text is untouched. */
export function interfaceOutput(
  root: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          (key === "symbolId" || key === "file") && typeof item === "string"
            ? agentSource(root, item)
            : visit(item),
        ]),
      );
    return value;
  };
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      (key === "symbolId" || key === "file") && typeof item === "string"
        ? agentSource(root, item)
        : visit(item),
    ]),
  );
}
export async function interfaceInput(
  workspace: AgentWorkspace,
  value: unknown,
): Promise<unknown> {
  let nodes = 0;
  const visit = async (value: unknown, depth: number): Promise<unknown> => {
    if (++nodes > 10000 || depth > 25)
      throw Error("Interface edit is too deeply nested or large");
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await visit(item, depth + 1));
      return result;
    }
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value))
        result[key] =
          key === "symbolId" && typeof item === "string"
            ? await resolveSymbolId(workspace, item)
            : await visit(item, depth + 1);
      return result;
    }
    return value;
  };
  return visit(value, 0);
}
