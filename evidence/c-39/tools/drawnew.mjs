// SPDX-License-Identifier: MIT
// Fixed-seed draw of newly Level 2 links with their source line and owner.
// Usage: node drawnew.mjs NEW.jsonl RESULTS.json SWEEP_SCRATCH N SEED
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const [path, results, scratch, n, seed] = process.argv.slice(2);
const repos = new Map(JSON.parse(readFileSync(results, "utf8")).repos.map((r) => [r.id, r]));
const rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rank = (r) => createHash("sha256").update(`${seed}\0${r.pin}\0${r.file}\0${r.kind}\0${r.start}\0${r.name}`).digest("hex");
rows.sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
for (const r of rows.slice(0, Number(n))) {
  const root = join(scratch, repos.get(r.pin).attempt, "checkout");
  const text = readFileSync(join(root, r.file), "utf8");
  const line = text.slice(0, r.start).split("\n").length;
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const owner = JSON.parse(db.prepare("SELECT body FROM graph_files WHERE path=?").get(r.file).body).result.data;
  db.close();
  console.log(JSON.stringify({
    rank: rank(r).slice(0, 16), pin: r.pin, file: r.file, line, kind: r.kind, name: r.name,
    target: r.target, before: r.before.reason ?? r.before.resolution,
    owner: owner.project ?? owner.projects, source: text.split("\n")[line - 1].trim().slice(0, 160),
  }));
}
