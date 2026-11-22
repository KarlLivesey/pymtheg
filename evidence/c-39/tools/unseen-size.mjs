// SPDX-License-Identifier: MIT
// C-39 item 4 sizing: links below Level 2 in files whose program contained a
// failed file. A file counts when any of its links carries the
// `no-unseen-declarations` assumption (stamped per link by the module on
// every non-exempt link of such a program). Grouped by first stored reason.
// Usage: node unseen-size.mjs RUN.json (run from a sweep tree root)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedLibraryIdentity } from "../../../scripts/sweep/coverage-rules.mjs";
import { firstBlocker, storedReasons } from "../../../scripts/sweep/coverage-refresh-data.mjs";
const [runPath] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const out = {};
for (const repo of run.repos) {
  if (repo.outcome !== "finished") continue;
  const db = new DatabaseSync(join(dirname(runPath), repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const marked = new Set(db.prepare(`SELECT DISTINCT file FROM graph_links WHERE module='typescript'
    AND json_extract(body,'$.data.assumes') LIKE '%no-unseen-declarations%'`).all().map((r) => r.file));
  for (const row of db.prepare(`SELECT l.file,l.resolution,l.body,t.unit,t.symbol,t.evidence FROM graph_links l
    LEFT JOIN graph_library_targets t ON l.resolution='library' AND t.link=l.id AND t.role='target' WHERE l.module='typescript'`).iterate()) {
    if (!marked.has(row.file)) continue;
    const library = row.resolution === "library" ? storedLibraryIdentity({ file: row.file, resolution: row.resolution, library: row }) : null;
    if (row.resolution === "resolved" || library?.level === 2) continue;
    const reason = firstBlocker(storedReasons(JSON.parse(row.body).data ?? {}), row.resolution);
    out[reason] ??= { links: 0, pins: {} };
    out[reason].links++;
    out[reason].pins[repo.id] = (out[reason].pins[repo.id] ?? 0) + 1;
  }
  db.close();
}
for (const [k, v] of Object.entries(out).sort((a, b) => b[1].links - a[1].links))
  console.log(v.links, k, JSON.stringify(Object.entries(v.pins).sort((a, b) => b[1] - a[1]).slice(0, 6)));
