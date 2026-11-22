// file-status.mjs SCRATCH RUN PATH : status and first diagnostic of PATH in
// the store of RUN's cold index (a sweep output in SCRATCH).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [scratch, run, path] = process.argv.slice(2);
const repo = JSON.parse(readFileSync(join(scratch, run), "utf8")).repos[0];
const db = new DatabaseSync(
  join(scratch, repo.attempt, "checkout", ".pymtheg", "rebuildable", "graph.sqlite"),
  { readOnly: true },
);
const row = db.prepare("SELECT status, body FROM graph_files WHERE path=?").get(path);
if (!row) console.log("absent");
else {
  const body = JSON.parse(row.body);
  console.log(row.status, body.version, JSON.stringify(body.result.diagnostics[0] ?? null).slice(0, 600));
  console.log("symbols", body.result.symbols.map((s) => s.key).join(" "));
}
