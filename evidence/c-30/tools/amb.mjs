// SPDX-License-Identifier: MIT
// Group a pin's TypeScript links with a project-choice reason by the tied
// configs, the per-config reasons and whether the variants' targets agree.
// Usage: node amb.mjs RESULTS.json SWEEP_SCRATCH PIN [REASON]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [results, scratch, pin, reason = "ambiguous-project"] = process.argv.slice(2);
const repo = JSON.parse(readFileSync(results, "utf8")).repos.find((r) => r.id === pin);
const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const groups = new Map();
const files = new Map();
let n = 0;
for (const { body, file } of db.prepare("SELECT body, file FROM graph_links WHERE module='typescript' AND json_extract(body,'$.data.reason')=?").iterate(reason)) {
  const link = JSON.parse(body);
  const d = link.data;
  n++;
  const per = Object.entries(d.byProject ?? {}).map(([p, v]) => `${p}=${v.reason ?? (v.targets ? "T" : v.libraryFacts ? "L" : "?")}`);
  const key = JSON.stringify([d.projects, d.tiedReasons, d.targets ? "targets" : "", d.libraryFacts ? "lib" : "", per.sort()]);
  groups.set(key, (groups.get(key) ?? 0) + 1);
  const dir = file.split("/").slice(0, 3).join("/");
  files.set(dir, (files.get(dir) ?? 0) + 1);
}
console.log("links", n);
for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v, k);
console.log([...files].sort((a, b) => b[1] - a[1]).slice(0, 15));
