// SPDX-License-Identifier: MIT
// SW-6: per-pin installed TypeScript Level 2 from two refresh archives
// (before, after). A pin whose installed attempt did not finish counts its
// bare receipt, as the plan does. Usage:
//   node evidence/sw-6/pintable.mjs BEFORE.json.gz AFTER.json.gz
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const load = (path) => JSON.parse(gunzipSync(readFileSync(path)));
const [before, after] = process.argv.slice(2).map(load);
const pins = JSON.parse(readFileSync("sweep/repos.json", "utf8")).filter((p) => p.language === "typescript");
const row = (data, id) => {
  const installed = data.modes.installed.repos.find((r) => r.id === id);
  const usable = installed?.counts && installed.install?.status === "installed";
  const repo = usable ? installed : data.modes.bare.repos.find((r) => r.id === id);
  return { counts: repo?.counts?.typescript ?? { links: 0, level2: 0, assumed: 0 }, usable, installed };
};
const pct = (n, d) => (d ? `${(100 * n / d).toFixed(2)}%` : "—");
const fmt = (n) => n.toLocaleString("en-GB");
const sum = { a: { links: 0, level2: 0, assumed: 0 }, b: { links: 0, level2: 0, assumed: 0 } };
let contributing = 0;
console.log("| Pin | Installed attempt | Links | Level 2 SW-5 → SW-6 | Proven SW-6 | Assumption-marked SW-6 |");
console.log("| --- | --- | ---: | ---: | ---: | ---: |");
for (const { id } of pins) {
  const a = row(before, id), b = row(after, id);
  for (const k of Object.keys(sum.a)) { sum.a[k] += a.counts[k]; sum.b[k] += b.counts[k]; }
  if (b.counts.links) contributing++;
  const attempt = b.usable ? "finished" : `${b.installed?.outcome ?? "none"} (bare receipt)`;
  console.log(`| ${id} | ${attempt} | ${fmt(b.counts.links)} | ${pct(a.counts.level2, a.counts.links)} → ${pct(b.counts.level2, b.counts.links)} | ${pct(b.counts.level2 - b.counts.assumed, b.counts.links)} | ${pct(b.counts.assumed, b.counts.links)} |`);
}
console.log(`| **All 20** | ${contributing} contribute links | ${fmt(sum.b.links)} | ${pct(sum.a.level2, sum.a.links)} → ${pct(sum.b.level2, sum.b.links)} | ${pct(sum.b.level2 - sum.b.assumed, sum.b.links)} | ${pct(sum.b.assumed, sum.b.links)} |`);
console.log(`\nSW-6 totals: links ${sum.b.links}, level2 ${sum.b.level2}, assumed ${sum.b.assumed}; to 90%: ${Math.ceil(0.9 * sum.b.links - sum.b.level2)}`);
