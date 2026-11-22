// SPDX-License-Identifier: MIT
// C-24: Markdown tables from union.mjs summaries.
// Usage: node tables.mjs FINAL.json ITEM1.json ITEM2.json ITEM3.json
//   FINAL: the merged branch against three main runs (both on current main);
//   ITEMn: each item's build against the build before it (pre-merge base).
import { readFileSync } from "node:fs";

const [final, ...items] = process.argv
  .slice(2)
  .map((path) => JSON.parse(readFileSync(path, "utf8")));
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(2) + "%" : "—");
const int = (n) => n.toLocaleString("en-GB");
const delta = (summary, id) => {
  const row = summary.pins.find((p) => p.id === id);
  if (!row || row.skipped) return "—";
  const d = row.candidateLevel2 - Math.max(...row.mainLevel2);
  return d ? (d > 0 ? "+" : "") + int(d) : "0";
};
const lines = [
  "| Pin | Rust sites | Main L2 (3 runs) | C-24 L2 | Like-for-like C-24 | Item 1 | Item 2 | Item 3 | Lost vs main | Main unstable sites |",
  "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
const total = { sites: 0, main: [0, 0, 0], cand: 0, lfl: 0, lflMain: 0 };
for (const row of final.pins) {
  if (row.skipped) continue;
  total.sites += row.candidateSites;
  row.mainLevel2.forEach((n, i) => (total.main[i] += n));
  total.cand += row.candidateLevel2;
  total.lfl += row.likeForLikeCandidateLevel2;
  total.lflMain += row.likeForLikeSites;
  const main = [...new Set(row.mainLevel2.map((n) => pct(n, row.mainSites[0])))];
  lines.push(
    `| ${row.id} | ${int(row.candidateSites)} | ${main.join(" / ")} | ${pct(row.candidateLevel2, row.candidateSites)} | ${pct(row.likeForLikeCandidateLevel2, row.likeForLikeSites)} | ${items.map((s) => delta(s, row.id)).join(" | ")} | ${row.lostStable.length} | ${row.mainUnstableSites} |`,
  );
}
lines.push(
  `| **Total** | **${int(total.sites)}** | **${[...new Set(total.main.map((n) => pct(n, total.sites)))].join(" / ")}** | **${pct(total.cand, total.sites)}** | **${pct(total.lfl, total.lflMain)}** | | | | | |`,
);
console.log(lines.join("\n"));
console.log(
  `\nLevel 2 numerators: main ${total.main.map(int).join(" / ")}, C-24 ${int(total.cand)}.`,
);
