// Print TypeScript call links with their library targets and data.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const lib = db.prepare("SELECT role, ecosystem, unit, symbol, evidence FROM graph_library_targets WHERE link=?");
for (const r of db.prepare("SELECT id, kind, resolution, body FROM graph_links WHERE module='typescript' AND kind=?").all(process.argv[3] ?? "calls")) {
  const b = JSON.parse(r.body);
  console.log(b.targetName, r.resolution, JSON.stringify(lib.all(r.id)), JSON.stringify(b.data).slice(0, 300));
}
