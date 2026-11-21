// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, receipt] = process.argv.slice(2);
const { repos } = JSON.parse(readFileSync(receipt, "utf8"));
const marker = "ts-unbuilt-entry-is-compiler-emit";
const counts = [];

for (const repo of repos) {
  if (repo.outcome !== "finished") continue;
  const db = new DatabaseSync(
    resolve(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const links = db.prepare(
    "SELECT resolution, body FROM graph_links WHERE module='typescript' AND instr(body, ?) > 0",
  );
  const row = { pin: repo.id, marked: 0, checkoutTargets: 0 };
  for (const { resolution, body } of links.iterate(marker)) {
    const { data } = JSON.parse(body);
    if (!data?.assumes?.includes(marker)) continue;
    const entry = data.unbuiltEntry;
    if (
      entry?.assumed !== true ||
      ![entry.build, entry.config, entry.output, entry.source].every(
        (path) => typeof path === "string" && path.length > 0,
      )
    )
      throw Error(`Missing entry provenance in ${repo.id}`);
    row.marked++;
    if (resolution === "resolved") row.checkoutTargets++;
  }
  counts.push(row);
  db.close();
}

console.log(JSON.stringify(counts, null, 2));
