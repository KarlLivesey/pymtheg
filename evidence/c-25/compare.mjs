// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

const [scratch, beforePath, afterPath, prefix, seed, sizeText, ...pins] =
  process.argv.slice(2);
const size = Number(sizeText);
if (!seed || !Number.isSafeInteger(size) || size < 0)
  throw Error("Expected SCRATCH BEFORE AFTER PREFIX SEED SIZE [PIN…]");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const output = new Map(read(afterPath).repos.map((repo) => [repo.id, repo]));
const open = (repo) =>
  new DatabaseSync(
    resolve(
      scratch,
      repo.attempt,
      "checkout/.pymtheg/rebuildable/graph.sqlite",
    ),
    { readOnly: true },
  );
const setup = (db) => ({
  files: db.prepare("SELECT path, body FROM graph_files"),
  links: db.prepare(`SELECT l.kind, l.origin, l.resolution, l.body,
    json_array(json_extract(s.body,'$.key'),json_extract(s.body,'$.ordinal')) AS source,
    json_array(t.file,json_extract(t.body,'$.key'),json_extract(t.body,'$.ordinal')) AS target,
    json_extract(t.body,'$.range.start') AS targetStart,
    (SELECT json_group_array(json_array(ecosystem,unit,symbol,version))
       FROM graph_library_targets WHERE link=l.id) AS libraries
    FROM graph_links l INDEXED BY graph_link_file
    LEFT JOIN graph_symbols s ON s.id=l.source
    LEFT JOIN graph_symbols t ON t.id=l.target
    WHERE l.file=? AND l.module='typescript' ORDER BY l.id`),
  symbols: db.prepare(`SELECT file,json_extract(body,'$.key') AS key,
    json_extract(body,'$.ordinal') AS ordinal,kind FROM graph_symbols
    WHERE json_extract(body,'$.module')='typescript' ORDER BY file,key,ordinal,kind`),
});
const parseLink = ({ body, target, libraries, ...rest }) => {
  const link = JSON.parse(body);
  return {
    ...rest,
    range: link.range,
    name: link.targetName,
    data: link.data,
    target: JSON.parse(target),
    libraries: JSON.parse(libraries),
  };
};
const keyOf = ({ source, kind, origin, range, name }) =>
  JSON.stringify([source, kind, origin, range?.start, range?.end, name]);
const level2 = ({ resolution, libraries }) =>
  resolution === "resolved" ||
  (resolution === "library" && libraries.some((target) => target[2] !== null));
const definite = ({ resolution }) =>
  resolution === "resolved" || resolution === "library";
const answer = ({ resolution, target, libraries }) =>
  JSON.stringify([resolution, target, libraries]);
function noteOf(link) {
  const direct = link.data?.unbuiltEntry;
  if (direct) return direct;
  const variants = Object.values(link.data?.byProject ?? {});
  const notes = variants.map((variant) => variant.unbuiltEntry).filter(Boolean);
  return notes.length &&
    notes.every((note) => JSON.stringify(note) === JSON.stringify(notes[0]))
    ? notes[0]
    : undefined;
}
const saved = [];
const changes = [];
const stats = [];

for (const repo of read(beforePath).repos) {
  if (pins.length && !pins.includes(repo.id)) continue;
  const replacement = output.get(repo.id);
  if (repo.outcome !== "finished" || replacement?.outcome !== "finished") {
    stats.push({
      pin: repo.id,
      beforeOutcome: repo.outcome,
      afterOutcome: replacement?.outcome,
    });
    continue;
  }
  if (repo.commit !== replacement.commit)
    throw Error(`Mismatched pin ${repo.id}`);
  const before = open(repo);
  const after = open(replacement);
  const a = setup(before);
  const b = setup(after);
  const symbols = a.symbols.all();
  const count = {
    pin: repo.id,
    before: 0,
    after: 0,
    beforeL2: 0,
    afterL2: 0,
    shared: 0,
    sharedBeforeL2: 0,
    sharedAfterL2: 0,
    lostSites: 0,
    newSites: 0,
    withdrawals: 0,
    definiteChanges: 0,
    checkoutSymbols: symbols.length,
    symbolKeysMatch:
      JSON.stringify(symbols) === JSON.stringify(b.symbols.all()),
    gainsByProof: {},
  };
  const files = new Map(
    a.files.all().map(({ path, body }) => [path, JSON.parse(body).text]),
  );
  for (const { path, body } of b.files.iterate())
    if (!files.has(path)) files.set(path, JSON.parse(body).text);
  for (const [file, text] of files) {
    const previous = a.links.all(file).map(parseLink);
    const next = b.links.all(file).map(parseLink);
    count.before += previous.length;
    count.after += next.length;
    count.beforeL2 += previous.filter(level2).length;
    count.afterL2 += next.filter(level2).length;
    const current = Map.groupBy(next, keyOf);
    for (const old of previous) {
      const key = keyOf(old);
      const choices = current.get(key);
      const exact = choices?.findIndex(
        (value) => answer(value) === answer(old),
      );
      const updated = choices?.splice(exact >= 0 ? exact : 0, 1)[0];
      if (updated) {
        count.shared++;
        if (level2(old)) count.sharedBeforeL2++;
        if (level2(updated)) count.sharedAfterL2++;
      } else count.lostSites++;
      if (level2(old) && (!updated || !level2(updated))) count.withdrawals++;
      if ((!updated || exact < 0) && definite(old)) {
        count.definiteChanges++;
        changes.push([
          repo.id,
          file,
          old.range,
          old.kind,
          old.name,
          {
            resolution: old.resolution,
            target: old.target,
            libraries: old.libraries,
          },
          updated && {
            resolution: updated.resolution,
            target: updated.target,
            libraries: updated.libraries,
            reason: updated.data?.reason,
            unbuiltEntry: noteOf(updated),
          },
        ]);
      }
      if (!updated || level2(old) || !level2(updated)) continue;
      const note = noteOf(updated);
      const proof = note?.proof ?? "unmarked";
      count.gainsByProof[proof] = (count.gainsByProof[proof] ?? 0) + 1;
      if (!note) continue;
      const line = text.slice(0, old.range.start).split("\n").length;
      const declaration = files.get(updated.target[0]);
      const targetLine = declaration
        ?.slice(0, updated.targetStart)
        .split("\n").length;
      saved.push({
        pin: repo.id,
        file,
        line,
        kind: old.kind,
        name: old.name,
        offset: old.range.start,
        snippet: text.split("\n")[line - 1].trim().slice(0, 180),
        prior: old.data?.reason ?? old.resolution,
        target: updated.target,
        targetLine,
        targetSnippet: targetLine
          ? declaration.split("\n")[targetLine - 1].trim().slice(0, 180)
          : undefined,
        note,
        rank: createHash("sha256")
          .update(JSON.stringify([seed, repo.id, file, key]))
          .digest("hex"),
      });
    }
    count.newSites += [...current.values()].reduce(
      (sum, entries) => sum + entries.length,
      0,
    );
  }
  before.close();
  after.close();
  stats.push(count);
}

const pools = [
  ...Map.groupBy(
    saved.sort((a, b) => a.rank.localeCompare(b.rank)),
    (row) => row.pin,
  ).values(),
];
const draw = [];
for (let i = 0; draw.length < size && pools.some((pool) => pool[i]); i++) {
  for (const pool of pools) {
    if (pool[i]) draw.push(pool[i]);
    if (draw.length === size) break;
  }
}
writeFileSync(`${prefix}-stats.json`, JSON.stringify(stats, null, 2) + "\n");
writeFileSync(`${prefix}-draw.json`, JSON.stringify(draw, null, 2) + "\n");
writeFileSync(`${prefix}-changes.json.gz`, gzipSync(JSON.stringify(changes)));
