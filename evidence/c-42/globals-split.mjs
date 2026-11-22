// SPDX-License-Identifier: MIT
// C-42 diagnosis: every installed TypeScript candidate set on main whose
// candidates are all library declarations, classified by what the same site
// is on the candidate build, where the module decides from the compiler's
// own symbol:
//   (a) merged: one global compiler symbol declared in several library units
//       (`mergedGlobal`);
//   (b) not marked, split by why:
//       - a synthesised target present: a Node target the module adds when
//         a program lacks @types/node (ecosystem node, evidence
//         declared-builtin), next to a real declaration;
//       - a test package among the units (narrowed D23);
//       - variable declarations that disagree on the type (narrowed D23):
//         the sets the previous head marked (OLD_MERGED, its list of marked
//         sites) that none of the above explains;
//       - different compiler symbols (for example the arms of a union
//         receiver): the rest;
//   (c) other: anything else (the site changed outcome or is absent).
// Also split by the set of declaring units and by name, and the SW-6 group
// "one name declared by several library typings" (same last name, several
// units) separately.
// Usage: node globals-split.mjs SCRATCH MAIN.json HEAD.json BUILD [OLD_MERGED.jsonl.gz] > globals-split.json
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const [scratch, mainPath, headPath, build, oldMergedPath] = process.argv.slice(2);
const { isTestPackage } = await import(
  pathToFileURL(resolve(build, "dist/graph/languages/typescript/global-types.js"))
);
const siteKey = (row) => `${row.pin}\0${row.file}\0${row.kind}\0${row.start}\0${row.name}`;
const oldMerged = new Set(
  oldMergedPath
    ? gunzipSync(readFileSync(oldMergedPath)).toString("utf8").split("\n").filter(Boolean)
        .map((line) => siteKey(JSON.parse(line)))
    : [],
);
const runs = [mainPath, headPath].map(
  (path) => new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((repo) => [repo.id, repo])),
);
const open = (repo) =>
  new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const sites = (db) => {
  const libraries = db.prepare("SELECT ecosystem, unit, symbol, evidence FROM graph_library_targets WHERE link=? AND role='candidate' ORDER BY ecosystem, unit, symbol");
  const checkout = db.prepare("SELECT count(*) AS n FROM graph_candidates WHERE link=?");
  const out = new Map();
  for (const { id, file, resolution, body } of db.prepare("SELECT id, file, resolution, body FROM graph_links WHERE module='typescript'").iterate()) {
    const link = JSON.parse(body);
    const key = `${file}\0${link.kind}\0${link.range.start}\0${link.targetName}`;
    out.set(key, {
      file,
      kind: link.kind,
      start: link.range.start,
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
// Prototype-free tables: a name such as `toString` is a plain key.
const table = () => Object.create(null);
const totals = { all: table(), sw6Group: table() };
const byUnits = table();
const byName = table();
const byPin = table();
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
    const synthesised = now?.libraries.some(({ ecosystem, evidence }) => ecosystem === "node" && evidence === "declared-builtin");
    const testPackage = now?.libraries.some(({ ecosystem, unit }) => ecosystem === "npm" && isTestPackage(unit));
    const wasMerged = oldMerged.has(siteKey({ pin: id, file: link.file, kind: link.kind, start: link.start, name: link.name }));
    const kind = !now || now.resolution !== "ambiguous" || now.checkout
      ? "(c) other: outcome changed or site absent"
      : now.data.mergedGlobal === true
        ? "(a) one global symbol in several units (merged)"
        : synthesised
          ? "(b) not marked: a synthesised Node target present"
          : testPackage
            ? "(b) not marked: a test package among the units"
            : wasMerged
              ? "(b) not marked: variable declarations disagree on the type"
              : "(b) not marked: different compiler symbols";
    add(totals.all, kind);
    if (sw6) add(totals.sw6Group, kind);
    add((byPin[id] ??= table()), kind);
    add((byUnits[kind] ??= table()), units);
    add((byName[kind] ??= table()), [...names].sort().join(" | ") || "(no name)");
  }
}
const top = (rows, n) => Object.fromEntries(Object.entries(rows).sort((a, b) => b[1] - a[1]).slice(0, n));
console.log(JSON.stringify({
  totals,
  byPin,
  byUnits: Object.fromEntries(Object.entries(byUnits).map(([kind, rows]) => [kind, top(rows, 25)])),
  byName: Object.fromEntries(Object.entries(byName).map(([kind, rows]) => [kind, top(rows, 40)])),
}, null, 1));
