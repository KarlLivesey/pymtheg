// SPDX-License-Identifier: MIT
import { z } from "zod";
import { machineDefinitionSchema } from "./machine-data.js";
import { readSignatureEdit, type SignatureEdit } from "./interface-data.js";
import {
  validateInterfaceType,
  type InterfaceType,
} from "./interface-builder.js";
export const declarationKinds = [
  "component",
  "operation",
  "type",
  "resource",
  "machine",
] as const;
export const declarationInfo = {
  component: {
    label: "Component",
    description: "Inputs, output and steps to decide.",
    guidance:
      "Name this part of the program. Add the values it receives and choose what it returns. Its steps stay an open question until you design them.",
  },
  operation: {
    label: "External operation",
    description: "Work another service or adapter performs.",
    guidance:
      "Describe a call to another service or adapter without implementing it. Add the effects and costs you know; omitted costs stay unknown. Mark a call as atomic only if it acts as one indivisible step.",
  },
  type: {
    label: "Data shape",
    description: "Fields or possible outcomes passed between parts.",
    guidance:
      "Group related fields into a record, or list the possible outcomes. Fields can contain lists and other data shapes, including types already in your project.",
  },
  resource: {
    label: "Resource lifecycle",
    description: "States and the cleanup every exit needs.",
    guidance:
      "Name the states, choose the starting state, and mark which states mean cleanup is complete. Add the allowed moves between states. The program must still reach cleanup on every exit.",
  },
  machine: {
    label: "Event model",
    description: "Events, changing values and safety rules.",
    guidance:
      "Describe values that can change, the events that change them, and safety rules that must always hold. Set a finite range for each number. Blank expressions stay open questions; without a safety rule, there is no rule to check.",
  },
} as const;
const text = z.string().max(120);
const signature = z.custom<SignatureEdit>((value) => {
  try {
    readSignatureEdit(value, true);
    return true;
  } catch {
    return false;
  }
}, "Invalid declaration inputs and output");
const definition = z.custom<InterfaceType>((value) => {
  try {
    validateInterfaceType(value, { draft: true });
    return (
      typeof value !== "string" &&
      value !== null &&
      ["record", "choice"].includes(
        (value as InterfaceType & { kind: string }).kind,
      )
    );
  } catch {
    return false;
  }
}, "Choose a record or outcome definition");
export const resourceDefinitionSchema = z
  .object({
    kind: z.literal("resource"),
    name: text,
    states: z.array(text).min(1).max(40),
    initial: text,
    terminal: z.array(text).max(40),
    transitions: z.array(z.object({ from: text, to: text }).strict()).max(80),
  })
  .strict();
export type ResourceDefinition = z.infer<typeof resourceDefinitionSchema>;
export const resourceDescriptionSchema = z.object({
  schema: z.literal("pymtheg.resource-definition/v1"),
  symbolId: z.string(),
  file: z.string(),
  name: z.string(),
  snapshotId: z.string(),
  sourceHash: z.string(),
  declarationHash: z.string(),
  definition: resourceDefinitionSchema.nullable(),
  unsupported: z.string().nullable(),
});
export type ResourceDescription = z.infer<typeof resourceDescriptionSchema>;
export const declarationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("component"), signature }).strict(),
  z
    .object({
      kind: z.literal("operation"),
      signature,
      atomic: z.boolean().default(false),
      requires: z.array(z.string().max(1000)).max(20).optional(),
      ensures: z.array(z.string().max(1000)).max(20).optional(),
      costs: z
        .array(
          z
            .object({
              metric: text,
              count: z.string().max(30),
              quality: z.enum(["exact", "upper"]),
            })
            .strict(),
        )
        .max(20)
        .default([]),
    })
    .strict(),
  z.object({ kind: z.literal("type"), definition }).strict(),
  resourceDefinitionSchema,
  machineDefinitionSchema,
]);
export type NewDeclaration = z.infer<typeof declarationSchema>;
export const declarationTypeSelectionSchema = z
  .object({
    symbolId: z.string().min(1).max(8192),
    file: z.string().min(1).max(4096),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().max(120).optional(),
    kind: z.enum(["record", "choice", "resource"]).optional(),
  })
  .strict();
export const declarationTypeSelectionsSchema = z
  .array(declarationTypeSelectionSchema)
  .max(128);
export type DeclarationTypeSelection = z.infer<
  typeof declarationTypeSelectionSchema
>;
export const declarationDraftSchema = z
  .object({
    file: z.string().min(1).max(4096),
    declaration: declarationSchema,
    typeSelections: declarationTypeSelectionsSchema.optional(),
    resourceEdit: z
      .object({
        name: text,
        baseline: resourceDefinitionSchema,
        declarationHash: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.resourceEdit ||
      (value.declaration.kind === "resource" &&
        value.declaration.name === value.resourceEdit.name &&
        value.resourceEdit.baseline.name === value.resourceEdit.name),
    "A lifecycle edit must retain its original resource identity.",
  );
export type DeclarationDraft = z.infer<typeof declarationDraftSchema>;
export function initialDeclaration(
  kind: NewDeclaration["kind"],
): NewDeclaration {
  if (kind === "machine")
    return {
      kind,
      name: "Events",
      states: [
        { name: "count", type: "Nat", min: "0", max: "3", initial: "0" },
      ],
      events: [],
      invariants: [],
    };
  if (kind === "resource")
    return {
      kind,
      name: "File",
      states: ["Open", "Closed"],
      initial: "Open",
      terminal: ["Closed"],
      transitions: [{ from: "Open", to: "Closed" }],
    };
  if (kind === "type")
    return {
      kind,
      definition: {
        kind: "record",
        name: "Request",
        fields: [{ name: "id", type: "String" }],
      },
    };
  const signature = {
    name: kind === "operation" ? "send" : "process",
    inputs: [],
    output: "Unit" as const,
    effects: [],
  };
  return kind === "operation"
    ? { kind, signature, costs: [], atomic: false, requires: [], ensures: [] }
    : { kind, signature };
}

/** The same unapproved starting form is used by Studio and agent callers. */
export function declarationTemplate(kind: NewDeclaration["kind"]) {
  return {
    schema: "pymtheg.declaration-template/v1" as const,
    ...declarationInfo[kind],
    edit: initialDeclaration(kind),
    nextStep:
      "Replace example names and values, then call design_interface create with this edit, the current file, runId and sourceHash. Preview does not save source. Check the returned buffer to inspect findings.",
  };
}
