// sample.mjs SCRATCH SWEEP.json SHAPE-PREFIX N : up to N `local` links per
// pin whose diagnostic shape starts with SHAPE-PREFIX, with the site's line
// (a diagnosis aid; the excerpts stay on the dev server).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, sweepPath, prefix, n] = process.argv.slice(2);
const sweep = JSON.parse(readFileSync(sweepPath, "utf8"));
for (const repo of sweep.repos) {
  if (!repo.attempt || !["ok", "incomplete"].includes(repo.cold?.status)) continue;
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout", ".pymtheg", "rebuildable", "graph.sqlite"),
    { readOnly: true },
  );
  const rows = db
    .prepare(
      "SELECT l.file AS file, l.body AS body, f.body AS fileBody FROM graph_links l JOIN graph_files f ON f.path=l.file WHERE l.module='typescript' AND json_extract(l.body,'$.data.reason')='local' AND json_extract(l.body,'$.data.localShape') LIKE ? ORDER BY l.id LIMIT ?",
    )
    .all(`${prefix}%`, Number(n));
  for (const row of rows) {
    const link = JSON.parse(row.body);
    const text = JSON.parse(row.fileBody).text;
    const start = text.lastIndexOf("\n", link.range.start - 1) + 1;
    const end = text.indexOf("\n", link.range.start);
    const line = text.slice(0, link.range.start).split("\n").length;
    console.log(
      `${repo.id} ${row.file}:${line} ${link.kind} ${link.targetName} :: ${text.slice(start, end < 0 ? undefined : end).trim().slice(0, 140)}`,
    );
  }
  db.close();
}
