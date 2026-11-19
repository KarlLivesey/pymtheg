// SPDX-License-Identifier: MIT
// Usage: node merge-coverage.mjs OUT IN1 IN2 ... (later inputs win per repository id)
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const [out, ...inputs] = process.argv.slice(2);
const read = (p) =>
  JSON.parse((p.endsWith(".gz") ? gunzipSync(readFileSync(p)) : readFileSync(p)).toString("utf8"));
let merged;
const repos = new Map();
for (const p of inputs) {
  const j = read(p);
  if (!merged) merged = { ...j };
  else if (JSON.stringify(j.columns) !== JSON.stringify(merged.columns))
    throw Error("column mismatch in " + p);
  for (const r of j.repos) repos.set(r.id, r);
}
merged.repos = [...repos.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
writeFileSync(out, JSON.stringify(merged) + "\n");
console.log(out, merged.repos.length);
