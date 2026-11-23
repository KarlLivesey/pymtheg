// SPDX-License-Identifier: MIT
// C-39: list symbols and link sites present on main but not on the candidate
// for one pin (by file, kind, identity, key / by site key), grouped by file.
// Usage: node symdiff.mjs SCRATCH MAIN.json CAND.json PIN
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, a, b, pin] = process.argv.slice(2);
const open = (path) => {
  const repo = JSON.parse(readFileSync(path, "utf8")).repos.find((r) => r.id === pin);
  return new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
};
const symbols = (db) => new Set(db.prepare("SELECT file, body FROM graph_symbols").all()
  .map((r) => { const s = JSON.parse(r.body); return `${r.file}\0${s.kind}\0${s.identity}\0${s.key}`; }));
const sites = (db) => new Map(db.prepare("SELECT file, body FROM graph_links WHERE module='typescript'").all()
  .map((r) => { const l = JSON.parse(r.body); return [`${r.file}\0${l.kind}\0${l.range.start}\0${l.targetName}`, l]; }));
const [ma, cb] = [open(a), open(b)];
const sa = symbols(ma), sb = symbols(cb);
const lost = [...sa].filter((k) => !sb.has(k));
console.log("symbols only on main:", lost.length);
for (const k of lost.slice(0, 12)) console.log("  ", k.split("\0").join(" | "));
const la = sites(ma), lb = sites(cb);
const gone = [...la].filter(([k, l]) => !lb.has(k) && l.targetName !== "const");
const byFile = Map.groupBy(gone, ([k]) => k.split("\0")[0]);
console.log("sites only on main (not as const):", gone.length);
for (const [file, list] of [...byFile].slice(0, 12)) console.log("  ", file, list.length, list.slice(0, 2).map(([, l]) => `${l.kind}:${l.targetName}`).join(", "));
const file = (db, f) => { const r = db.prepare("SELECT body FROM graph_files WHERE path=?").get(f); return r ? JSON.parse(r.body).result : undefined; };
for (const f of [...byFile.keys()].slice(0, 3)) {
  const x = file(ma, f), y = file(cb, f);
  console.log(f, "main:", x?.status, x?.data?.project, "| cand:", y?.status, y?.data?.project, JSON.stringify(y?.diagnostics ?? []).slice(0, 200));
}
