// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

const [scratch, prior, candidate, prefix, ...pins] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const next = new Map(read(candidate).repos.map((repo) => [repo.id, repo]));
function libraryRows(repo) {
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const sites = new Map();
  try {
    const rows = db.prepare(`
      SELECT l.id, l.file, l.kind, l.origin, l.resolution,
             json_extract(l.body, '$.range.start') AS start,
             json_extract(l.body, '$.range.end') AS end,
             json_extract(l.body, '$.targetName') AS name,
             json_extract(s.body, '$.key') AS source,
             json_extract(s.body, '$.ordinal') AS ordinal,
             t.ecosystem, t.unit, t.symbol, t.version, t.evidence
      FROM graph_library_targets t JOIN graph_links l ON l.id=t.link
      LEFT JOIN graph_symbols s ON s.id=l.source
      WHERE l.module='typescript' AND t.symbol IS NOT NULL
    `);
    for (const row of rows.iterate()) {
      const { ecosystem, unit, symbol, version, evidence, ...site } = row;
      const key = JSON.stringify([
        site.file,
        site.kind,
        site.origin,
        site.start,
        site.end,
        site.name,
        site.source,
        site.ordinal,
      ]);
      const group = sites.get(key) ?? { ...site, targets: [] };
      if (group.id !== site.id)
        throw Error(`Duplicate library site in ${repo.id}`);
      group.targets.push({ ecosystem, unit, symbol, version, evidence });
      sites.set(key, group);
    }
    return sites;
  } finally {
    db.close();
  }
}

const route = ({ ecosystem, unit, version }) =>
  JSON.stringify([ecosystem, unit, version]);
const identity = (target) => JSON.stringify([route(target), target.symbol]);
const matchesQualified = (old, current) =>
  route(old) === route(current) &&
  current.symbol.endsWith(`:${old.symbol}`) &&
  /\.d\.(?:ts|mts|cts):/.test(current.symbol.slice(0, -old.symbol.length));
const stats = [];
const renamed = [];
const other = [];
for (const repo of read(prior).repos) {
  if (pins.length && !pins.includes(repo.id)) continue;
  if (repo.outcome !== "finished" || repo.install?.status !== "installed")
    continue;
  const replacement = next.get(repo.id);
  if (replacement?.outcome !== "finished" || replacement.commit !== repo.commit)
    throw Error(`Missing matched graph for ${repo.id}`);
  const before = libraryRows(repo);
  const after = libraryRows(replacement);
  const count = {
    pin: repo.id,
    distinctNamesQualified: 0,
    unchanged: 0,
    priorNamesQualified: 0,
    qualifiedRows: 0,
    qualifiedSites: 0,
    factoryRows: 0,
    otherRemoved: 0,
    otherAdded: 0,
    splits: 0,
  };
  const names = new Set();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(key);
    const current = after.get(key);
    const original = old?.targets ?? [];
    const updated = current?.targets ?? [];
    const removed = original.filter(
      (target) => !updated.some((next) => identity(next) === identity(target)),
    );
    const added = updated.filter(
      (target) => !original.some((old) => identity(old) === identity(target)),
    );
    count.unchanged += original.length - removed.length;
    const qualified = added.filter((next) =>
      removed.some((old) => matchesQualified(old, next)),
    );
    const previous = removed.filter((old) =>
      qualified.some((next) => matchesQualified(old, next)),
    );
    const otherRemoved = removed.filter((target) => !previous.includes(target));
    const otherAdded = added.filter((target) => !qualified.includes(target));
    count.otherRemoved += otherRemoved.length;
    count.otherAdded += otherAdded.length;
    const site = { pin: repo.id, ...(current ?? old) };
    delete site.targets;
    if (qualified.length) {
      for (const target of previous) names.add(identity(target));
      count.priorNamesQualified += previous.length;
      count.qualifiedRows += qualified.length;
      count.qualifiedSites++;
      count.factoryRows += previous.filter(({ symbol }) =>
        symbol.startsWith("ReturnType<typeof "),
      ).length;
      if (qualified.length > previous.length) count.splits++;
      renamed.push({
        ...site,
        previous,
        qualified,
        beforeResolution: old.resolution,
        rank: createHash("sha256")
          .update("pymtheg-c23-qualified-2026")
          .update(repo.id)
          .update(key)
          .digest("hex"),
      });
    }
    if (otherRemoved.length || otherAdded.length)
      other.push({ ...site, previous: otherRemoved, updated: otherAdded });
  }
  count.distinctNamesQualified = names.size;
  stats.push(count);
}
const pools = [
  ...Map.groupBy(
    renamed.sort((a, b) => a.rank.localeCompare(b.rank)),
    (site) => site.pin,
  ).values(),
];
const draw = [];
for (let i = 0; draw.length < 60 && pools.some((pool) => pool[i]); i++)
  for (const pool of pools) {
    if (pool[i]) draw.push(pool[i]);
    if (draw.length === 60) break;
  }
writeFileSync(
  prefix + "-names.json.gz",
  gzipSync(JSON.stringify({ stats, renamed, other })),
);
writeFileSync(prefix + "-draw.json", JSON.stringify(draw));
console.log(JSON.stringify(stats, null, 2));
