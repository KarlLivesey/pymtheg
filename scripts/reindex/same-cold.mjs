// SPDX-License-Identifier: MIT
// C-22: a cold index of one tree by two builds, into stores with the same
// project id, must be identical row for row (the change alters no result).
//   node scripts/reindex/same-cold.mjs <dist a> <dist b> <root> <work dir> <out.json>
import "../isolated-home.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareRows, storeRows } from "./dump.mjs";

const [a, b, root, work, out] = process.argv.slice(2);
if (!out)
  throw Error(
    "usage: same-cold.mjs <dist a> <dist b> <root> <work dir> <out.json>",
  );
const here = new URL(".", import.meta.url).pathname;
mkdirSync(work, { recursive: true });
const stores = [a, b].map((dist, index) => {
  const graph = join(work, `cold-${index}.sqlite`);
  execFileSync(
    process.execPath,
    [join(here, "cold-once.mjs"), dist, root, graph, "c22-same-cold"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return graph;
});
const rowsA = storeRows(stores[0]);
const differences = compareRows(rowsA, storeRows(stores[1]));
const rows = Object.fromEntries(
  Object.entries(rowsA).map(([table, list]) => [table, list.length]),
);
writeFileSync(
  out,
  JSON.stringify(
    { root, rows, equal: !differences.length, differences },
    null,
    1,
  ),
);
console.log(
  `${root}: ${differences.length ? "DIFFERENT " + JSON.stringify(differences).slice(0, 1500) : "identical"} ${JSON.stringify(rows)}`,
);
