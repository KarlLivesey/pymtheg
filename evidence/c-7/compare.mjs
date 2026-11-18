// SPDX-License-Identifier: MIT
// Compare finished pinned graphs from main and the candidate in PYM_SCRATCH.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  libraryScore,
  sampleKey,
} from "../../scripts/sweep/coverage-rules.mjs";

const scratch = process.env.PYM_SCRATCH;
const read = (file) => JSON.parse(readFileSync(join(scratch, file), "utf8"));
const main = read("main-run.json");
const candidate = read(process.argv[2] ?? "candidate-run.json");
const mainCoverage = read("main-coverage.json");
const candidateCoverage = read("candidate-coverage.json");
const mainByRepo = new Map(main.repos.map((row) => [row.id, row]));
const seed = "c-7:4c3bed4d";
const changed = [];
const missingSymbols = [];
const samples = new Map();
const repositories = [];
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dbFor = (repo) =>
  new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
const statement = (db) =>
  db.prepare(`
    SELECT l.body, l.resolution, s.body AS target FROM graph_links AS l INDEXED BY graph_link_file
    LEFT JOIN graph_symbols AS s ON s.id = l.target
    WHERE l.file=? AND l.module='typescript'`);
const linksFor = (statement, file) =>
  statement.all(file).map(({ body, target, resolution }) => ({
    ...JSON.parse(body),
    resolution,
    target: target ? JSON.parse(target) : undefined,
  }));
const symbolsFor = (db) =>
  db.prepare(`
  SELECT kind, json_extract(body,'$.identity') AS identity,
    json_extract(body,'$.ordinal') AS ordinal, json_extract(body,'$.key') AS key
  FROM graph_symbols WHERE file=? AND json_extract(body,'$.module')='typescript'`);
const sourceFiles = (db) =>
  db
    .prepare(
      `
  SELECT path FROM graph_files WHERE json_extract(body,'$.module')='typescript'`,
    )
    .all()
    .map(({ path }) => path);
const label = (symbol) =>
  symbol && [symbol.file, symbol.kind, symbol.identity, symbol.ordinal];
const targetKey = (symbol) => JSON.stringify(label(symbol));
const symbolKey = ({ kind, identity, ordinal, key }) =>
  JSON.stringify([kind, identity, ordinal, key]);
const verified = (link) =>
  link.resolution === "resolved" && !link.data?.assumes?.length;
const score = (coverage, id) =>
  libraryScore(
    coverage.repos.find((row) => row.id === id).breakdown ?? [],
    (module) => module === "typescript",
  );
const share = ({ level2, symbol, resolved, total }) => ({
  level2,
  covered: symbol + resolved,
  links: total,
});
const small = (row) => row && { outcome: row.outcome, failure: row.failure };

const remember = (group, rank, site) => {
  const hits = samples.get(group) ?? [];
  if (hits.length < 10 || rank < hits.at(-1).rank) {
    hits.push({ rank, ...site() });
    hits.sort((a, b) => compare(a.rank, b.rank));
    if (hits.length > 10) hits.pop();
    samples.set(group, hits);
  }
};

for (const repo of candidate.repos) {
  const previous = mainByRepo.get(repo.id);
  if (previous?.commit !== repo.commit)
    throw Error(`Unexpected pin for ${repo.id}`);
  const record = { repo: repo.id, commit: repo.commit };
  repositories.push(record);
  if (previous.outcome !== "finished" || repo.outcome !== "finished") {
    record.main = small(previous);
    record.candidate = small(repo);
    continue;
  }
  const priorCoverage = mainCoverage.repos.find((row) => row.id === repo.id);
  const afterCoverage = candidateCoverage.repos.find(
    (row) => row.id === repo.id,
  );
  record.before = share(score(mainCoverage, repo.id));
  record.after = share(score(candidateCoverage, repo.id));
  record.shared = [
    priorCoverage.shared?.typescript,
    afterCoverage.shared?.typescript,
  ];
  const oldDb = dbFor(previous);
  const newDb = dbFor(repo);
  try {
    const oldLinks = statement(oldDb),
      newLinks = statement(newDb);
    const oldSymbols = symbolsFor(oldDb),
      newSymbols = symbolsFor(newDb);
    const texts = newDb.prepare(
      "SELECT json_extract(body, '$.text') AS text FROM graph_files WHERE path=?",
    );
    const position = (offset, file) => {
      const text = texts.get(file)?.text ?? "";
      const line = text.slice(0, offset).split("\n").length;
      const start = text.lastIndexOf("\n", offset - 1) + 1;
      const end = text.indexOf("\n", offset);
      const from = Math.max(start, offset - 100);
      return {
        line,
        offset,
        code: text
          .slice(from, end < 0 ? from + 200 : Math.min(end, from + 200))
          .trim(),
      };
    };
    Object.assign(record, {
      oldSymbols: 0,
      newSymbols: 0,
      lostSymbols: 0,
      priorDefinite: 0,
      changedDefinite: 0,
      newSites: 0,
      removedSites: 0,
      gains: {},
    });
    for (const file of new Set([
      ...sourceFiles(oldDb),
      ...sourceFiles(newDb),
    ])) {
      const oldKeys = oldSymbols.all(file);
      const newKeys = new Set(newSymbols.all(file).map(symbolKey));
      record.oldSymbols += oldKeys.length;
      record.newSymbols += newKeys.size;
      for (const symbol of oldKeys)
        if (!newKeys.has(symbolKey(symbol))) {
          record.lostSymbols++;
          missingSymbols.push({ repo: repo.id, file, ...symbol });
        }
      const keyOf = (link) => sampleKey(repo, link);
      const before = Map.groupBy(linksFor(oldLinks, file), keyOf);
      const after = Map.groupBy(linksFor(newLinks, file), keyOf);
      for (const [key, links] of before) {
        const next = after.get(key) ?? [];
        record.removedSites += Math.max(links.length - next.length, 0);
        for (const link of links) {
          if (link.resolution !== "resolved") continue;
          record.priorDefinite++;
          const same = next.some(
            (n) =>
              n.resolution === "resolved" &&
              targetKey(n.target) === targetKey(link.target) &&
              (!verified(link) || verified(n)),
          );
          if (same) continue;
          record.changedDefinite++;
          changed.push({
            repo: repo.id,
            file,
            ...position(link.range.start, file),
            kind: link.kind,
            at: link.targetName,
            before: label(link.target),
            after: next.map((n) => ({
              outcome: n.resolution,
              target: label(n.target),
              reason: n.data?.reasonWithoutConfig ?? n.data?.reason,
              assumes: n.data?.assumes,
            })),
          });
        }
      }
      for (const [key, links] of after) {
        const previous = before.get(key) ?? [];
        record.newSites += Math.max(links.length - previous.length, 0);
        if (
          !previous.length ||
          previous.some((link) => link.resolution === "resolved")
        )
          continue;
        for (const link of links.filter(verified)) {
          const generic = link.data?.localBinding;
          const group = generic ? "generic" : "member";
          record.gains[group] = (record.gains[group] ?? 0) + 1;
          const rank = createHash("sha256")
            .update(seed + key)
            .digest("hex");
          remember(group, rank, () => ({
            repo: repo.id,
            file,
            ...position(link.range.start, file),
            use: link.targetName,
            before: previous.map(
              (link) => link.data?.reason ?? link.resolution,
            ),
            target: label(link.target),
            binding: generic?.name,
            declaration: position(
              generic?.start ?? link.target.range.start,
              link.target.file,
            ),
          }));
        }
      }
    }
  } finally {
    oldDb.close();
    newDb.close();
  }
  // A full multiset match makes the all-site scores the shared-site scores.
  if (!record.newSites && !record.removedSites)
    record.shared = [record.before, record.after].map(({ covered, links }) => ({
      level2: covered,
      links,
    }));
}
writeFileSync(
  join(scratch, "comparison.json"),
  JSON.stringify(
    {
      seed,
      repositories,
      changed,
      missingSymbols,
      samples: Object.fromEntries(samples),
    },
    null,
    2,
  ) + "\n",
);
