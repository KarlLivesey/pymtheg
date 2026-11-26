// SPDX-License-Identifier: MIT
// C-55: the same seeded edits through the MCP worker, before → after, step by
// step: process CPU, stored records decoded, the CPU of the two input
// stages (analysis input, resolver input), what was kept and the worker's
// live heap after the job. Prints totals and a per-kind summary as JSON.
//   node scripts/kept/compare-steps.mjs <before run dir> <after run dir> <steps> <edits.json>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [before, after, stepsArg, editsPath] = process.argv.slice(2);
const steps = Number(stepsArg);
const kinds = JSON.parse(readFileSync(editsPath, "utf8")).steps.map(
  (step) => step.kind,
);
const read = (dir, step) => {
  const path = join(dir, `step-${step}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
};
const stageCpu = (record, prefix) =>
  Object.entries(record.stages ?? {})
    .filter(([name]) => name === prefix)
    .reduce((sum, [, time]) => sum + (time.cpuMs ?? 0), 0);
const figures = (record) => ({
  cpuMs: record.cpuMs,
  decoded: record.counts?.["store.fileRecordsDecoded"] ?? 0,
  analysisInputMs: stageCpu(record, "analyze.go.input"),
  resolverInputMs: stageCpu(record, "resolve.go.input"),
  keptBytes: record.counts?.["kept.input.bytes"] ?? 0,
  liveMiB: Math.round((record.memory?.liveBytes ?? 0) / 1048576),
});
const totals = { before: {}, after: {} };
const byKind = {};
let maxLive = 0;
let maxKept = 0;
for (let step = 0; step < steps; step++) {
  const a = read(before, step);
  const b = read(after, step);
  if (!a || !b) throw Error(`step ${step} missing`);
  const x = figures(a);
  const y = figures(b);
  for (const [side, value] of [
    ["before", x],
    ["after", y],
  ])
    for (const [name, number] of Object.entries(value))
      if (name !== "liveMiB" && name !== "keptBytes")
        totals[side][name] = (totals[side][name] ?? 0) + number;
  const kind = kinds[step];
  const entry = (byKind[kind] ??= { steps: 0, before: {}, after: {} });
  entry.steps++;
  for (const [side, value] of [
    ["before", x],
    ["after", y],
  ])
    for (const name of ["cpuMs", "decoded"])
      entry[side][name] = (entry[side][name] ?? 0) + value[name];
  maxLive = Math.max(maxLive, y.liveMiB);
  maxKept = Math.max(maxKept, y.keptBytes);
}
console.log(
  JSON.stringify(
    {
      steps,
      totals,
      byKind,
      maxLiveMiBAfter: maxLive,
      maxKeptMiB: Math.round(maxKept / 1048576),
    },
    null,
    1,
  ),
);
