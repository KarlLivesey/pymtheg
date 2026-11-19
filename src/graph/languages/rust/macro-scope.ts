// SPDX-License-Identifier: MIT
import { consumingBuiltins, formatStandardMacros } from "./macro-rules.js";

export const macroScopeAssumption = "rust-external-macro-name";

export type MacroScopeMode = "baseline" | "proven" | "assumed";

export type MacroScopeEffect = {
  /** Names this invocation can introduce in the surrounding scope. */
  names: ReadonlySet<string>;
  /** The bound depends on the contract for an uncaptured macro's output. */
  assumed?: true;
  /** First segments that must still denote the macros inspected here. */
  lookups?: ReadonlySet<string>;
};

export const isScopeNeutralMacro = (name: string): boolean =>
  formatStandardMacros.has(name) ||
  consumingBuiltins.has(name) ||
  name === "matches";

// These macros can construct identifiers or bring declarations from outside
// the input tokens. Keep the exclusion even through an explicit import alias.
const nameBuildingPackages = new Set([
  "automod",
  "concat-idents",
  "duplicate",
  "paste",
  "pastey",
  "seq-macro",
]);
const opaqueMacroNames = new Set([
  "concat_idents",
  "duplicate",
  "include",
  "macro_rules",
  "paste",
]);

export function canAssumeMacroScope(unit: string, symbol: string): boolean {
  return (
    !nameBuildingPackages.has(unit.replaceAll("_", "-")) &&
    !opaqueMacroNames.has(symbol.split("::").at(-1)!.replace(/!$/, ""))
  );
}
