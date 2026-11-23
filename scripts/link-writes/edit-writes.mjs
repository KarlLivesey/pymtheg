// SPDX-License-Identifier: MIT
// C-53: what the same seeded edits wrote before and after, step by step.
// Reads the step-<n>.json records random-edits.mjs leaves in two run
// directories (the same pin and seed, two builds) and prints, per counter,
// the totals over all steps and the steps where the second wrote more.
//   node scripts/link-writes/edit-writes.mjs <before run dir> <after run dir> <steps>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [before, after, stepsArg] = process.argv.slice(2);
const steps = Number(stepsArg);
const counters = [
  "store.filesWritten",
  "store.symbolRowsWritten",
  "store.linkRowsInserted",
  "store.linkRowsDeleted",
  "store.linkTargetsRewritten",
  "store.sqlStatements",
];
const read = (dir, step) => {
  const path = join(dir, `step-${step}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
};
const totals = Object.fromEntries(counters.map((name) => [name, [0, 0]]));
const more = [];
let rss = [0, 0];
for (let step = 0; step < steps; step++) {
  const a = read(before, step);
  const b = read(after, step);
  if (!a || !b) throw Error(`step ${step} missing`);
  for (const name of counters) {
    const x = a.counts?.[name] ?? 0;
    const y = b.counts?.[name] ?? 0;
    totals[name][0] += x;
    totals[name][1] += y;
    if (y > x && name !== "store.sqlStatements")
      more.push({ step, name, before: x, after: y });
  }
  rss = [Math.max(rss[0], a.maxRssKiB), Math.max(rss[1], b.maxRssKiB)];
}
console.log(
  JSON.stringify(
    { steps, totals, stepsWritingMore: more, peakRssKiB: rss },
    null,
    1,
  ),
);
