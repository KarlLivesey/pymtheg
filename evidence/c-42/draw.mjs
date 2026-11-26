// SPDX-License-Identifier: MIT
// C-42 audit draw: N merged environment globals at a fixed seed, with the
// source line and every declaring unit and symbol, for reading against the
// pinned source.
// Usage: node draw.mjs SCRATCH HEAD.json MERGED.jsonl N SEED > audit.jsonl
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, headPath, mergedPath, n, seed] = process.argv.slice(2);
const runs = new Map(JSON.parse(readFileSync(headPath, "utf8")).repos.map((repo) => [repo.id, repo]));
const rank = (row) => createHash("sha256").update(`${seed}\0${row.pin}\0${row.file}\0${row.kind}\0${row.start}\0${row.name}`).digest("hex");
const rows = readFileSync(mergedPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  .map((row) => ({ ...row, rank: rank(row) })).sort((a, b) => (a.rank < b.rank ? -1 : 1)).slice(0, Number(n));
for (const row of rows) {
  const checkout = join(scratch, runs.get(row.pin).attempt, "checkout");
  const db = new DatabaseSync(join(checkout, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const link = db.prepare(`SELECT id FROM graph_links WHERE file=? AND module='typescript' AND json_extract(body,'$.range.start')=?
    AND json_extract(body,'$.targetName')=? AND json_extract(body,'$.kind')=?`).get(row.file, row.start, row.name, row.kind);
  const declarations = db.prepare("SELECT ecosystem, unit, symbol FROM graph_library_targets WHERE link=? AND role='candidate' ORDER BY ecosystem, unit")
    .all(link.id).map(({ ecosystem, unit, symbol }) => `${ecosystem}:${unit}:${symbol}`);
  db.close();
  const text = readFileSync(join(checkout, row.file), "utf8");
  const line = text.slice(0, row.start).split("\n").length;
  const source = text.split("\n")[line - 1].trim().slice(0, 160);
  console.log(JSON.stringify({ rank: row.rank.slice(0, 16), pin: row.pin, file: row.file, line, kind: row.kind, name: row.name, declarations, source }));
}
