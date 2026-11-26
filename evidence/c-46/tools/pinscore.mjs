// SPDX-License-Identifier: MIT
// Per finished pin: TypeScript links, Level 2, assumption-marked Level 2,
// using the exporter's own library identity rule.
// Usage (from the sweep tree): node evidence/c-46/tools/pinscore.mjs RUN.json [PIN...]
// (C-46 copy of SW-6's: attempts are under $SWEEP_SCRATCH when set.)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedLibraryIdentity } from "../../../scripts/sweep/coverage-rules.mjs";

const [runPath, ...only] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
for (const repo of run.repos) {
  if (only.length && !only.includes(repo.id)) continue;
  if (repo.outcome !== "finished") {
    console.log([repo.id, repo.outcome].join("\t"));
    continue;
  }
  const db = new DatabaseSync(
    join(
      process.env.SWEEP_SCRATCH ?? dirname(runPath),
      repo.attempt,
      "checkout/.pymtheg/rebuildable/graph.sqlite",
    ),
    { readOnly: true },
  );
  let links = 0,
    level2 = 0,
    assumed = 0;
  for (const row of db
    .prepare(
      `SELECT l.file,l.resolution,l.body,t.unit,t.symbol,t.evidence FROM graph_links l
    LEFT JOIN graph_library_targets t ON l.resolution='library' AND t.link=l.id AND t.role='target'
    WHERE l.module='typescript'`,
    )
    .iterate()) {
    links++;
    const library =
      row.resolution === "library"
        ? storedLibraryIdentity({
            file: row.file,
            resolution: row.resolution,
            library: row,
          })
        : null;
    if (row.resolution !== "resolved" && library?.level !== 2) continue;
    level2++;
    const { data = {} } = JSON.parse(row.body);
    if (Array.isArray(data.assumes) && data.assumes.length) assumed++;
  }
  db.close();
  console.log(
    [
      repo.id,
      links,
      level2,
      assumed,
      ((100 * level2) / links).toFixed(2),
      ((100 * assumed) / links).toFixed(2),
    ].join("\t"),
  );
}
