// SPDX-License-Identifier: MIT
// SW-6 (D20 check): the library module links are the TypeScript `imports`
// links with a library unit, no named symbol and no stored reason. This
// tallies what such a link names: the module specifier itself (the module
// link of an import or re-export), a whole-module binding (`*`, from
// `import * as x`, `require(...)` or `export * from`), or something else,
// which would be a member and must not count under D20.
// Run from the repository root: node evidence/sw-6/module-links.mjs RUN.json
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedLibraryIdentity } from "../../scripts/sweep/coverage-rules.mjs";
import { storedReasons } from "../../scripts/sweep/coverage-refresh-data.mjs";

const [runPath] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const out = { links: 0, names: {}, examples: [] };
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
    JOIN graph_library_targets t ON t.link=l.id AND t.role='target'
    WHERE l.module='typescript' AND l.kind='imports' AND l.resolution='library'`,
    )
    .iterate()) {
    const library = storedLibraryIdentity({
      file: row.file,
      resolution: row.resolution,
      library: row,
    });
    const link = JSON.parse(row.body);
    if (library.level === 2 || storedReasons(link.data ?? {}).length) continue;
    const name =
      link.targetName === link.data?.specifier
        ? "the module specifier"
        : link.targetName === "*"
          ? "a whole-module binding (*)"
          : "something else";
    out.links++;
    out.names[name] = (out.names[name] ?? 0) + 1;
    if (name === "something else" && out.examples.length < 10)
      out.examples.push({
        pin: repo.id,
        file: row.file,
        targetName: link.targetName,
        specifier: link.data?.specifier,
      });
  }
  db.close();
}
console.log(JSON.stringify(out, null, 1));
