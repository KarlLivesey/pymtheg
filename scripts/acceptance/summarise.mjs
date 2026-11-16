#!/usr/bin/env node
// Writes the result section of docs/changes/R1-F.md from the evidence files,
// so no count in the note is restated by hand:
//
//   node scripts/acceptance/summarise.mjs [--evidence evidence/r1-f] [--note docs/changes/R1-F.md] [--print]
//
// It replaces everything between `<!-- acceptance-results:start -->` and
// `<!-- acceptance-results:end -->` with tables built from latest.json and
// selftest.json. With --print it writes the block to stdout instead (for a
// PR description).
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const REPO = resolve(new URL("../..", import.meta.url).pathname);
const EVIDENCE = resolve(opt("--evidence", join(REPO, "evidence/r1-f")));
const NOTE = resolve(opt("--note", join(REPO, "docs/changes/R1-F.md")));
const run = JSON.parse(readFileSync(join(EVIDENCE, "latest.json"), "utf8"));
const self = JSON.parse(readFileSync(join(EVIDENCE, "selftest.json"), "utf8"));
const STATUSES = ["pass", "known-gap", "expected-fail", "observed", "fail"];
const cell = (t) => String(t ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const count = (rows, status) => rows.filter((r) => r.status === status).length;

const scenarios = ["0-build", ...run.scenarios.map((s) => s.id)];
const lines = [];
lines.push(
  `Harness run on commit ${run.commit} (${run.generatedAt.slice(0, 10)}): verdict **${run.verdict}**, ` +
    STATUSES.map((s) => `**${count(run.results, s)} ${s}**`).join(", ") +
    ` (${run.results.length} rows; \`evidence/r1-f/latest.json\`).`,
  "",
  `| Scenario | ${STATUSES.join(" | ")} |`,
  `|---|${STATUSES.map(() => "---:").join("|")}|`,
);
for (const id of scenarios) {
  const rows = run.results.filter((r) => r.scenario === id);
  if (rows.length) lines.push(`| ${id} | ${STATUSES.map((s) => count(rows, s)).join(" | ")} |`);
}
const gaps = run.results.filter((r) => r.status === "known-gap");
lines.push("", "Known gaps in this run:", "");
if (!gaps.length) lines.push("None.");
else {
  const byChunk = new Map();
  for (const g of gaps) byChunk.set(g.chunk, [...(byChunk.get(g.chunk) ?? []), `${g.scenario}/${g.step}`]);
  lines.push("| Chunk | Rows | Steps |", "|---|---:|---|");
  for (const [chunk, steps] of byChunk) lines.push(`| ${chunk} | ${steps.length} | ${cell(steps.join(", "))} |`);
}
const quote = (scenario, step) => run.results.find((r) => r.scenario === scenario && r.step === step)?.reason ?? "(not in this run)";
lines.push(
  "",
  "Observations quoted from the same run (timings and sizes are observations, not limits):",
  "",
  `- Install (a, \`npx\`): ${quote("a-node-only", "install-npx")}; ${quote("a-node-only", "install-size")}.`,
  `- Go opt-in (c): index ${quote("c-node-go-rust", "go-toolchain-index")}; callers of Add opted in: ${quote("c-node-go-rust", "go-toolchain-callers")}; with the setting off: ${quote("c-node-go-rust", "go-source-only-callers")}.`,
  `- restic (f): ${quote("f-restic", "restic-graph-index")}.`,
  (() => {
    const v = run.results.find((r) => r.scenario === "a-node-only" && r.step === "version");
    return `- One CLI call through \`npx\` (a, \`--version\`): ${v?.durationMs ?? "?"} ms, peak RSS ≥ ${v?.peakRssKiB ? Math.round(v.peakRssKiB / 1024) : "?"} MiB.`;
  })(),
  `- Absolute-path \`npx\` (a): ${quote("a-node-only", "npx-absolute-path")}.`,
);
const outcomes = self.outcomes;
const sabotages = outcomes.filter((o) => o.id !== "control");
const caught = sabotages.filter((o) => o.verdict === "caught").length;
const control = outcomes.find((o) => o.id === "control");
lines.push(
  "",
  `Self-test on commit ${self.commit} (${self.generatedAt.slice(0, 10)}): **${self.passed ? "passed" : "FAILED"}**. ` +
    `Wording matcher ${self.matcher.cases - self.matcher.failures.length}/${self.matcher.cases}; ` +
    `control ${control?.verdict} (exit ${control?.exitCode}); **${caught}/${sabotages.length} sabotages caught** (\`evidence/r1-f/selftest.json\`).`,
  "",
  "| Case | Break | Scenario | Named step(s), each must be `fail` | Exit | Verdict |",
  "|---|---|---|---|---|---|",
);
for (const o of outcomes) lines.push(`| ${o.id} | ${cell(o.what)} | ${o.scenarios} | ${cell(o.expect.join(", ") || "–")} | ${o.exitCode ?? "–"} | ${o.verdict} |`);
const block = lines.join("\n");

if (argv.includes("--print")) process.stdout.write(block + "\n");
else {
  const note = readFileSync(NOTE, "utf8");
  const start = "<!-- acceptance-results:start -->",
    end = "<!-- acceptance-results:end -->";
  const a = note.indexOf(start),
    b = note.indexOf(end);
  if (a < 0 || b < a) throw Error(`${NOTE} has no ${start} … ${end} block`);
  writeFileSync(NOTE, note.slice(0, a + start.length) + "\n" + block + "\n" + note.slice(b));
  console.log(`wrote ${lines.length} lines into ${NOTE}`);
}
