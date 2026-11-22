// SPDX-License-Identifier: MIT
// C-42 diagnosis: every installed TypeScript candidate set on main whose
// candidates are all library declarations, classified by what the same site
// is on the candidate build, where the module decides from the compiler's
// own symbol:
//   (a) merged: one global compiler symbol declared in several library units
//       (`mergedGlobal`);
//   (b) alternatives: library candidates that are different compiler symbols
//       (for example the arms of a union receiver), split by whether they
//       share the member name;
//   (c) other: anything else (the site changed outcome or is absent).
// Also split by the set of declaring units and by name, and the SW-6 group
// "one name declared by several library typings" (same last name, several
// units) separately.
// Usage: node globals-split.mjs SCRATCH MAIN.json HEAD.json > globals-split.json
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, mainPath, headPath] = process.argv.slice(2);
const runs = [mainPath, headPath].map(
  (path) => new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((repo) => [repo.id, repo])),
);
const open = (repo) =>
  new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const sites = (db) => {
  const libraries = db.prepare("SELECT ecosystem, unit, symbol FROM graph_library_targets WHERE link=? AND role='candidate' ORDER BY ecosystem, unit, symbol");
  const checkout = db.prepare("SELECT count(*) AS n FROM graph_candidates WHERE link=?");
  const out = new Map();
  for (const { id, file, resolution, body } of db.prepare("SELECT id, file, resolution, body FROM graph_links WHERE module='typescript'").iterate()) {
    const link = JSON.parse(body);
    const key = `${file}\0${link.kind}\0${link.range.start}\0${link.targetName}`;
    out.set(key, {
      resolution,
      data: link.data ?? {},
      name: link.targetName,
      libraries: resolution === "ambiguous" ? libraries.all(id) : [],
      checkout: resolution === "ambiguous" ? checkout.get(id).n : 0,
    });
  }
  return out;
};
const last = (symbol) => (symbol ?? "").split(".").at(-1);
const add = (table, key, n = 1) => (table[key] = (table[key] ?? 0) + n);
const totals = { all: {}, sw6Group: {} };
const byUnits = {};
const byName = {};
const byPin = {};
for (const [id, mainRepo] of runs[0]) {
  const headRepo = runs[1].get(id);
  if (mainRepo.outcome !== "finished" || headRepo?.outcome !== "finished") continue;
  const [before, after] = [open(mainRepo), open(headRepo)].map((db) => {
    const value = sites(db);
    db.close();
    return value;
  });
  for (const [key, link] of before) {
    if (link.resolution !== "ambiguous" || link.checkout || !link.libraries.length) continue;
    const now = after.get(key);
    const names = new Set(link.libraries.map(({ symbol }) => last(symbol)));
    const units = [...new Set(link.libraries.map(({ ecosystem, unit }) => `${ecosystem}:${unit}`))].sort().join(" + ");
    const sw6 = names.size === 1 && units.includes(" + ");
    const kind = !now || now.resolution !== "ambiguous" || now.checkout
      ? "(c) other: outcome changed or site absent"
      : now.data.mergedGlobal === true
        ? "(a) one global symbol in several units (merged)"
        : names.size === 1
          ? "(b) different symbols with the same member name"
          : "(b) different symbols with different names";
    add(totals.all, kind);
    if (sw6) add(totals.sw6Group, kind);
    add((byPin[id] ??= {}), kind);
    const table = (byUnits[kind] ??= {});
    add(table, units);
    const names2 = (byName[kind] ??= {});
    add(names2, [...names].sort().join(" | "));
  }
}
const top = (table, n) => Object.fromEntries(Object.entries(table).sort((a, b) => b[1] - a[1]).slice(0, n));
console.log(JSON.stringify({
  totals,
  byPin,
  byUnits: Object.fromEntries(Object.entries(byUnits).map(([kind, table]) => [kind, top(table, 25)])),
  byName: Object.fromEntries(Object.entries(byName).map(([kind, table]) => [kind, top(table, 40)])),
}, null, 1));
