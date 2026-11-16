// SPDX-License-Identifier: MIT
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
/** Names only: legacy data is never opened, migrated, followed or removed. */
const legacyNames = [
  ".pymtheg.json",
  ".pymtheg-architecture",
  ".pymtheg-studio",
  ".pymtheg-implementation-links.json",
  ".pymtheg-observed-code.json",
  ".pymtheg-heading-identities.json",
  ".pymtheg-source-contracts.json",
];
export function legacyNotice(root: string): string | null {
  const found = legacyNames.filter((name) => {
    try {
      lstatSync(resolve(root, name));
      return true;
    } catch {
      return false;
    } // An optional notice must never prevent a command.
  });
  return found.length
    ? `Unused legacy Pymtheg data, safe to delete: ${found.join(", ")}. Nothing was deleted.`
    : null;
}
export function printLegacyNotice(root: string): void {
  const notice = legacyNotice(root);
  if (notice) process.stderr.write(notice + "\n");
}
