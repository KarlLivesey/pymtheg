// SPDX-License-Identifier: MIT
import type { InterfaceType } from "./interface-builder.js";
/** Shared type spelling for new-interface generation and edits to checked interfaces. */
export function interfaceTypeSource(
  value: InterfaceType,
  named: (
    value: Extract<InterfaceType, { kind: "named" | "record" | "choice" }>,
  ) => string,
): string {
  if (typeof value === "string") return value;
  if (value.kind === "unselected")
    throw Error("Choose what this value holds before generating source.");
  if (value.kind === "list")
    return `List<${interfaceTypeSource(value.element, named)}>`;
  if (value.kind === "result") {
    if (
      typeof value.error === "string" ||
      !["choice", "named"].includes(value.error.kind)
    )
      throw Error("Result errors need named outcome cases.");
    if (
      value.error.kind === "choice" &&
      value.error.variants.some((v) => v.name === "Ok")
    )
      throw Error("Ok is the success case; use another name for an error.");
    return `Result<${interfaceTypeSource(value.ok, named)}, ${interfaceTypeSource(value.error, named)}>`;
  }
  return named(value);
}
