import type { SignatureEdit } from "./interface-data.js";
export interface InterfaceConflictField {
  key: string;
  label: string;
  saved: unknown;
  current: unknown;
}
/** Three-way form merge. No conflicting saved edit is applied without an explicit choice. */
export function mergeInterfaceEdits(
  baseline: SignatureEdit | undefined,
  saved: SignatureEdit,
  current: SignatureEdit,
  choices: Record<string, "saved" | "current"> = {},
) {
  const conflicts: InterfaceConflictField[] = [];
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  function choose<T>(
    key: string,
    label: string,
    before: T,
    mine: T,
    theirs: T,
  ): T {
    if (same(mine, theirs)) return mine;
    if (baseline && same(mine, before)) return theirs;
    if (baseline && same(theirs, before)) return mine;
    conflicts.push({ key, label, saved: mine, current: theirs });
    return choices[key] === "saved" ? mine : theirs;
  }
  const inputs: SignatureEdit["inputs"] = [];
  const order = choose(
    "input-order",
    "Input order",
    baseline?.inputs.map((p) => p.name),
    saved.inputs.map((p) => p.name),
    current.inputs.map((p) => p.name),
  )!;
  const names = [
    ...new Set([
      ...order,
      ...current.inputs.map((p) => p.name),
      ...saved.inputs.map((p) => p.name),
      ...(baseline?.inputs.map((p) => p.name) ?? []),
    ]),
  ];
  for (const name of names) {
    const old = baseline?.inputs.find((p) => p.name === name),
      mine = saved.inputs.find((p) => p.name === name),
      theirs = current.inputs.find((p) => p.name === name);
    const value = choose(
      "input:" + name,
      "Input “" + name + "”",
      old,
      mine,
      theirs,
    );
    if (value) inputs.push(value);
  }
  const edit: SignatureEdit = {
    name: choose(
      "name",
      "Component name",
      baseline?.name,
      saved.name,
      current.name,
    )!,
    inputs,
    output: choose(
      "output",
      "Output",
      baseline?.output,
      saved.output,
      current.output,
    )!,
    effects: choose(
      "effects",
      "Effects",
      baseline?.effects,
      saved.effects,
      current.effects,
    )!,
  };
  if (saved.typeEdits?.length) {
    conflicts.push({
      key: "types",
      label: "Shared type edits need review against current definitions",
      saved: saved.typeEdits,
      current: undefined,
    });
    if (choices.types === "saved") edit.typeEdits = saved.typeEdits;
  }
  return {
    edit,
    conflicts,
    unresolved: conflicts.filter((c) => choices[c.key] === undefined),
  };
}
