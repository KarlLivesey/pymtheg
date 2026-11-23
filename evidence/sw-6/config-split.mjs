// SPDX-License-Identifier: MIT
// SW-6 (review fix): split installed TypeScript `incomplete-config` links by
// pin, by the top-level area of the file, by the base the owning config
// extends (read from the file's recorded limitation), and by the reason the
// link would have without the configuration gap (`reasonWithoutConfig`).
// Run from the repository root: node evidence/sw-6/config-split.mjs RUN.json
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [runPath] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const byBase = {};
const behind = {};
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
  const bases = new Map();
  const baseOf = (file) => {
    if (!bases.has(file)) {
      const result = JSON.parse(
        db.prepare("SELECT body FROM graph_files WHERE path=?").get(file)
          ?.body ?? "{}",
      ).result;
      const found = (result?.diagnostics ?? [])
        .map(({ message }) => /extends "([^"]+)"/.exec(message)?.[1])
        .filter(Boolean);
      bases.set(file, [...new Set(found)].join(" + ") || "(unrecorded)");
    }
    return bases.get(file);
  };
  for (const { file, body } of db
    .prepare(
      `SELECT file, body FROM graph_links WHERE module='typescript'
    AND json_extract(body,'$.data.reason')='incomplete-config'`,
    )
    .iterate()) {
    const data = JSON.parse(body).data ?? {};
    const area = file.split("/")[0];
    const key = `${repo.id} | ${area}/ | ${baseOf(file)}`;
    byBase[key] = (byBase[key] ?? 0) + 1;
    const next = `${repo.id} | ${area}/ | ${data.reasonWithoutConfig ?? "(none: no other blocker)"}`;
    behind[next] = (behind[next] ?? 0) + 1;
  }
  db.close();
}
const sorted = (o) =>
  Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log(
  JSON.stringify(
    { byBase: sorted(byBase), reasonWithoutConfig: sorted(behind) },
    null,
    1,
  ),
);
