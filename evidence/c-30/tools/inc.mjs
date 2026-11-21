// SPDX-License-Identifier: MIT
// For links with a reason, group their files by the file-level
// limitations/notes the graph recorded. Usage: node inc.mjs RESULTS SCRATCH PIN REASON
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [results, scratch, pin, reason] = process.argv.slice(2);
const repo = JSON.parse(readFileSync(results, "utf8")).repos.find((r) => r.id === pin);
const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const perFile = new Map();
for (const { file } of db.prepare("SELECT file FROM graph_links WHERE module='typescript' AND json_extract(body,'$.data.reason')=?").iterate(reason))
  perFile.set(file, (perFile.get(file) ?? 0) + 1);
const groups = new Map();
const getFile = db.prepare("SELECT body FROM graph_files WHERE path=?");
for (const [file, n] of perFile) {
  const body = JSON.parse(getFile.get(file).body);
  const d = body.data ?? body.facts ?? {};
  const notes = (JSON.parse(getFile.get(file).body).result?.diagnostics ?? []).map((x) => x.message.replace(/^\S+ extends "[^"]*"/, "X extends Y").replace(/^TypeScript config \S+/, "TypeScript config X"));
  const key = JSON.stringify(notes).slice(0, 300);
  const g = groups.get(key) ?? { links: 0, files: 0, example: file };
  g.links += n; g.files++;
  groups.set(key, g);
}
for (const [k, v] of [...groups].sort((a, b) => b[1].links - a[1].links).slice(0, 10)) console.log(v.links, v.files, v.example, k);
