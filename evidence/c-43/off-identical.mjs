// SPDX-License-Identifier: MIT
// C-43: with the toolchain route off, a cold index with this branch stores
// the same rows as main. Each build indexes the pristine pin in a fresh
// process (scripts/reindex/cold-once.mjs, same project id); every row of
// every table is compared. The only allowed difference is the Rust module
// version (46 on main, 48 here), mapped before comparing.
//   node off-identical.mjs <out.json> <main dist> <branch dist> <store dir> <pin dir>...
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { compareRows, storeRows } from "../../scripts/reindex/dump.mjs";

const [out, mainDist, branchDist, storeDir, ...pins] = process.argv.slice(2);
const MAIN = "46";
const BRANCH = "48";
const mapVersion = (rows) =>
  Object.fromEntries(
    Object.entries(rows).map(([table, lines]) => [
      table,
      lines.map((line) => {
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          return line;
        }
        if (row && typeof row === "object") {
          if (row.module === "rust" && row.version === BRANCH) row.version = MAIN;
          if (typeof row.body === "string" && row.body.startsWith("{")) {
            const body = JSON.parse(row.body);
            if (body.module === "rust" && body.version === BRANCH) {
              body.version = MAIN;
              row.body = JSON.stringify(body);
            }
          }
        }
        return JSON.stringify(row);
      }),
    ]),
  );
const results = [];
for (const pin of pins) {
  const rows = {};
  for (const [label, dist] of [["main", mainDist], ["branch", branchDist]]) {
    const store = join(storeDir, `off-${label}-${process.pid}.sqlite`);
    const run = spawnSync(process.execPath, ["--max-old-space-size=65536", "scripts/reindex/cold-once.mjs", dist, pin, store, "c43-off"], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
    if (run.status !== 0) throw Error(`${basename(pin)} ${label}: ${run.stderr}`);
    rows[label] = mapVersion(storeRows(store));
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(store + suffix)) rmSync(store + suffix);
  }
  const differences = compareRows(rows.main, rows.branch);
  const counts = Object.fromEntries(Object.entries(rows.main).map(([table, lines]) => [table, lines.length]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  results.push({ pin: basename(pin), rows: total, tables: counts, differences });
  console.log(JSON.stringify({ pin: basename(pin), rows: total, identical: differences.length === 0 }));
  writeFileSync(out, JSON.stringify({ main: MAIN, branch: BRANCH, results }, null, 1));
}
