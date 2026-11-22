// SPDX-License-Identifier: MIT
// SW-6: split installed TypeScript links below Level 2, for chosen first
// reasons, by whether the file's compiler program contained a failed file
// (the file result's `failedFiles` is non-empty). Under C-13's rules a failed
// file in the program withholds library targets elsewhere in that program.
// Usage (from the sweep tree): node evidence/sw-6/extsplit.mjs RUN.json REASON...
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedLibraryIdentity } from "../../scripts/sweep/coverage-rules.mjs";
import { firstBlocker, storedReasons } from "../../scripts/sweep/coverage-refresh-data.mjs";

const [runPath, ...reasons] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const out = {};
for (const repo of run.repos) {
  if (repo.outcome !== "finished") continue;
  const db = new DatabaseSync(join(dirname(runPath), repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const failed = new Map();
  for (const { path, body } of db.prepare("SELECT path, body FROM graph_files WHERE json_extract(body,'$.module')='typescript'").iterate()) {
    const files = JSON.parse(body).result?.data?.failedFiles;
    failed.set(path, !!files && Object.keys(files).length > 0);
  }
  for (const row of db.prepare(`SELECT l.file,l.resolution,l.body,t.unit,t.symbol,t.evidence FROM graph_links l
    LEFT JOIN graph_library_targets t ON l.resolution='library' AND t.link=l.id AND t.role='target' WHERE l.module='typescript'`).iterate()) {
    const library = row.resolution === "library" ? storedLibraryIdentity({ file: row.file, resolution: row.resolution, library: row }) : null;
    if (row.resolution === "resolved" || library?.level === 2) continue;
    const reason = firstBlocker(storedReasons(JSON.parse(row.body).data ?? {}), row.resolution);
    if (!reasons.includes(reason)) continue;
    const key = `${reason} | ${failed.get(row.file) ? "program has a failed file" : "no failed file in program"}`;
    out[key] ??= { links: 0, pins: {} };
    out[key].links++;
    out[key].pins[repo.id] = (out[key].pins[repo.id] ?? 0) + 1;
  }
  db.close();
}
console.log(JSON.stringify(out, null, 1));
