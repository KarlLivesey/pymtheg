// SPDX-License-Identifier: MIT
// SW-6: split installed TypeScript candidate-set links by what the candidates
// are: library declarations of one global name in several typings (for
// example DOM and Node both declaring `Response`), other library-only sets,
// checkout-only sets, or mixed checkout and library candidates.
// Usage (from the sweep tree): node evidence/sw-6/candsplit.mjs RUN.json
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [runPath] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const total = {};
const byPin = {};
for (const repo of run.repos) {
  if (repo.outcome !== "finished") continue;
  const db = new DatabaseSync(join(dirname(runPath), repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const libs = db.prepare("SELECT unit, symbol FROM graph_library_targets WHERE link=? AND role='candidate'");
  const checkout = db.prepare("SELECT count(*) AS n FROM graph_candidates WHERE link=?");
  for (const { id } of db.prepare("SELECT id FROM graph_links WHERE module='typescript' AND resolution='ambiguous'").iterate()) {
    const units = libs.all(id);
    const local = checkout.get(id).n;
    let shape;
    if (!units.length) shape = local ? "checkout candidates only" : "no stored candidates";
    else if (local) shape = "checkout and library candidates";
    else {
      const names = new Set(units.map(({ symbol }) => (symbol ?? "").split(".").at(-1)));
      const distinctUnits = new Set(units.map(({ unit }) => unit));
      shape = names.size === 1 && distinctUnits.size > 1
        ? "one name declared by several library typings"
        : "library candidates with different names";
    }
    total[shape] = (total[shape] ?? 0) + 1;
    (byPin[repo.id] ??= {})[shape] = (byPin[repo.id]?.[shape] ?? 0) + 1;
  }
  db.close();
}
console.log(JSON.stringify({ total, byPin }, null, 1));
