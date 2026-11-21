// index-summary.mjs REPORT DB : the headline of a `graph index --json`
// report (complete, counts, failed files by reason) and, from its store,
// TypeScript link outcomes and reasons (top 12).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [reportPath, dbPath] = process.argv.slice(2);
const text = readFileSync(reportPath, "utf8");
const report = JSON.parse(text.slice(text.indexOf("{")));
const index = report.index ?? report;
console.log(JSON.stringify({ complete: index.complete, counts: report.counts ?? index.counts }));
const reasons = new Map();
for (const failed of report.failedFiles ?? []) {
  const reason = failed.reason.replace(/line \d+, column \d+/, "line L, column C").slice(0, 110);
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}
for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(n, reason);
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db
  .prepare(
    "SELECT json_extract(body,'$.resolution') AS r, json_extract(body,'$.data.reason') AS why, count(*) AS n FROM graph_links WHERE module='typescript' AND json_extract(body,'$.kind')<>'contains' GROUP BY r, why ORDER BY n DESC LIMIT 12",
  )
  .all();
for (const row of rows) console.log(row.n, row.r, row.why ?? "");
