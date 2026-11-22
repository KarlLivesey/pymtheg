// SPDX-License-Identifier: MIT
// SW-6 (review fix): split TypeScript links below Level 2, for the given
// first stored reasons, by the per-link C-13 marker. The module stamps
// `no-unseen-declarations` on every non-exempt link computed by a program
// that contains an unread (failed) file. (The file result's `failedFiles` is
// module-wide and cannot be used for this.)
// Run from the repository root: node evidence/sw-6/unseen-split.mjs RUN.json REASON...
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedLibraryIdentity } from "../../scripts/sweep/coverage-rules.mjs";
import {
  firstBlocker,
  storedReasons,
} from "../../scripts/sweep/coverage-refresh-data.mjs";

const [runPath, ...reasons] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const out = {};
for (const repo of run.repos) {
  if (repo.outcome !== "finished") continue;
  const db = new DatabaseSync(
    join(
      dirname(runPath),
      repo.attempt,
      "checkout/.pymtheg/rebuildable/graph.sqlite",
    ),
    { readOnly: true },
  );
  for (const row of db
    .prepare(
      `SELECT l.file,l.resolution,l.body,t.unit,t.symbol,t.evidence FROM graph_links l
    LEFT JOIN graph_library_targets t ON l.resolution='library' AND t.link=l.id AND t.role='target' WHERE l.module='typescript'`,
    )
    .iterate()) {
    const library =
      row.resolution === "library"
        ? storedLibraryIdentity({
            file: row.file,
            resolution: row.resolution,
            library: row,
          })
        : null;
    if (row.resolution === "resolved" || library?.level === 2) continue;
    const data = JSON.parse(row.body).data ?? {};
    const reason = firstBlocker(storedReasons(data), row.resolution);
    if (!reasons.includes(reason)) continue;
    const marked =
      Array.isArray(data.assumes) &&
      data.assumes.includes("no-unseen-declarations");
    const key = `${reason} | ${marked ? "computed beside an unread file (C-13 marker)" : "no unread file in the program"}`;
    out[key] ??= { links: 0, pins: {} };
    out[key].links++;
    out[key].pins[repo.id] = (out[key].pins[repo.id] ?? 0) + 1;
  }
  db.close();
}
console.log(JSON.stringify(out, null, 1));
