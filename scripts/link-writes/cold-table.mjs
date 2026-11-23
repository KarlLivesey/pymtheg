// SPDX-License-Identifier: MIT
// C-53: a Markdown table of cold indexes on disk, before → after, from the
// results scripts/store-cost/disk-batch.sh leaves (<out>/before/<label>.json
// and <out>/after/<label>.json): wall and CPU time, bytes this process
// wrote, the log's peak size, commits, the longest write-lock hold, peak
// memory, and the rows the store's statements changed (all, and links).
//   node scripts/link-writes/cold-table.mjs <out dir> <label>...
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [out, ...labels] = process.argv.slice(2);
const read = (side, label) =>
  JSON.parse(readFileSync(join(out, side, `${label}.json`), "utf8"));
const rows = (result, table) =>
  result.statements
    .filter((statement) =>
      table ? new RegExp(`\\b${table}\\b`).test(statement.sql) : true,
    )
    .reduce((sum, statement) => sum + statement.changes, 0);
const figures = (r) => ({
  wall: (r.wallMs / 1000).toFixed(1),
  cpu: (r.cpuMs / 1000).toFixed(1),
  written: (r.io.write_bytes / 2 ** 30).toFixed(2),
  log: Math.round(r.maxWalBytes / 2 ** 20),
  commits: r.commitTimes.length,
  hold: (r.longestHoldMs / 1000).toFixed(1),
  rss: Math.round(r.maxRssKiB / 1024),
  rows: rows(r),
  links: rows(r, "graph_links"),
});
const lines = [
  "| Pin | Wall s | CPU s | Written GiB | Log peak MiB | Commits | Longest hold s | Peak RSS MiB | Rows changed | Link rows changed |",
  "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
];
for (const label of labels) {
  const a = figures(read("before", label));
  const b = figures(read("after", label));
  const cell = (name) => `${a[name]} → ${b[name]}`;
  lines.push(
    `| ${label} | ${["wall", "cpu", "written", "log", "commits", "hold", "rss", "rows", "links"].map(cell).join(" | ")} |`,
  );
}
console.log(lines.join("\n"));
