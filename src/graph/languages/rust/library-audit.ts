// SPDX-License-Identifier: MIT
import type { GraphLink } from "../../types.js";

export type LibraryBlocker =
  | "opaque scope"
  | "competing import or glob"
  | "Cargo edge uncertainty"
  | "unknown associated owner"
  | "other";
export type KnownMacro =
  | "standard"
  | "audited dependency"
  | "thiserror derive"
  | "workspace macro_rules";
export type BlockingMacro = {
  file: string;
  start: number;
  name: string;
  known?: KnownMacro;
};
export type WithheldLibrary = {
  unit: string;
  symbol: string;
  reason: LibraryBlocker;
  detail?: string;
  macros: BlockingMacro[];
};

/** Evidence-only replay over stored Rust facts. The probe never emits graph
 * decisions and uses its own lookup cache keys. */
export interface LibraryAudit {
  withheld: (
    link: GraphLink,
    before: WithheldLibrary | undefined,
    after: WithheldLibrary | undefined,
  ) => void;
}

export function libraryBlocker(reason: string): LibraryBlocker {
  if (
    reason.includes("opaque-item-may-shadow-name") ||
    reason.includes("item-under-opaque-attribute")
  )
    return "opaque scope";
  if (
    /competing|glob|namespace-binding|conditional-(?:name|binding)/.test(reason)
  )
    return "competing import or glob";
  if (/Cargo|dependency-|directory-source/.test(reason))
    return "Cargo edge uncertainty";
  if (reason.includes("associated-owner")) return "unknown associated owner";
  return "other";
}
