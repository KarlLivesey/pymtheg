// SPDX-License-Identifier: MIT
// C-35: a digest of every stored graph row (dump.mjs's canonical rows,
// SHA-256 per table and the row count), so two cold stores can be compared
// row for row after the stores themselves are deleted.
//   node scripts/store-cost/rows.mjs <graph.sqlite>
import { createHash } from "node:crypto";
import { storeRows } from "../reindex/dump.mjs";

const rows = storeRows(process.argv[2]);
const digest = {};
for (const [table, list] of Object.entries(rows)) {
  const hash = createHash("sha256");
  for (const row of list) hash.update(row + "\n");
  digest[table] = { rows: list.length, sha256: hash.digest("hex") };
}
console.log(JSON.stringify(digest, null, 1));
