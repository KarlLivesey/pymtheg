// transitions.mjs SCRATCH BASE_RUN CAND_RUN ID OUT [SAMPLE] : for one pin,
// every link site whose outcome or library-target rows differ between the
// two runs, counted by (before -> after) resolution, and a fixed-seed
// ("c13") sample of the sites that gained library credit, with the source
// line, for the hand-check.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, baseRun, candRun, id, out, sampleSize = "20"] = process.argv.slice(2);
const attempt = (path) => JSON.parse(readFileSync(path, "utf8")).repos.find((r) => r.id === id).attempt;
const load = (run) => {
  const checkout = join(scratch, attempt(run), "checkout");
  const db = new DatabaseSync(join(checkout, ".pymtheg", "rebuildable", "graph.sqlite"), { readOnly: true });
  const libraries = new Map();
  for (const r of db.prepare("SELECT link, role, unit, symbol, evidence FROM graph_library_targets").iterate())
    (libraries.get(r.link) ?? libraries.set(r.link, []).get(r.link)).push(`${r.role}|${r.unit}|${r.symbol ?? ""}|${r.evidence}`);
  const links = new Map();
  for (const row of db.prepare("SELECT id, resolution, body FROM graph_links").iterate()) {
    const l = JSON.parse(row.body);
    let site = [l.module, l.file, l.kind, l.range.start, l.range.end, l.targetName].join("|");
    while (links.has(site)) site += "+";
    links.set(site, { file: l.file, start: l.range.start, kind: l.kind, targetName: l.targetName, resolution: row.resolution, libraries: (libraries.get(row.id) ?? []).sort(), reason: l.data?.reason ?? null });
  }
  db.close();
  return { checkout, links };
};
const before = load(baseRun);
const after = load(candRun);
const transitions = {};
const gained = [];
for (const [site, a] of after.links) {
  const b = before.links.get(site);
  const from = b ? `${b.resolution}${b.libraries.length ? "+library" : ""}` : "(new site)";
  const to = `${a.resolution}${a.libraries.length ? "+library" : ""}`;
  if (b && from === to && JSON.stringify(b.libraries) === JSON.stringify(a.libraries)) continue;
  const key = `${from} -> ${to}`;
  transitions[key] = (transitions[key] ?? 0) + 1;
  if (a.libraries.length && (!b || !b.libraries.length))
    gained.push({ site, link: a, rank: createHash("sha256").update("c13|" + site).digest("hex") });
}
for (const [site, b] of before.links)
  if (!after.links.has(site)) transitions["(site removed)"] = (transitions["(site removed)"] ?? 0) + 1;
gained.sort((x, y) => (x.rank < y.rank ? -1 : 1));
const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;
const sample = gained.slice(0, Number(sampleSize)).map(({ link }) => {
  const text = readFileSync(join(after.checkout, link.file), "utf8");
  const line = lineOf(text, link.start);
  return { file: link.file, line, kind: link.kind, targetName: link.targetName, resolution: link.resolution, libraries: link.libraries, code: text.split("\n")[line - 1].trim().slice(0, 200) };
});
writeFileSync(out, JSON.stringify({ id, transitions, gainedLibrary: gained.length, sample }, null, 2) + "\n");
console.log(JSON.stringify({ transitions, gainedLibrary: gained.length }));
