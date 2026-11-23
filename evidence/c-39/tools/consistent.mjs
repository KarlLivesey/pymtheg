// SPDX-License-Identifier: MIT
// C-39: for every definite link whose target changed, check whether main's
// graph links the same spelled name and kind to the candidate's new target in
// a file whose program had no unread file (no link there carries
// `no-unseen-declarations`). Usage: node consistent.mjs SCRATCH MAIN.json CHANGED.jsonl
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, mainPath, changedPath] = process.argv.slice(2);
const runs = new Map(JSON.parse(readFileSync(mainPath, "utf8")).repos.map((r) => [r.id, r]));
const changed = readFileSync(changedPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const result = { consistent: 0, inconsistent: [] };
for (const [pin, rows] of Map.groupBy(changed, (r) => r.pin)) {
  const db = new DatabaseSync(join(scratch, runs.get(pin).attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const marked = new Set(db.prepare(`SELECT DISTINCT file FROM graph_links WHERE module='typescript'
    AND json_extract(body,'$.data.assumes') LIKE '%no-unseen-declarations%'`).all().map((r) => r.file));
  const libs = new Map();
  for (const r of db.prepare("SELECT link, ecosystem, unit, symbol FROM graph_library_targets").iterate()) {
    const list = libs.get(r.link) ?? [];
    list.push(`${r.ecosystem}:${r.unit}:${r.symbol ?? ""}`);
    libs.set(r.link, list);
  }
  const seen = new Set();
  for (const r of db.prepare("SELECT id, file, kind, json_extract(body,'$.targetName') AS name FROM graph_links WHERE module='typescript'").iterate()) {
    if (marked.has(r.file)) continue;
    const target = (libs.get(r.id) ?? []).sort().join(",");
    if (target) seen.add(`${r.kind}\0${r.name}\0${target}`);
  }
  db.close();
  for (const row of rows) {
    if (row.now && seen.has(`${row.kind}\0${row.name}\0${row.now.target}`)) result.consistent++;
    else result.inconsistent.push({ pin, file: row.file, start: row.start, kind: row.kind, name: row.name, before: row.target, now: row.now });
  }
}
console.log(JSON.stringify({ consistent: result.consistent, inconsistent: result.inconsistent.length, examples: result.inconsistent.slice(0, 15) }, null, 1));
