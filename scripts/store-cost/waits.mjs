// SPDX-License-Identifier: MIT
// C-37: the longest second-writer waits of contend.sh runs, in seconds and in
// the index's commits that fell inside each wait, and any errors.
//   node scripts/store-cost/waits.mjs <out dir> <label>...
import "../isolated-home.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, ...labels] = process.argv.slice(2);
for (const label of labels) {
  const run = JSON.parse(readFileSync(join(dir, `${label}.json`), "utf8"));
  const { waits } = JSON.parse(
    readFileSync(join(dir, `${label}.waits.json`), "utf8"),
  );
  const spans = waits
    .map((wait) => ({
      ...wait,
      seconds: (wait.ended - wait.started) / 1000,
      commits: run.commitTimes.filter(
        (time) => time >= wait.started && time <= wait.ended,
      ).length,
    }))
    .sort((a, b) => b.seconds - a.seconds);
  const errors = waits.filter((wait) => wait.error);
  console.log(
    `${label}: index wall ${(run.wallMs / 1000).toFixed(1)} s, ${run.commitTimes.length} commits, log peak ${(run.maxWalBytes / 1048576).toFixed(0)} MiB; ${waits.length} waits, ${errors.length} errors${errors.length ? " (" + [...new Set(errors.map((e) => e.error))].join("; ") + ")" : ""}`,
  );
  for (const wait of spans.slice(0, 5))
    console.log(
      `  ${wait.seconds.toFixed(1)} s, ${wait.commits} commits of the index inside`,
    );
}
