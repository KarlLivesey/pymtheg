// SPDX-License-Identifier: MIT
// C-57: how two cold stores of one tree (same project id, two builds: main
// and this branch) differ, link by link. A Level 2 link is resolved, or a
// library target with a symbol. Counts Level 2 links lost and gained,
// targets changed, resolutions changed otherwise, and links whose data
// alone changed, with a few examples of each.
//   node evidence/c-57/link-diff.mjs <before.sqlite> <after.sqlite> <out.json>
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const [before, after, out] = process.argv.slice(2);
if (!out)
  throw Error("usage: link-diff.mjs <before.sqlite> <after.sqlite> <out.json>");

function links(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const targets = new Map();
    for (const row of db
      .prepare(
        "SELECT link, ecosystem, unit, symbol FROM graph_library_targets WHERE role='target'",
      )
      .iterate())
      targets.set(row.link, {
        key: `${row.ecosystem} ${row.unit} ${row.symbol ?? ""}`,
        symbol: row.symbol !== null,
      });
    const map = new Map();
    for (const row of db
      .prepare(
        "SELECT id, file, kind, resolution, target, body FROM graph_links WHERE module='rust'",
      )
      .iterate()) {
      const library = targets.get(row.id);
      map.set(row.id, {
        file: row.file,
        kind: row.kind,
        name: JSON.parse(row.body).targetName,
        resolution: row.resolution,
        target:
          row.resolution === "library" ? (library?.key ?? null) : row.target,
        level2:
          row.resolution === "resolved" ||
          (row.resolution === "library" && !!library?.symbol),
        body: row.body,
      });
    }
    return map;
  } finally {
    db.close();
  }
}

const a = links(before),
  b = links(after);
const counts = {
  linksBefore: a.size,
  linksAfter: b.size,
  onlyBefore: 0,
  onlyAfter: 0,
  lostLevel2: 0,
  gainedLevel2: 0,
  targetChanged: 0,
  resolutionChanged: 0,
  dataOnly: 0,
};
const examples = {};
const note = (kind, x, y) => {
  counts[kind]++;
  const list = (examples[kind] ??= []);
  if (list.length < 10)
    list.push({
      file: (x ?? y).file,
      kind: (x ?? y).kind,
      name: (x ?? y).name,
      before: x ? `${x.resolution} ${x.target ?? ""}` : null,
      after: y ? `${y.resolution} ${y.target ?? ""}` : null,
    });
};
for (const [id, x] of a) {
  const y = b.get(id);
  if (!y) {
    note("onlyBefore", x, null);
    continue;
  }
  if (x.level2 && !y.level2) note("lostLevel2", x, y);
  else if (!x.level2 && y.level2) note("gainedLevel2", x, y);
  else if (x.level2 && y.level2 && x.target !== y.target)
    note("targetChanged", x, y);
  else if (x.resolution !== y.resolution || x.target !== y.target)
    note("resolutionChanged", x, y);
  else if (x.body !== y.body) note("dataOnly", x, y);
}
for (const [id, y] of b) if (!a.has(id)) note("onlyAfter", null, y);
writeFileSync(out, JSON.stringify({ counts, examples }, null, 1));
console.log(JSON.stringify(counts));
