// SPDX-License-Identifier: MIT
// C-44: the full command path, settings included. For each pin, a fresh copy
// is indexed with `graph index` (executeGraph: loadConfig, the local trust
// answer, graphToolchains) by main and by this branch, and the stored rows
// are compared. The copies have no Pymtheg settings and no local answer, so
// both must run no toolchain and store the same rows.
//   node command-check.mjs <out.json> <main dist> <branch dist> <scratch> <pin dir>...
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareRows, storeRows } from "../../scripts/reindex/dump.mjs";

const [out, mainDist, branchDist, scratch, ...pins] = process.argv.slice(2);
const results = [];
for (const pin of pins) {
  const rows = {};
  const answers = {};
  for (const [label, dist] of [["main", mainDist], ["branch", branchDist]]) {
    const copy = join(scratch, `${basename(pin)}-${label}`);
    rmSync(copy, { recursive: true, force: true });
    mkdirSync(copy, { recursive: true });
    cpSync(pin, copy, { recursive: true, filter: (p) => !p.endsWith("/.git") });
    const { executeGraph } = await import(pathToFileURL(resolve(dist, "graph/commands.js")).href);
    const response = await executeGraph({ command: "index", root: copy });
    answers[label] = { status: response.status, toolchain: response.toolchain ?? null, trust: response.trust ?? null };
    rows[label] = storeRows(join(copy, ".pymtheg/rebuildable/graph.sqlite"));
    rmSync(copy, { recursive: true, force: true });
  }
  // Project ids are random per copy; compare everything else.
  delete rows.main.project;
  delete rows.branch.project;
  const strip = (r) => Object.fromEntries(Object.entries(r).map(([t, lines]) => [t, lines.map((l) => l.replace(/"(symbol|link|file):[^"]*"/g, '"$1:id"'))]));
  const differences = compareRows(strip(rows.main), strip(rows.branch));
  results.push({ pin: basename(pin), answers, rows: Object.values(rows.main).reduce((n, l) => n + l.length, 0), differences });
  console.log(JSON.stringify({ pin: basename(pin), answers, identical: differences.length === 0 }));
}
writeFileSync(out, JSON.stringify(results, null, 1));
