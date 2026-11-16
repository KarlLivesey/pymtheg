// SPDX-License-Identifier: MIT
import { sourceFileName } from "../shared/identity-values.js";
import { parse } from "../language/parser.js";

/** Check field boundaries only; the canonical checker still owns its meaning. */
export function authoringExpression(
  value: string,
  label: string,
  example = "count + 1 or count < 3",
): string {
  if (!value.trim())
    return `unknown ${JSON.stringify(label + " is not decided")}`;
  const parsed = parse(
    sourceFileName("expression"),
    `rule field() -> Bool = ${value};`,
  );
  if (
    parsed.diagnostics.length ||
    parsed.declarations.length !== 1 ||
    parsed.declarations[0]?.kind !== "rule"
  )
    throw Error(
      `${label}: enter one expression, such as ${example}. ${parsed.diagnostics[0]?.message ?? "Extra declarations are not allowed in a field."}`,
    );
  return value;
}
