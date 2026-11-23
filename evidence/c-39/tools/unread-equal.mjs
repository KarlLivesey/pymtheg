// SPDX-License-Identifier: MIT
// C-39 (item 4 removed): every link that main computed in a program with an
// unread file (marked `no-unseen-declarations`) must be identical on the
// candidate: resolution, checkout target or candidates (by file and symbol
// key), library rows, and link data. Sites are matched by file, kind, start
// and target name. A difference in a file whose owning project changed is
// item 2 (the file's own config is now read), counted apart.
// Usage: node unread-equal.mjs SCRATCH MAIN.json HEAD.json
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, mainPath, headPath] = process.argv.slice(2);
const runs = [mainPath, headPath].map(
  (path) => new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((repo) => [repo.id, repo])),
);
function load(repo) {
  const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const symbolKey = (row) => {
    const symbol = JSON.parse(row.body);
    return `${row.file}\0${symbol.kind}\0${symbol.identity}\0${symbol.key}`;
  };
  const symbols = new Map(db.prepare("SELECT id, file, body FROM graph_symbols").all().map((row) => [row.id, symbolKey(row)]));
  const candidates = db.prepare("SELECT s.file, s.body FROM graph_candidates c JOIN graph_symbols s ON s.id=c.symbol WHERE c.link=?");
  const libraries = db.prepare("SELECT role, ecosystem, unit, symbol, version, evidence FROM graph_library_targets WHERE link=? ORDER BY role, ecosystem, unit, symbol");
  const projects = new Map(db.prepare("SELECT path, body FROM graph_files").all()
    .map((row) => [row.path, JSON.parse(row.body).result?.data?.project ?? null]));
  const links = new Map();
  for (const row of db.prepare("SELECT id, file, resolution, body FROM graph_links WHERE module='typescript'").iterate()) {
    const link = JSON.parse(row.body);
    links.set(`${row.file}\0${link.kind}\0${link.range.start}\0${link.targetName}`, {
      file: row.file,
      unread: Array.isArray(link.data?.assumes) && link.data.assumes.includes("no-unseen-declarations"),
      identity: JSON.stringify([
        row.resolution,
        link.targetId ? symbols.get(link.targetId) ?? null : null,
        candidates.all(row.id).map(symbolKey).sort(),
        libraries.all(row.id),
        link.data ?? null,
      ]),
    });
  }
  db.close();
  return { links, projects };
}
const out = [];
for (const [id, mainRepo] of runs[0]) {
  const headRepo = runs[1].get(id);
  if (mainRepo.outcome !== "finished" || headRepo?.outcome !== "finished") continue;
  const { links: before, projects: ownerBefore } = load(mainRepo);
  const { links: after, projects: ownerAfter } = load(headRepo);
  let unread = 0, equal = 0, differ = 0, missing = 0, constRemoved = 0, ownerChanged = 0;
  const examples = [];
  for (const [key, link] of before) {
    if (!link.unread) continue;
    unread++;
    const now = after.get(key);
    // Item 1: a const assertion stores no link on the candidate.
    if (!now && key.split("\0")[1] === "references" && key.split("\0")[3] === "const") { constRemoved++; continue; }
    if (!now) { missing++; if (examples.length < 5) examples.push(["missing", key.replaceAll("\0", " | ")]); continue; }
    if (now.identity === link.identity) equal++;
    else if (ownerBefore.get(link.file) !== ownerAfter.get(link.file)) ownerChanged++;
    else { differ++; if (examples.length < 5) examples.push(["differs", key.replaceAll("\0", " | "), link.identity.slice(0, 300), now.identity.slice(0, 300)]); }
  }
  out.push({ pin: id, unreadLinks: unread, equal, differ, missing, constRemoved, ownerChanged, examples });
}
console.log(JSON.stringify(out, null, 1));
