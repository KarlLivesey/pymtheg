// SPDX-License-Identifier: MIT
// C-22 first equality case: a re-index with NO edit must leave the store
// identical to the cold store. In <root> (initialised, already a checkout,
// bare or with dependencies installed): a cold `graph index` (fresh process,
// as the CLI), a copy of its store, then `warmRuns` re-indexes, each compared
// row for row with the cold copy. A second cold index into a new store with
// the same project id shows whether cold itself reproduces.
//   node scripts/reindex/no-edit.mjs <dist> <root> <work dir> <out.json> [warm runs]
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareRows, storeRows } from "./dump.mjs";

const [distArg, root, work, out, runsArg] = process.argv.slice(2);
if (!out)
  throw Error(
    "usage: no-edit.mjs <dist> <root> <work dir> <out.json> [warm runs]",
  );
const dist = resolve(distArg);
const here = new URL(".", import.meta.url).pathname;
mkdirSync(work, { recursive: true });
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
if (!existsSync(join(root, ".pymtheg")))
  execFileSync(
    process.execPath,
    [
      join(dist, "cli/main.js"),
      "init",
      ".",
      "--name",
      "c22",
      "--format",
      "json",
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
if (existsSync(graph)) throw Error(`${graph} exists: start from no graph`);
const index = (name) => {
  execFileSync(
    process.execPath,
    [join(here, "index-once.mjs"), dist, root, join(work, `${name}.json`)],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
};
index("cold");
const cold = join(work, "cold.sqlite");
copyFileSync(graph, cold);
const coldRows = storeRows(cold);
const result = { root, warm: [], coldAgain: null };
for (let run = 1; run <= Number(runsArg ?? 1); run++) {
  index(`warm-${run}`);
  const differences = compareRows(storeRows(graph), coldRows, 20);
  result.warm.push({ run, equal: !differences.length, differences });
  console.log(
    `warm ${run}: ${differences.length ? "DIFFERENT " + JSON.stringify(differences.map((d) => [d.table, d.onlyIncremental, d.onlyCold])) : "equal to cold"}`,
  );
}
const again = join(work, "cold-again.sqlite");
execFileSync(
  process.execPath,
  [join(here, "cold-once.mjs"), dist, root, again, coldRows.project[0]],
  { stdio: ["ignore", "ignore", "inherit"] },
);
const differences = compareRows(storeRows(again), coldRows, 20);
result.coldAgain = { equal: !differences.length, differences };
console.log(
  `second cold: ${differences.length ? "DIFFERENT " + JSON.stringify(differences.map((d) => [d.table, d.onlyIncremental, d.onlyCold])) : "equal to cold"}`,
);
writeFileSync(out, JSON.stringify(result, null, 1));
