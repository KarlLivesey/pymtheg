// SPDX-License-Identifier: MIT
// SW-6 (review fix): count TypeScript `references` links named `const`, the
// const assertions (`as const`, `<const>x`) that the module stored as
// unresolved references before C-39, by pin and by first stored reason and
// C-13 marker (the keys of unseen-split.json).
// Run from the repository root: node evidence/sw-6/const-count.mjs RUN.json
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  firstBlocker,
  storedReasons,
} from "../../scripts/sweep/coverage-refresh-data.mjs";

const [runPath] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const pins = {};
const reasons = {};
let total = 0;
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
  for (const { resolution, body } of db
    .prepare(
      `SELECT resolution, body FROM graph_links WHERE module='typescript'
    AND kind='references' AND json_extract(body,'$.targetName')='const'`,
    )
    .iterate()) {
    const data = JSON.parse(body).data ?? {};
    const marked =
      Array.isArray(data.assumes) &&
      data.assumes.includes("no-unseen-declarations");
    const key = `${firstBlocker(storedReasons(data), resolution)} | ${marked ? "computed beside an unread file (C-13 marker)" : "no unread file in the program"}`;
    reasons[key] = (reasons[key] ?? 0) + 1;
    pins[repo.id] = (pins[repo.id] ?? 0) + 1;
    total++;
  }
  db.close();
}
console.log(JSON.stringify({ total, reasons, pins }, null, 1));
