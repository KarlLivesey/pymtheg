// SPDX-License-Identifier: MIT
// Library symbol names stored for links with a given target name, with owner.
// Usage: node libnames.mjs RESULTS SCRATCH PIN NAME UNIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [results, scratch, pin, name, unit] = process.argv.slice(2);
const repo = JSON.parse(readFileSync(results, "utf8")).repos.find((r) => r.id === pin);
const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const counts = new Map();
for (const r of db.prepare(`SELECT l.file, t.symbol, json_extract(f.body,'$.result.data.project') AS project
  FROM graph_links l JOIN graph_library_targets t ON t.link=l.id JOIN graph_files f ON f.path=l.file
  WHERE json_extract(l.body,'$.targetName')=? AND t.unit=?`).iterate(name, unit)) {
  const k = `${r.symbol} | ${r.project} | ${r.file.split("/").slice(0, 4).join("/")}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(v, k);
