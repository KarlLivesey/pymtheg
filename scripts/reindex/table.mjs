// SPDX-License-Identifier: MIT
// Prints the C-22 tables from measure.mjs output directories.
//   node scripts/reindex/table.mjs <out dir> [stages <pin> <step>] [compare <after dir>]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, mode, ...rest] = process.argv.slice(2);
const steps = ["cold", "warm", "comment", "body", "export"];
const load = (base, name) =>
  JSON.parse(readFileSync(join(base, `${name}.summary.json`), "utf8"));
const pins = readdirSync(dir)
  .filter((file) => file.endsWith(".summary.json"))
  .map((file) => file.replace(/\.summary\.json$/, ""))
  .sort();
const sum = (counts, prefix, suffix) =>
  Object.entries(counts ?? {})
    .filter(([key]) => key.startsWith(prefix) && key.endsWith(suffix))
    .reduce((total, [, value]) => total + value, 0);
/** The deterministic work of one index, in a fixed set of columns. */
export const work = (r) => ({
  hashed:
    (r.counts?.["inventory.filesHashed"] ?? 0) +
    (r.counts?.["index.filesRead"] ?? 0),
  parsed: sum(r.counts, "parse.", ".files"),
  analyzedIn: sum(r.counts, "analyze.", ".inputFiles"),
  extracted: r.typescript?.extracted ?? 0,
  programs: r.typescript?.programs ?? 0,
  resolveLinks: sum(r.counts, "resolve.", ".inputLinks"),
  linksCompared: r.counts?.["store.linksCompared"] ?? 0,
  filesWritten: r.counts?.["store.filesWritten"] ?? 0,
  linkRows:
    (r.counts?.["store.linkRowsDeleted"] ?? 0) +
    (r.counts?.["store.linkRowsInserted"] ?? 0),
  targetsRewritten: r.counts?.["store.linkTargetsRewritten"] ?? 0,
  decoded: r.counts?.["store.fileRecordsDecoded"] ?? 0,
  sql: r.counts?.["store.sqlStatements"] ?? 0,
});
const groups = [
  [
    "hash every source (inventory ×2, capture)",
    (n) => n === "command.inventory" || /^index\.(walk|read|hash)$/.test(n),
  ],
  ["decode each stored record for its hash", (n) => n === "index.previous"],
  ["parse changed files", (n) => n.startsWith("parse.")],
  ["write parsed files", (n) => n === "store.writeParsed"],
  ["read analysis input", (n) => /^analyze\.[^.]+\.input$/.test(n)],
  ["language analysis", (n) => /^analyze\.[^.]+$/.test(n)],
  ["write changed analysis results", (n) => /^analyze\.[^.]+\.write$/.test(n)],
  ["read resolver input", (n) => /^resolve\.[^.]+\.input$/.test(n)],
  // Builds after C-22 stage the resolver call with its input reads
  // (`.withInput`); the reads are subtracted below.
  ["language resolution", (n) => /^resolve\.[^.]+(\.withInput)?$/.test(n)],
  ["validate resolution", (n) => /^resolve\.[^.]+\.validate$/.test(n)],
  ["compare and write links", (n) => /^resolve\.[^.]+\.write$/.test(n)],
  [
    "report and metadata",
    (n) => n === "index.report" || n === "command.metadata",
  ],
];
if (mode === "groups") {
  const [step, after] = rest;
  const cell = (r) => {
    const values = groups.map(([, test]) =>
      Object.entries(r.stages)
        .filter(([name]) => test(name))
        .reduce((t, [, v]) => t + v.cpuMs, 0),
    );
    // A `.withInput` stage contains its module's `.input` reads.
    const resolution = groups.findIndex(
      ([name]) => name === "language resolution",
    );
    for (const name of Object.keys(r.stages))
      if (name.endsWith(".withInput"))
        values[resolution] -=
          r.stages[name.replace(/\.withInput$/, ".input")]?.cpuMs ?? 0;
    return [...values, r.cpuMs - values.reduce((t, v) => t + v, 0), r.cpuMs];
  };
  console.log(
    `| stage (CPU s, ${step} edit${after ? ", before → after" : ""}) | ${pins.join(" | ")} |\n|---|${pins.map(() => "--:").join("|")}|`,
  );
  const columns = pins.map((pin) => {
    const x = cell(load(dir, pin).results[step]);
    const y = after ? cell(load(after, pin).results[step]) : undefined;
    return x.map((v, i) =>
      y
        ? `${(v / 1000).toFixed(1)} → ${(y[i] / 1000).toFixed(1)}`
        : (v / 1000).toFixed(1),
    );
  });
  [
    ...groups.map(([name]) => name),
    "other: validation reads (unstaged), process start, store open, checkpoint",
    "**total**",
  ].forEach((name, i) =>
    console.log(`| ${name} | ${columns.map((c) => c[i]).join(" | ")} |`),
  );
} else if (mode === "stages") {
  const [pin, step] = rest;
  const r = load(dir, pin).results[step];
  const rows = Object.entries(r.stages).sort((a, b) => b[1].cpuMs - a[1].cpuMs);
  console.log(`| stage | wall ms | CPU ms | calls |\n|---|--:|--:|--:|`);
  for (const [name, t] of rows)
    if (t.wallMs >= 20 || t.cpuMs >= 20)
      console.log(`| ${name} | ${t.wallMs} | ${t.cpuMs} | ${t.calls} |`);
  console.log(`| (total) | ${r.wallMs} | ${r.cpuMs} | |`);
} else if (mode === "compare") {
  const [after] = rest;
  console.log(
    "| pin | edit | wall s before → after | CPU s before → after | peak MiB before → after | links to resolve | links compared | link rows written | target rows | records decoded | SQL statements |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
  );
  for (const pin of pins) {
    const a = load(dir, pin).results;
    const b = load(after, pin).results;
    for (const step of steps) {
      const x = a[step],
        y = b[step];
      const wx = work(x),
        wy = work(y);
      const pair = (p, q) => (p === q ? `${p}` : `${p} → ${q}`);
      console.log(
        `| ${pin} | ${step} | ${(x.wallMs / 1000).toFixed(1)} → ${(y.wallMs / 1000).toFixed(1)} | ${(x.cpuMs / 1000).toFixed(1)} → ${(y.cpuMs / 1000).toFixed(1)} | ${Math.round(x.maxRssKiB / 1024)} → ${Math.round(y.maxRssKiB / 1024)} | ${pair(wx.resolveLinks, wy.resolveLinks)} | ${pair(wx.linksCompared, wy.linksCompared)} | ${pair(wx.linkRows, wy.linkRows)} | ${pair(wx.targetsRewritten, wy.targetsRewritten)} | ${pair(wx.decoded, wy.decoded)} | ${pair(wx.sql, wy.sql)} |`,
      );
    }
  }
} else {
  console.log(
    "| pin | step | wall s | CPU s | peak MiB | files hashed | parsed | analysis input files | TS programs | TS files extracted | links to resolve | links compared | files written | link rows deleted+inserted | target rows rewritten | records decoded | SQL statements | equal to cold after revert |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|",
  );
  for (const pin of pins) {
    const summary = load(dir, pin);
    for (const step of steps) {
      const r = summary.results[step];
      const w = work(r);
      const equal =
        step in summary.equality
          ? summary.equality[step].length
            ? "NO"
            : "yes"
          : "";
      console.log(
        `| ${pin} | ${step} | ${(r.wallMs / 1000).toFixed(1)} | ${(r.cpuMs / 1000).toFixed(1)} | ${Math.round(r.maxRssKiB / 1024)} | ${w.hashed} | ${w.parsed} | ${w.analyzedIn} | ${w.programs} | ${w.extracted} | ${w.resolveLinks} | ${w.linksCompared} | ${w.filesWritten} | ${w.linkRows} | ${w.targetsRewritten} | ${w.decoded} | ${w.sql} | ${equal} |`,
      );
    }
  }
}
