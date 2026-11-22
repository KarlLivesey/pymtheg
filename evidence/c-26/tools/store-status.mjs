// store-status.mjs DB [PATH] : file counts by status and by first
// diagnostic (top 8) of a graph store, and PATH's status if given.
import { DatabaseSync } from "node:sqlite";
const [file, path] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
console.log(JSON.stringify(db.prepare("SELECT status, count(*) AS n FROM graph_files GROUP BY status").all()));
const reasons = new Map();
for (const row of db.prepare("SELECT body FROM graph_files WHERE status='failed'").iterate()) {
  const message = (JSON.parse(row.body).result.diagnostics[0]?.message ?? "").slice(0, 100);
  reasons.set(message, (reasons.get(message) ?? 0) + 1);
}
for (const [message, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(n, message);
if (path) {
  const row = db.prepare("SELECT status, body FROM graph_files WHERE path=?").get(path);
  console.log(path, row ? row.status + " " + JSON.stringify(JSON.parse(row.body).result.diagnostics[0] ?? null).slice(0, 300) : "absent");
}
