// SPDX-License-Identifier: MIT
// C-45: where a one-file edit's time goes, from scripts/reindex/measure.mjs
// results (index-once.mjs per step). CPU seconds by stage group; the groups
// are disjoint (nested stages are counted once, in their outer group), and
// "other" is the rest of the process's CPU. Also the deterministic work
// counters that say how much of each group the edit needed.
//   node scripts/resident/stages.mjs <out dir> <pin>... [--steps body,export] [--json]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const stepsAt = args.indexOf("--steps");
const steps =
  stepsAt < 0 ? ["warm", "body", "export"] : args[stepsAt + 1].split(",");
const json = args.includes("--json");
const pins = args
  .slice(1)
  .filter((arg, i) => !arg.startsWith("--") && args[i] !== "--steps");
const dir = args[0];
const languages = ["go", "rust", "typescript"];
const stage = (r, name) => r.stages?.[name]?.cpuMs ?? 0;
const sumOf = (r, names) => names.reduce((s, n) => s + stage(r, n), 0);
export function groups(r) {
  const g = {
    "process start and module load":
      (r.startupCpuMs ?? 0) + (r.moduleLoadCpuMs ?? 0) + stage(r, "command.modules"),
    "tree hash and snapshot": sumOf(r, [
      "command.inventory",
      "index.walk",
      "index.read",
      "index.hash",
    ]),
    "stored inputs read": sumOf(r, [
      "command.checkpointRead",
      "command.metadata",
      "index.previous",
      ...languages.map((id) => `analyze.${id}.input`),
      ...languages.map((id) => `resolve.${id}.input`),
      ...languages.map((id) => `resolve.${id}.validationInput`),
    ]),
    parse: sumOf(r, languages.map((id) => `parse.${id}`)),
    "analysis (language)": sumOf(r, languages.map((id) => `analyze.${id}`)),
    "resolution (language)": sumOf(r, [
      ...languages.map((id) => `resolve.${id}.withInput`),
      ...languages.map((id) => `resolve.${id}.validate`),
    ]),
    "store writes and completion": sumOf(r, [
      "store.writeParsed",
      "store.beginRun",
      "store.finishRun",
      "command.checkpointWrite",
      "command.sqliteOpen",
      "command.sqliteClose",
      ...languages.map((id) => `analyze.${id}.write`),
      ...languages.map((id) => `resolve.${id}.write`),
    ]),
  };
  const total = (r.startupCpuMs ?? 0) + (r.moduleLoadCpuMs ?? 0) + r.cpuMs;
  const known = Object.values(g).reduce((s, v) => s + v, 0);
  g.other = Math.max(0, total - known);
  return { groups: g, total };
}
const counters = (r) => {
  const c = r.counts ?? {};
  const sum = (prefix, suffix) =>
    Object.entries(c)
      .filter(([k]) => k.startsWith(prefix) && k.endsWith(suffix))
      .reduce((s, [, v]) => s + v, 0);
  return {
    filesHashed: (c["inventory.filesHashed"] ?? 0) + (c["index.filesRead"] ?? 0),
    filesParsed: sum("parse.", ".files"),
    analysisInputFiles: sum("analyze.", ".inputFiles"),
    tsPrograms: r.typescript?.programs ?? 0,
    tsFilesExtracted: r.typescript?.extracted ?? 0,
    goDecisionFiles: c["resolve.go.decisionFiles"] ?? 0,
    resolverInputLinks: sum("resolve.", ".inputLinks"),
    recordsDecoded: c["store.fileRecordsDecoded"] ?? 0,
    filesWritten: c["store.filesWritten"] ?? 0,
    sqlStatements: c["store.sqlStatements"] ?? 0,
  };
};
const out = [];
for (const pin of pins)
  for (const step of steps) {
    let r;
    try {
      r = JSON.parse(
        readFileSync(join(dir, pin, `${pin}.${step}.json`), "utf8"),
      );
    } catch {
      continue;
    }
    const { groups: g, total } = groups(r);
    out.push({ pin, step, wallMs: r.wallMs, totalCpuMs: total, groups: g, counters: counters(r) });
  }
if (json) console.log(JSON.stringify(out, null, 1));
else {
  const names = Object.keys(out[0]?.groups ?? {});
  console.log(`| Pin | Edit | CPU s | ${names.join(" | ")} |`);
  console.log(`|---|---|--:|${names.map(() => "--:").join("|")}|`);
  for (const row of out)
    console.log(
      `| ${row.pin} | ${row.step} | ${(row.totalCpuMs / 1000).toFixed(1)} | ${names
        .map((n) => (row.groups[n] / 1000).toFixed(1))
        .join(" | ")} |`,
    );
  console.log("");
  const cn = Object.keys(out[0]?.counters ?? {});
  console.log(`| Pin | Edit | ${cn.join(" | ")} |`);
  console.log(`|---|---|${cn.map(() => "--:").join("|")}|`);
  for (const row of out)
    console.log(`| ${row.pin} | ${row.step} | ${cn.map((n) => row.counters[n]).join(" | ")} |`);
}
