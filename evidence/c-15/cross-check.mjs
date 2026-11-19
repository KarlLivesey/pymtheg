// SPDX-License-Identifier: MIT
// C-15 cross-check: a link whose failed-file reason this branch drops must
// keep its outcome when the failed files are treated as empty (the
// diagnostic build). If emptying them changes its outcome, the failure was
// part of its answer and dropping the reason would be wrong. Usage:
//   node cross-check.mjs LABELS.jsonl ORACLE_CHANGES.jsonl [...more]
// LABELS is compare.mjs's OUT.labels.jsonl (main → this branch);
// ORACLE_CHANGES are its OUT.changes.jsonl files (main → diagnostic build).
import { readFileSync } from "node:fs";

const [labelsPath, ...oraclePaths] = process.argv.slice(2);
const read = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const key = (l) => [l.repo, l.file, l.line, l.kind, l.targetName].join("|");
const oracle = new Map(oraclePaths.flatMap(read).map((c) => [key(c), c]));
const dropped = read(labelsPath).filter(
  (l) =>
    l.before.includes("failed-file-unseen-declarations") &&
    !l.after.includes("failed-file-unseen-declarations"),
);
const byRepo = {};
const conflicts = [];
for (const l of dropped) {
  const row = (byRepo[l.repo] ??= { dropped: 0, changedWhenEmpty: 0 });
  row.dropped++;
  const c = oracle.get(key(l));
  if (c) {
    row.changedWhenEmpty++;
    conflicts.push({ ...l, oracle: c.after });
  }
}
console.log(JSON.stringify({ byRepo, conflicts }, null, 2));
