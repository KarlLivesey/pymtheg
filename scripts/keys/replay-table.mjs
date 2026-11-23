// SPDX-License-Identifier: MIT
// C-49: a Markdown table of commit-replay.mjs results, before → after per pin:
// files and rows written over all replayed commits, how many of them changed
// in meaning, the files other than the edited one, and the worst commit.
//   node scripts/keys/replay-table.mjs <pin>=<before.json>,<after.json>...
import { readFileSync } from "node:fs";

const rows = [];
for (const argument of process.argv.slice(2)) {
  const [pin, paths] = argument.split("=");
  const [before, after] = paths
    .split(",")
    .map((path) => JSON.parse(readFileSync(path, "utf8")).steps);
  if (before.length !== after.length)
    throw Error(`${pin}: ${before.length} and ${after.length} steps`);
  const total = (steps, name) =>
    steps.reduce((sum, step) => sum + step[name], 0);
  const worst = (steps) =>
    Math.max(...steps.map((step) => step.otherFilesWritten));
  const cell = (name) => `${total(before, name)} → ${total(after, name)}`;
  const redo = [...before, ...after].filter(
    (step) => !step.redoEqualsFirst,
  ).length;
  rows.push(
    `| ${pin} | ${before.length} | ${cell("filesWritten")} | ${cell("otherFilesWritten")} | ${worst(before)} → ${worst(after)} | ${cell("filesChangedInMeaning")} | ${cell("rowsWritten")} | ${cell("rowsChangedInMeaning")} | ${redo} |`,
  );
}
console.log(
  [
    "| Pin | Commits | Files written | Other files written | Most other files, one commit | Files changed in meaning | Rows written | Rows changed in meaning | Redo ≠ first |",
    "|---|--:|--:|--:|--:|--:|--:|--:|--:|",
    ...rows,
  ].join("\n"),
);
