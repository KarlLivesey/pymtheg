import type { ProjectIR, Type } from "../semantic/core.js";
import { nodeKey } from "../language/ast.js";
export type ValueShape =
  | { kind: "bool" | "int" | "nat" | "string" | "unit"; label: string }
  | { kind: "list"; label: string; item: ValueShape }
  | {
      kind: "record";
      label: string;
      fields: { name: string; shape: ValueShape }[];
    }
  | {
      kind: "tagged";
      label: string;
      variants: { tag: string; payload: ValueShape | null }[];
    }
  | { kind: "resource" | "unsupported"; label: string };
export interface CallableShape {
  parameters: {
    name: string;
    shape: ValueShape;
    typeKey?: string;
    bound?: string;
    mode?: "value" | "take" | "borrow";
  }[];
  result: ValueShape;
  abstract: boolean;
  protocol: boolean;
}
export const guidedShapeLimits = {
  perShape: 512,
  perRun: 8192,
  metadataChunk: 64,
} as const;
export interface ShapeBudget {
  remaining: number;
}
const tooLarge = Symbol("guided shape limit");
export function valueShape(
  ir: ProjectIR,
  type: Type | undefined,
  budget: ShapeBudget = { remaining: guidedShapeLimits.perShape },
): ValueShape {
  // A single form is bounded even when a shared type DAG could unfold exponentially.
  const local: ShapeBudget = {
    remaining: Math.min(guidedShapeLimits.perShape, budget.remaining),
  };
  try {
    return visitShape(ir, type, new Set(), 0, local);
  } catch (error) {
    if (error !== tooLarge) throw error;
    return {
      kind: "unsupported",
      label: "Guided input size limit reached; use the source editor",
    };
  } finally {
    budget.remaining -=
      Math.min(guidedShapeLimits.perShape, budget.remaining) - local.remaining;
  }
}
function visitShape(
  ir: ProjectIR,
  type: Type | undefined,
  ancestors: ReadonlySet<string>,
  depth: number,
  budget: ShapeBudget,
): ValueShape {
  if (budget.remaining <= 0) throw tooLarge;
  budget.remaining--;
  if (!type || type.kind === "error")
    return { kind: "unsupported", label: "Unresolved type" };
  if (depth > 8)
    return {
      kind: "unsupported",
      label: "Type nesting exceeds the form limit",
    };
  const nested = (t: Type | undefined) =>
    visitShape(ir, t, ancestors, depth + 1, budget);
  switch (type.kind) {
    case "primitive":
      return {
        kind: (
          {
            Bool: "bool",
            Int: "int",
            Nat: "nat",
            String: "string",
            Unit: "unit",
          } as const
        )[type.name],
        label: type.name,
      };
    case "list":
      return { kind: "list", label: "List", item: nested(type.element) };
    case "result": {
      const errors = nested(type.error);
      if (errors.kind !== "tagged")
        return { kind: "unsupported", label: "Unresolved Result errors" };
      return {
        kind: "tagged",
        label: "Result",
        variants: [{ tag: "Ok", payload: nested(type.ok) }, ...errors.variants],
      };
    }
    case "nominal": {
      const declaration = ir.symbols.get(type.id);
      if (!declaration) return { kind: "unsupported", label: "Unknown type" };
      if (declaration.kind === "resource")
        return { kind: "resource", label: declaration.name };
      if (declaration.kind !== "type" || ancestors.has(type.id))
        return { kind: "unsupported", label: "Recursive type" };
      if (
        (declaration.fields ?? declaration.variants).length > budget.remaining
      )
        throw tooLarge;
      const next = new Set(ancestors).add(type.id);
      const field = (t: import("../language/ast.js").TypeRef) =>
        visitShape(ir, ir.types.get(nodeKey(t.span)), next, depth + 1, budget);
      return declaration.fields === null
        ? {
            kind: "tagged",
            label: declaration.name,
            variants: declaration.variants.map((v) => ({
              tag: v.name,
              payload: v.payload ? field(v.payload) : null,
            })),
          }
        : {
            kind: "record",
            label: declaration.name,
            fields: declaration.fields.map((f) => ({
              name: f.name,
              shape: field(f.type),
            })),
          };
    }
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function isValueShape(v: unknown, depth = 0): v is ValueShape {
  if (
    depth > 10 ||
    !object(v) ||
    typeof v.label !== "string" ||
    typeof v.kind !== "string"
  )
    return false;
  if (
    [
      "bool",
      "int",
      "nat",
      "string",
      "unit",
      "resource",
      "unsupported",
    ].includes(v.kind)
  )
    return true;
  if (v.kind === "list") return isValueShape(v.item, depth + 1);
  if (v.kind === "record")
    return (
      Array.isArray(v.fields) &&
      v.fields.every(
        (f) =>
          object(f) &&
          typeof f.name === "string" &&
          isValueShape(f.shape, depth + 1),
      )
    );
  if (v.kind === "tagged")
    return (
      Array.isArray(v.variants) &&
      v.variants.every(
        (f) =>
          object(f) &&
          typeof f.tag === "string" &&
          (f.payload === null || isValueShape(f.payload, depth + 1)),
      )
    );
  return false;
}
export function isCallableShape(v: unknown): v is CallableShape {
  return (
    object(v) &&
    Array.isArray(v.parameters) &&
    v.parameters.every(
      (p) =>
        object(p) &&
        typeof p.name === "string" &&
        (p.typeKey === undefined || typeof p.typeKey === "string") &&
        isValueShape(p.shape) &&
        (p.mode === undefined ||
          ["value", "take", "borrow"].includes(String(p.mode))) &&
        (p.bound === undefined ||
          (typeof p.bound === "string" && /^\d+$/.test(p.bound))),
    ) &&
    isValueShape(v.result) &&
    typeof v.abstract === "boolean" &&
    typeof v.protocol === "boolean"
  );
}
