// SPDX-License-Identifier: MIT
import {
  validateInterfaceType,
  type InterfaceType,
} from "./interface-builder.js";
export type TypeDefinition = Extract<
  InterfaceType,
  { kind: "record" | "choice" }
>;
export interface TypeDraft {
  schema: "pymtheg.type-draft/v1";
  file: string;
  name: string;
  baseline: TypeDefinition;
  definition: TypeDefinition;
}
export function readTypeDraft(value: unknown): TypeDraft {
  if (!value || typeof value !== "object")
    throw Error("Invalid data-shape draft.");
  const data = value as Record<string, unknown>;
  if (
    data.schema !== "pymtheg.type-draft/v1" ||
    typeof data.file !== "string" ||
    !data.file ||
    data.file.length > 4096 ||
    data.file.startsWith("/") ||
    data.file.includes("\\") ||
    data.file.split("/").includes("..") ||
    typeof data.name !== "string"
  )
    throw Error("Invalid data-shape draft identity.");
  validateInterfaceType(data.baseline);
  validateInterfaceType(data.definition, { draft: true });
  for (const definition of [data.baseline, data.definition])
    if (
      typeof definition === "string" ||
      (definition.kind !== "record" && definition.kind !== "choice") ||
      definition.name !== data.name
    )
      throw Error("The draft must keep its original shared type name.");
  return data as unknown as TypeDraft;
}
export interface TypeConflict {
  key: string;
  label: string;
  saved: unknown;
  current: unknown;
}
/** Merge independent member edits; deletion versus modification requires a choice. */
export function mergeTypeDefinitions(
  baseline: TypeDefinition,
  saved: TypeDefinition,
  current: TypeDefinition,
  choices: Record<string, "saved" | "current"> = {},
) {
  const conflicts: TypeConflict[] = [];
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (same(saved, current) || same(baseline, current))
    return { definition: saved, conflicts, unresolved: [] };
  if (same(baseline, saved))
    return { definition: current, conflicts, unresolved: [] };
  function choose<T>(
    key: string,
    label: string,
    before: T,
    mine: T,
    theirs: T,
  ): T {
    if (same(mine, theirs)) return mine;
    if (same(mine, before)) return theirs;
    if (same(theirs, before)) return mine;
    conflicts.push({ key, label, saved: mine, current: theirs });
    return choices[key] === "saved" ? mine : theirs;
  }
  if (
    baseline.kind !== saved.kind ||
    baseline.kind !== current.kind ||
    saved.name !== current.name
  ) {
    const definition = choose(
      "definition",
      "Definition shape",
      baseline,
      saved,
      current,
    );
    return {
      definition,
      conflicts,
      unresolved: conflicts.filter((conflict) => !choices[conflict.key]),
    };
  }
  const before =
    baseline.kind === "record" ? baseline.fields : baseline.variants;
  const mine = saved.kind === "record" ? saved.fields : saved.variants;
  const theirs = current.kind === "record" ? current.fields : current.variants;
  if (new Set(mine.map((member) => member.name)).size !== mine.length) {
    const definition = choose(
      "definition",
      "Unfinished member names need review",
      baseline,
      saved,
      current,
    );
    return {
      definition,
      conflicts,
      unresolved: conflicts.filter((conflict) => !choices[conflict.key]),
    };
  }
  const order = choose(
    "order",
    "Member order",
    before.map((member) => member.name),
    mine.map((member) => member.name),
    theirs.map((member) => member.name),
  );
  // Additions on both sides are independent when the existing order is unchanged.
  const orderConflict = conflicts.find((conflict) => conflict.key === "order");
  const retained = (names: string[]) =>
    names.filter((name) => before.some((member) => member.name === name));
  if (
    orderConflict &&
    same(
      retained(mine.map((member) => member.name)),
      retained(theirs.map((member) => member.name)),
    )
  )
    conflicts.splice(conflicts.indexOf(orderConflict), 1);
  const names = [
    ...new Set([
      ...order,
      ...theirs.map((member) => member.name),
      ...mine.map((member) => member.name),
      ...before.map((member) => member.name),
    ]),
  ];
  const members = names.flatMap((name) => {
    const member = choose(
      "member:" + name,
      "Member “" + name + "”",
      before.find((member) => member.name === name),
      mine.find((member) => member.name === name),
      theirs.find((member) => member.name === name),
    );
    return member ? [member] : [];
  });
  const definition = (
    current.kind === "record"
      ? { ...current, fields: members }
      : { ...current, variants: members }
  ) as TypeDefinition;
  return {
    definition,
    conflicts,
    unresolved: conflicts.filter((conflict) => !choices[conflict.key]),
  };
}
