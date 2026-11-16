// Summarise concurrency.mjs output: per run, index wall time and failures/tries
// for each probe mode. usage: node concurrency-summary.mjs <concurrency.jsonl>
import { readFileSync } from "node:fs";
for (const line of readFileSync(process.argv[2], "utf8").trim().split("\n")) {
  const run = JSON.parse(line);
  const counts = {};
  for (const probe of run.probes) {
    counts[probe.mode] ??= { failed: 0, tries: 0, slowestMs: 0 };
    const c = counts[probe.mode];
    c.tries++;
    if (!probe.ok) c.failed++;
    c.slowestMs = Math.max(c.slowestMs, probe.ms);
  }
  console.log(
    `${run.label.padEnd(12)} index ${(run.wallMs / 1000).toFixed(0)} s (load ${run.loadStart}) ` +
      Object.entries(counts)
        .map(
          ([mode, c]) =>
            `${mode} ${c.failed}/${c.tries} failed (slowest ${(c.slowestMs / 1000).toFixed(1)} s)`,
        )
        .join("; "),
  );
}
