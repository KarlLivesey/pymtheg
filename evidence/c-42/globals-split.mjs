// SPDX-License-Identifier: MIT
// C-42 diagnosis: every installed TypeScript candidate set on main whose
// candidates are all library declarations, classified by what the same site
// is on the candidate build, where the module decides from the compiler's
// own symbol:
//   (a) merged: one global compiler symbol declared in several library units
//       (`mergedGlobal`);
//   (b) not marked, split by the reason the measurement build records in
//       the link's data (`notMarked`, in the order the mark's conditions
//       are tested): a checkout candidate, a synthesised Node target, a
//       declaration outside the global scope, distinct symbols (with their
//       count), a test package, units in conflict;
//   (c) other: anything else (the site changed outcome or is absent).
// Also split by the set of declaring units and by name, and the SW-6 group
// "one name declared by several library typings" (same last name, several
// units) separately.
// Check (review round 3): every environment-only set on head (its units only
// the DOM, @types/node and the TypeScript library) is partitioned into
// marked and those reasons (`environmentOnly`); its remainder, a set with
// neither, must be 0 on every pin (`ok`). `environmentOnlyConflicts` counts
// the sets the conflict rule unmarks among them, with samples.
// HEAD.json is a run of the measurement build (README): its stores equal the
// candidate's but for the two fields that name why a set is not marked.
// Usage: node globals-split.mjs SCRATCH MAIN.json HEAD.json BUILD > globals-split.json
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const [scratch, mainPath, headPath, build] = process.argv.slice(2);
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
const ENVIRONMENT = new Set(["dom", "node", "typescript-lib"]);
const environmentOnlyConflicts = { total: 0, byPin: table(), samples: [] };
// Review round 3: every environment-only set on head, partitioned into
// marked and the measurement build's reasons; the remainder (no mark and
// no reason) must be 0 on every pin.
const environmentOnly = { total: table(), byPin: table(), reasons: table(), remainder: 0, remainderSamples: [] };
/** The measurement build's reason, also when it differs per program. */
function notMarkedOf(data) {
  if (!data) return undefined;
  if (data.notMarked) return data.notMarked;
  const reasons = Object.values(data.byProject ?? {})
    .map((entry) => entry.notMarked)
    .filter(Boolean);
  return reasons.length ? [...new Set(reasons)].sort().join("; ") : undefined;
}
for (const [id, mainRepo] of runs[0]) {
  const headRepo = runs[1].get(id);
  if (mainRepo.outcome !== "finished" || headRepo?.outcome !== "finished") continue;
  const [before, after] = [open(mainRepo), open(headRepo)].map((db) => {
    const value = sites(db);
    db.close();
    return value;
  });
  for (const link of after.values()) {
    if (link.resolution !== "ambiguous" || link.checkout) continue;
    const units = new Set(link.libraries.map(({ ecosystem, unit }) => `${ecosystem}:${unit}`));
    if (units.size < 2 || !link.libraries.every(({ ecosystem }) => ENVIRONMENT.has(ecosystem))) continue;
    const reason = notMarkedOf(link.data);
    const bucket = link.data.mergedGlobal === true ? "marked" : reason ? reason.replace(/ \(.*\)$/, "") : "remainder";
    add(environmentOnly.total, bucket);
    add((environmentOnly.byPin[id] ??= table()), bucket);
    if (reason) add(environmentOnly.reasons, reason);
    if (bucket === "remainder") {
      environmentOnly.remainder++;
      if (environmentOnly.remainderSamples.length < 10)
        environmentOnly.remainderSamples.push({ pin: id, file: link.file, name: link.name, units: [...units] });
    }
  }
  for (const link of after.values())
    if (
      notMarkedOf(link.data) === "units in conflict" &&
      link.libraries.length &&
      link.libraries.every(({ ecosystem }) => ENVIRONMENT.has(ecosystem))
    ) {
      environmentOnlyConflicts.total++;
      add(environmentOnlyConflicts.byPin, id);
      if (environmentOnlyConflicts.samples.length < 10)
        environmentOnlyConflicts.samples.push({
          pin: id,
          file: link.file,
          name: link.name,
          units: [...new Set(link.libraries.map(({ ecosystem, unit }) => `${ecosystem}:${unit}`))],
        });
    }
  for (const [key, link] of before) {
    if (link.resolution !== "ambiguous" || link.checkout || !link.libraries.length) continue;
    const now = after.get(key);
    const names = new Set(link.libraries.map(({ symbol }) => last(symbol)));
    const units = [...new Set(link.libraries.map(({ ecosystem, unit }) => `${ecosystem}:${unit}`))].sort().join(" + ");
    const sw6 = names.size === 1 && units.includes(" + ");
    const reason = notMarkedOf(now?.data);
    const kind = !now || now.resolution !== "ambiguous" || now.checkout
      ? "(c) other: outcome changed or site absent"
      : now.data.mergedGlobal === true
        ? "(a) one global symbol in several units (merged)"
        : reason
          ? `(b) not marked: ${reason.replace(/ \(.*\)$/, "")}`
          : "(b) not marked: no reason recorded";
    add(totals.all, kind);
    if (sw6) add(totals.sw6Group, kind);
    add((byPin[id] ??= table()), kind);
    add((byUnits[kind] ??= table()), units);
    add((byName[kind] ??= table()), [...names].sort().join(" | ") || "(no name)");
  }
}
const top = (rows, n) => Object.fromEntries(Object.entries(rows).sort((a, b) => b[1] - a[1]).slice(0, n));
console.log(JSON.stringify({
  environmentOnly: { ...environmentOnly, ok: environmentOnly.remainder === 0 },
  environmentOnlyConflicts,
  totals,
  byPin,
  byUnits: Object.fromEntries(Object.entries(byUnits).map(([kind, rows]) => [kind, top(rows, 25)])),
  byName: Object.fromEntries(Object.entries(byName).map(([kind, rows]) => [kind, top(rows, 40)])),
}, null, 1));
