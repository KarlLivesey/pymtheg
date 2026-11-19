// SPDX-License-Identifier: MIT
import { consumingBuiltins, formatStandardMacros } from "./macro-rules.js";
import type { GraphLink, GraphSymbol } from "../../types.js";

export type MacroScopeBlocker = {
  kind:
    | "derive"
    | "attribute"
    | "external-item"
    | "local-item"
    | "block"
    | "other";
  name: string;
  construct?: string;
  definition?: GraphSymbol;
};

export type MacroScopeAudit = {
  includes(link: GraphLink): boolean;
  blocked(link: GraphLink, blockers: readonly MacroScopeBlocker[]): void;
};

export const macroScopeAssumption = "rust-external-macro-name";
export const macroScopeAssumptionText =
  "External function-like macros must receive an item-name identifier. We assume external expansions introduce only names present in their input or, for derives and attributes, names built from whole case-insensitive components of input item names.";

export type MacroScopeMode = "baseline" | "proven" | "assumed";

export type MacroScopeEffect = {
  /** Names this invocation can introduce in the surrounding scope. */
  names: ReadonlySet<string>;
  /** Delimited case-folded component sequences of input item names. */
  derivedNames?: ReadonlySet<string>;
  /** The bound depends on the contract for an uncaptured macro's output. */
  assumed?: true;
  /** First segments that must still denote the macros inspected here. */
  lookups?: ReadonlySet<string>;
};

export function identifierComponents(name: string): string {
  const separated = name
    .replace(/([\p{Lu}])([\p{Lu}][\p{Ll}])/gu, "$1_$2")
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, "$1_$2")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .join("_");
  return separated ? `_${separated}_` : "";
}

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
  "error-chain",
  "paste",
  "pastey",
  "seq-macro",
  "slint",
  "tonic",
  "uniffi",
  "wit-bindgen",
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
