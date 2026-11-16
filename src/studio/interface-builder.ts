// SPDX-License-Identifier: MIT
import type { SignatureInput } from "./interface-data.js";
import { interfaceTypeSource } from "./interface-syntax.js";
import { identifierProblem } from "../shared/names.js";
export type ScalarType = "Nat" | "Int" | "String" | "Bool" | "Unit";
export type InterfaceType =
  | ScalarType
  | { kind: "unselected" }
  | { kind: "list"; element: InterfaceType }
  | {
      kind: "record";
      name: string;
      fields: { name: string; type: InterfaceType }[];
    }
  | {
      kind: "choice";
      name: string;
      variants: { name: string; payload?: InterfaceType }[];
    }
  | { kind: "result"; ok: InterfaceType; error: InterfaceType }
  | { kind: "named"; name: string; symbolId?: string };

/** New inputs must not reuse a still-present default name after removal. */
export function appendInterfaceInput(
  inputs: readonly SignatureInput[],
): SignatureInput[] {
  if (inputs.length >= 20) throw Error("Use at most 20 inputs.");
  const names = new Set(inputs.map((input) => input.name));
  let index = inputs.length + 1;
  while (names.has("input" + index)) index++;
  return [...inputs, { name: "input" + index, type: { kind: "unselected" } }];
}
/** Adding after a removal must not reuse a member name that is still present. */
export function appendDefinitionMember(
  value: Extract<InterfaceType, { kind: "record" | "choice" }>,
): Extract<InterfaceType, { kind: "record" | "choice" }> {
  const members = value.kind === "record" ? value.fields : value.variants;
  if (members.length >= 20)
    throw Error("Use at most 20 fields or outcomes in this form.");
  const names = new Set(members.map((member) => member.name));
  const prefix = value.kind === "record" ? "field" : "Outcome";
  let number = members.length + 1;
  while (names.has(prefix + number)) number++;
  return value.kind === "record"
    ? {
        ...value,
        fields: [
          ...value.fields,
          { name: prefix + number, type: { kind: "unselected" } },
        ],
      }
    : { ...value, variants: [...value.variants, { name: prefix + number }] };
}
const scalars = new Set(["Nat", "Int", "String", "Bool", "Unit"]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const name = (value: unknown, label: string) => {
  if (typeof value !== "string") throw Error(label + " needs a name.");
  const problem = identifierProblem(value);
  if (problem) throw Error(label + ": " + problem);
  return value;
};
/** Bound and validate authoring data before recursion; this is a source builder, not a second semantic engine. */
export function validateInterfaceType(
  value: unknown,
  options: { draft?: boolean; label?: string } = {},
): asserts value is InterfaceType {
  const typeName = (value: unknown, label: string) => {
    if (options.draft) {
      if (typeof value !== "string" || value.length > 120)
        throw Error(label + " must be text of at most 120 characters");
      return value;
    }
    return name(value, label);
  };
  const pending = [{ value, depth: 0, label: options.label ?? "This value" }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth, label } = pending.pop()!;
    if (++nodes > 128 || depth > 5)
      throw Error("Use at most five nested type levels and 128 type fields.");
    if (typeof value === "string" && scalars.has(value)) continue;
    if (!object(value)) throw Error("Choose a supported type shape.");
    const push = (value: unknown, nextLabel = label) =>
      pending.push({ value, depth: depth + 1, label: nextLabel });
    switch (value.kind) {
      case "unselected":
        if (!options.draft)
          throw Error(
            `${label}: choose what this value holds before previewing.`,
          );
        break;
      case "named":
        typeName(value.name, "Type reference");
        if (
          value.symbolId !== undefined &&
          (typeof value.symbolId !== "string" || value.symbolId.length > 8192)
        )
          throw Error("Invalid type identity.");
        break;
      case "list":
        push(value.element, label + " item");
        break;
      case "record": {
        typeName(value.name, "Record");
        if (
          !Array.isArray(value.fields) ||
          !value.fields.length ||
          value.fields.length > 20
        )
          throw Error("A record needs 1–20 fields.");
        const seen = new Set<string>();
        for (const field of value.fields) {
          if (!object(field)) throw Error("Invalid record field.");
          const key = typeName(field.name, "Field");
          if (!options.draft && seen.has(key))
            throw Error("Record fields need distinct names: " + key);
          seen.add(key);
          push(field.type, `Field “${field.name}” of “${value.name}”`);
        }
        break;
      }
      case "choice": {
        typeName(value.name, "Outcomes");
        if (
          !Array.isArray(value.variants) ||
          !value.variants.length ||
          value.variants.length > 20
        )
          throw Error("Choose 1–20 named outcomes.");
        const seen = new Set<string>();
        for (const variant of value.variants) {
          if (!object(variant)) throw Error("Invalid outcome.");
          const key = typeName(variant.name, "Outcome");
          if (!options.draft && seen.has(key))
            throw Error("Outcomes need distinct names: " + key);
          seen.add(key);
          if (variant.payload !== undefined)
            push(variant.payload, `Value carried by “${variant.name}”`);
        }
        break;
      }
      case "result":
        push(value.ok, label + " success");
        push(value.error, label + " error");
        break;
      default:
        throw Error("Choose a supported type shape.");
    }
  }
}
export interface InterfaceContext {
  file: string;
  types: {
    name: string;
    symbolId: string;
    file: string;
    kind: "record" | "choice";
  }[];
}
export function relativeImportPath(from: string, to: string) {
  const base = from.replaceAll("\\", "/").split("/");
  base.pop();
  const target = to.replaceAll("\\", "/").split("/");
  while (base.length && target.length && base[0] === target[0]) {
    base.shift();
    target.shift();
  }
  const path = [...base.map(() => ".."), ...target].join("/");
  return path.startsWith(".") ? path : "./" + path;
}
export function buildInterface(
  nameValue: string,
  inputs: { name: string; type: InterfaceType }[],
  output: InterfaceType,
  effects: { kind: string; target: string }[] = [],
  context?: InterfaceContext,
): string {
  const component = name(nameValue, "Component"),
    declarations = new Map<string, { type: InterfaceType; source: string }>(),
    references = new Set<string>(),
    imports = new Set<string>();
  if (inputs.length > 20) throw Error("Use at most 20 inputs.");
  for (const input of inputs) {
    name(input.name, "Input");
    validateInterfaceType(input.type, { label: `Input “${input.name}”` });
  }
  validateInterfaceType(output, { label: "Output" });
  if (new Set(inputs.map((i) => i.name)).size !== inputs.length)
    throw Error("Each input needs a different name.");
  const type = (input: InterfaceType): string =>
    interfaceTypeSource(input, (value) => {
      if (value.kind === "named") {
        const candidates =
          context?.types.filter(
            (t) =>
              t.name === value.name &&
              (!value.symbolId || t.symbolId === value.symbolId),
          ) ?? [];
        if (candidates.length > 1)
          throw Error("Choose which " + value.name + " type to use.");
        if (candidates.length === 1) {
          const target = candidates[0]!;
          if (target.file === context!.file)
            throw Error("Choose a new file for this component.");
          imports.add(relativeImportPath(context!.file, target.file));
        } else {
          if (value.symbolId)
            throw Error(
              "The selected type identity is not in this checked design.",
            );
          references.add(value.name);
        }
        return value.name;
      }
      if (context?.types.some((t) => t.name === value.name))
        throw Error(
          "Type " +
            value.name +
            " already exists. Choose Existing named type to reuse it.",
        );
      if (value.name === component)
        throw Error("Use a different name for the component and its type.");
      const previous = declarations.get(value.name);
      if (previous) {
        if (JSON.stringify(previous.type) !== JSON.stringify(value))
          throw Error("Two different types are called " + value.name + ".");
        return value.name;
      }
      declarations.set(value.name, { type: value, source: "" });
      const body =
        value.kind === "record"
          ? `{ ${value.fields.map((f) => `${f.name}: ${type(f.type)}`).join(", ")} }`
          : value.variants
              .map(
                (v) =>
                  v.name +
                  (v.payload === undefined ? "" : `(${type(v.payload)})`),
              )
              .join(" | ");
      declarations.get(value.name)!.source = `type ${value.name} = ${body};`;
      return value.name;
    });
  const parameters = inputs.map((i) => `${i.name}: ${type(i.type)}`).join(", "),
    result = type(output);
  for (const reference of references)
    if (!declarations.has(reference))
      throw Error(
        "Declare the referenced type " + reference + " in this interface.",
      );
  if (effects.length > 20) throw Error("Use at most 20 effects.");
  const effectNames = effects.map((effect) => {
    if (!["remote", "read", "write", "state", "io"].includes(effect.kind))
      throw Error("Choose a supported effect kind.");
    return effect.kind + "." + name(effect.target, "Effect target");
  });
  return `${[...imports]
    .sort()
    .map((path) => "import " + JSON.stringify(path) + ";\n")
    .join(
      "",
    )}// The caller supplies these values. The body is still an open design decision.\n${[...declarations.values()].map((d) => d.source).join("\n")}\nflow ${component}(${parameters}) -> ${result}${effectNames.length ? " effects(" + [...new Set(effectNames)].join(", ") + ")" : ""} {\n${result === "Unit" ? ' unknown "What should this component do?";' : ' return unknown "What result should this component return?";'}\n}\n`;
}
