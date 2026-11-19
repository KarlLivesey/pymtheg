// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const queries = [
  ["zod"],
  ["fs", "readFileSync"],
  ["dom", "ParentNode.prototype.querySelector"],
  ["es", "Map.prototype.delete"],
  ["@std/assert"],
];
const scratch = process.env.PYM_SCRATCH;
const [build = "candidate"] = process.argv.slice(2);
const summary = JSON.parse(
  readFileSync(join(scratch, `${build}-run.json`), "utf8"),
);
const cli = resolve("dist/cli/main.js");
const maximum = queries.map(() => ({ library: 0 }));

for (const repo of summary.repos) {
  if (repo.outcome !== "finished") continue;
  const root = join(scratch, repo.attempt, "checkout");
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), {
    readOnly: true,
  });
  try {
    const countByUnit = db.prepare(
      "SELECT count(DISTINCT CASE WHEN role='target' THEN link END) AS library, count(DISTINCT CASE WHEN role='candidate' THEN link END) AS candidateSet FROM graph_library_targets WHERE unit=?",
    );
    const countBySymbol = db.prepare(
      "SELECT count(DISTINCT CASE WHEN role='target' THEN link END) AS library, count(DISTINCT CASE WHEN role='candidate' THEN link END) AS candidateSet FROM graph_library_targets WHERE unit=? AND symbol=?",
    );
    queries.forEach((query, i) => {
      const counts = (query.length > 1 ? countBySymbol : countByUnit).get(...query);
      if (counts.library > maximum[i].library)
        maximum[i] = { ...counts, id: repo.id, root };
    });
  } finally {
    db.close();
  }
}
queries.forEach((query, i) => {
  const { library, candidateSet, id, root } = maximum[i];
  if (!library) throw Error(`No definite uses of ${query.join(" ")}`);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "graph",
      "uses",
      ...query,
      "--root",
      root,
      "--json",
      "--no-sync",
      "--limit",
      "2",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 && result.status !== 2)
    throw result.error ?? Error(`Query exited ${result.status ?? result.signal}`);
  const { status, data } = JSON.parse(result.stdout);
  const { classCounts } = data;
  if (classCounts.library !== library || classCounts.candidateSet !== candidateSet)
    throw Error(`Unexpected CLI count for ${query.join(" ")}`);
  console.log(JSON.stringify({ repo: id, query, status, classCounts }));
});
