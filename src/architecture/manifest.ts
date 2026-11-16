// SPDX-License-Identifier: MIT
import { compareText } from "../shared/order.js";
import { hash } from "../shared/identity.js";
import type { ArchitectureDocument } from "./schema.js";
export function documentSetHash(
  items: readonly { path: string; hash: string }[],
): string {
  return hash(
    JSON.stringify(
      [...items]
        .sort((a, b) => compareText(a.path, b.path))
        .map((d) => [d.path, d.hash]),
    ),
  );
}
/** v3 has a locale-independent content checksum, separate from retained legacy IDs. */
export function bundleContentMatches(bundle: {
  schema: string;
  contentHash?: string | undefined;
  index: { id: string; snapshotHash?: string | undefined };
  documents: ArchitectureDocument[];
}): boolean {
  const pairs = bundle.documents.map((d) => ({
    path: d.path,
    hash: hash(d.text),
  }));
  if (bundle.schema === "pymtheg.architecture-bundle/v3")
    return bundle.contentHash === documentSetHash(pairs);
  const recorded = bundle.index.snapshotHash ?? bundle.index.id;
  if (recorded === documentSetHash(pairs)) return true;
  // Existing v1/v2 bundles used the exporting host's collation. Preserve the old
  // originating-locale path; new exports always carry the explicit v3 checksum.
  return (
    recorded ===
    hash(
      JSON.stringify(
        pairs
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((d) => [d.path, d.hash]),
      ),
    )
  );
}
