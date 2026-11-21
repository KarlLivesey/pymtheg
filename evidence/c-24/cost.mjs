// SPDX-License-Identifier: MIT
// C-24: cold-index CPU seconds and peak RSS per pin from sweep results that
// ran side by side in one session on the same storage (three main runs and
// the candidate), with the candidate against the mean and range of main.
// Usage: node cost.mjs CANDIDATE.json MAIN.json [MAIN.json ...]
import { readFileSync } from "node:fs";

const [candidate, ...mains] = process.argv
  .slice(2)
  .map((path) => JSON.parse(readFileSync(path, "utf8")));
const cold = (results, id) => results.repos.find((r) => r.id === id)?.cold;
const pct = (a, b) => ((100 * (a - b)) / b).toFixed(1) + "%";
const rows = [
  "| Pin | Main CPU s (3 runs) | C-24 CPU s | vs main mean | Main peak RSS MiB | C-24 peak RSS MiB | vs main mean |",
  "| --- | --- | ---: | ---: | --- | ---: | ---: |",
];
const sum = { main: 0, cand: 0, mainRss: 0, candRss: 0 };
for (const repo of candidate.repos) {
  const c = cold(candidate, repo.id);
  const m = mains.map((r) => cold(r, repo.id)).filter(Boolean);
  if (!c || m.length !== mains.length) continue;
  const cpu = m.map((x) => x.cpuSeconds);
  const rss = m.map((x) => x.peakRssKiB / 1024);
  const meanCpu = cpu.reduce((a, b) => a + b) / cpu.length;
  const meanRss = rss.reduce((a, b) => a + b) / rss.length;
  sum.main += meanCpu;
  sum.cand += c.cpuSeconds;
  sum.mainRss += meanRss;
  sum.candRss += c.peakRssKiB / 1024;
  rows.push(
    `| ${repo.id} | ${cpu.map((x) => x.toFixed(1)).join(" / ")} | ${c.cpuSeconds.toFixed(1)} | ${pct(c.cpuSeconds, meanCpu)} | ${rss.map((x) => x.toFixed(0)).join(" / ")} | ${(c.peakRssKiB / 1024).toFixed(0)} | ${pct(c.peakRssKiB / 1024, meanRss)} |`,
  );
}
rows.push(
  `| **All pins** | **${sum.main.toFixed(0)} (mean)** | **${sum.cand.toFixed(0)}** | **${pct(sum.cand, sum.main)}** | **${sum.mainRss.toFixed(0)} (sum of means)** | **${sum.candRss.toFixed(0)}** | **${pct(sum.candRss, sum.mainRss)}** |`,
);
console.log(rows.join("\n"));
