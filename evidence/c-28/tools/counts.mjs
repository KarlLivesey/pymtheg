// SPDX-License-Identifier: MIT
// Per pin: TypeScript links, Level 2 and no-symbol counts for two runs.
// Usage: node counts.mjs SWEEP_SCRATCH BEFORE.json AFTER.json
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, ...receipts] = process.argv.slice(2);
const runs = receipts.map((p) => new Map(JSON.parse(readFileSync(p, "utf8")).repos.map((r) => [r.id, r])));
const count = (repo) => {
  if (!repo || repo.outcome !== "finished") return undefined;
  const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const one = (sql) => db.prepare(sql).get().n;
  const out = {
    links: one("SELECT count(*) AS n FROM graph_links WHERE module='typescript'"),
    level2: one(`SELECT count(*) AS n FROM graph_links AS l WHERE module='typescript' AND (resolution='resolved' OR (resolution='library' AND EXISTS (SELECT 1 FROM graph_library_targets AS t WHERE t.link=l.id AND t.symbol IS NOT NULL)))`),
    noSymbol: one("SELECT count(*) AS n FROM graph_links WHERE module='typescript' AND json_extract(body,'$.data.reason')='no-symbol'"),
  };
  db.close();
  return out;
};
const rows = [];
for (const pin of [...runs[0].keys()].sort()) {
  const [a, b] = runs.map((run) => count(run.get(pin)));
  if (!a || !b) continue;
  rows.push({ pin, before: a, after: b });
}
console.log(JSON.stringify(rows));
