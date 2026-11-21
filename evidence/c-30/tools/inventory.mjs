// SPDX-License-Identifier: MIT
// Compact coverage archive in the SW-4 inventory shape: per build, mode and
// pin, TypeScript link and Level 2 counts and every below-Level-2
// [module, kind, outcome, reasons, links] combination.
// Usage: node inventory.mjs SWEEP_SCRATCH OUT.json label=RESULTS.json...
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, out, ...runs] = process.argv.slice(2);
const archive = { schema: "c30-inventory-v1", runs: {} };
for (const run of runs) {
  const [label, receipt] = run.split("=");
  const { release, mode, repos } = JSON.parse(readFileSync(receipt, "utf8"));
  const rows = [];
  for (const repo of repos) {
    if (repo.outcome !== "finished") {
      rows.push({ id: repo.id, commit: repo.commit, outcome: repo.outcome });
      continue;
    }
    const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
    const level2 = `(resolution='resolved' OR (resolution='library' AND EXISTS (SELECT 1 FROM graph_library_targets AS t WHERE t.link=l.id AND t.symbol IS NOT NULL)))`;
    const counts = db.prepare(`SELECT count(*) AS links, sum(${level2}) AS level2 FROM graph_links AS l WHERE module='typescript'`).get();
    const inventory = db
      .prepare(`SELECT kind, resolution AS outcome, coalesce(json_extract(body,'$.data.reason'),'') AS reason, count(*) AS n FROM graph_links AS l WHERE module='typescript' AND NOT ${level2} GROUP BY 1,2,3 ORDER BY 1,2,3`)
      .all()
      .map((r) => ["typescript", r.kind, r.outcome, r.reason ? [r.reason] : [], r.n]);
    db.close();
    rows.push({ id: repo.id, commit: repo.commit, outcome: "finished", counts: { typescript: { links: counts.links, level2: counts.level2 } }, inventory });
  }
  archive.runs[label] = { release, mode, repos: rows };
}
writeFileSync(out, JSON.stringify(archive) + "\n");
