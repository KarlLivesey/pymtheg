// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { libraryScore } from "../../scripts/sweep/coverage-rules.mjs";

const [scratch, comparison, attempts, prefix] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const { stats, additions } = read(comparison);
const candidate = new Map(read(attempts).repos.map((repo) => [repo.id, repo]));
const archived = JSON.parse(
  gunzipSync(readFileSync("evidence/c-20/coverage-plan-input.json.gz")),
);
const bare = new Map(archived.repos.map((repo) => [repo.id, repo]));
const old = new Map(
  archived.installedCoverage.repos.map((repo) => [repo.id, repo]),
);
const byPin = new Map(stats.map((row) => [row.pin, row]));
const score = (repo) =>
  libraryScore(repo.breakdown, (module) => module === "typescript");
const pair = (repo) => {
  const stats = score(repo);
  return { sites: stats.total, level2: stats.resolved + stats.symbol };
};
const coverage = [...candidate.values()].map((repo) => {
  const original = bare.get(repo.id);
  if (!original || original.commit !== repo.commit) throw Error(repo.id);
  const archivedAttempt = old.get(repo.id);
  const compared = byPin.get(repo.id);
  const usable =
    repo.outcome === "finished" && repo.install?.status === "installed";
  if (usable && typeof compared?.after !== "number")
    throw Error(`Missing matched installed graph for ${repo.id}`);
  return {
    pin: repo.id,
    bare: pair(original),
    archived: pair(
      archivedAttempt.outcome === "finished" ? archivedAttempt : original,
    ),
    ...(compared?.before !== undefined && {
      matchedBefore: { sites: compared.before, level2: compared.beforeL2 },
    }),
    installed: usable
      ? { sites: compared.after, level2: compared.afterL2 }
      : pair(original),
    gains: compared?.gainedL2 ?? 0,
    withdrawals: compared?.withdrawnL2 ?? 0,
    unchangedKeys: compared?.symbolChanges === 0,
    shared: compared?.shared,
    sharedBeforeL2: compared?.sharedBeforeL2,
    sharedAfterL2: compared?.sharedAfterL2,
    lostSites: compared?.lostSites,
    newSites: compared?.addedSites,
    install: repo.install,
    outcome: repo.outcome,
    coldStatus: repo.cold?.status,
    warmStatus: repo.warm?.status,
  };
});
writeFileSync(`${prefix}-coverage.json`, JSON.stringify(coverage));

const identity = ({ resolution, target, libraries }) => ({
  resolution,
  ...(resolution === "resolved" && { target: JSON.parse(target) }),
  ...(libraries.length && { libraries }),
});
const changes = stats.flatMap((pin) =>
  (pin.changedDefinite ?? []).map(({ file, range, name, prior, updated }) => [
    pin.pin,
    file,
    range,
    name,
    prior.kind,
    identity(prior),
    updated && { ...identity(updated), reason: updated.data?.reason },
  ]),
);
writeFileSync(
  `${prefix}-definite-changes.json.gz`,
  gzipSync(JSON.stringify(changes)),
);

const pools = [];
for (const [pin, links] of Map.groupBy(
  Object.values(additions)
    .flat()
    .filter(
      (row) =>
        row.outcome === "resolved" ||
        (row.outcome === "library" &&
          row.targets.some(({ symbol }) => typeof symbol === "string")),
    ),
  (row) => row.pin,
)) {
  const repo = candidate.get(pin);
  if (!repo?.attempt) continue;
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const lookup = db.prepare(`SELECT id,kind,
      json_extract(body,'$.range.end') AS end
    FROM graph_links WHERE module='typescript' AND file=? AND
      json_extract(body,'$.range.start')=? AND
      json_extract(body,'$.targetName')=? AND resolution=?`);
  const pool = [];
  for (const site of links.sort((a, b) => a.rank.localeCompare(b.rank))) {
    const matches = lookup.all(site.file, site.offset, site.name, site.outcome);
    if (matches.length === 1)
      pool.push({ ...site, start: site.offset, ...matches[0] });
  }
  db.close();
  if (pool.length) pools.push(pool);
}
pools.sort((a, b) => a[0].rank.localeCompare(b[0].rank));
const draw = [];
for (let i = 0; draw.length < 60 && pools.some((pool) => pool[i]); i++)
  for (const pool of pools) {
    if (pool[i]) draw.push(pool[i]);
    if (draw.length === 60) break;
  }
writeFileSync(`${prefix}-review-draw.json`, JSON.stringify(draw));
