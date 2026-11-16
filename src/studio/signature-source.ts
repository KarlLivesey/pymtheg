// SPDX-License-Identifier: MIT
import { identifierProblem } from "../shared/names.js";
import type { InterfaceType } from "./interface-builder.js";
import type { SignatureEdit } from "./interface-data.js";
export function checkSourceName(value: string, label: string): void {
  const problem = identifierProblem(value);
  if (problem) throw Error(label + ": " + problem);
}
export function signatureParts(
  edit: SignatureEdit,
  type: (value: InterfaceType) => string,
) {
  checkSourceName(edit.name, "Component");
  if (edit.inputs.length > 20 || edit.effects.length > 20)
    throw Error(
      "Use at most 20 inputs and 20 effects in the interface editor.",
    );
  const seen = new Set<string>();
  const parameters = edit.inputs
    .map((p) => {
      checkSourceName(p.name, "Input");
      if (seen.has(p.name)) throw Error("Each input needs a different name.");
      seen.add(p.name);
      if (p.mode && !["value", "take", "borrow"].includes(p.mode))
        throw Error("Unsupported parameter passing mode.");
      return `${p.mode && p.mode !== "value" ? p.mode + " " : ""}${p.name}: ${type(p.type)}`;
    })
    .join(", ");
  const output = type(edit.output);
  const effects = [
    ...new Set(
      edit.effects.map((e) => {
        if (!["read", "write", "remote", "io", "state"].includes(e.kind))
          throw Error("Choose a supported effect kind.");
        checkSourceName(e.target, "Effect target");
        return e.kind + "." + e.target;
      }),
    ),
  ];
  return { parameters, output, effects };
}
