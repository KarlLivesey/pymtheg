// SPDX-License-Identifier: MIT
// Compare every TypeScript symbol and link in three corpus checkouts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sampleKey } from "../../scripts/sweep/coverage-rules.mjs";

const scratch = process.env.PYM_SCRATCH;
const attempts = (name) =>
  new Map(
    JSON.parse(
      readFileSync(join(scratch, `${name}-run.json`), "utf8"),
    ).repos.map((repo) => [repo.id, repo]),
  );
const main = attempts("main");
const [build, ...selected] = process.argv.slice(2);
const candidate = attempts(build);
const database = (repo) =>
  new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
const parse = ({ body, ...rest }) => ({ ...JSON.parse(body), ...rest });
const sourceKey = (symbol) =>
  JSON.stringify([symbol.file, symbol.key, symbol.ordinal]);
const inventory = (db) =>
  db
    .prepare(
      "SELECT path FROM graph_files WHERE json_extract(body,'$.module')='typescript'",
    )
    .all()
    .map(({ path }) => path);
const links = (db) =>
  db.prepare(`SELECT l.body,l.kind,l.module,l.resolution,
  json_array(s.file,json_extract(s.body,'$.key'),json_extract(s.body,'$.ordinal')) AS target
  FROM graph_links l INDEXED BY graph_link_file LEFT JOIN graph_symbols s ON s.id=l.target
  WHERE l.module='typescript' AND l.file=?`);
const symbols = (db) =>
  db.prepare(
    "SELECT body FROM graph_symbols WHERE file=? AND json_extract(body,'$.module')='typescript'",
  );

for (const id of selected) {
  const old = main.get(id);
  const next = candidate.get(id);
  if (
    old?.outcome !== "finished" ||
    next?.outcome !== "finished" ||
    old.commit !== next.commit
  )
    throw Error(`Missing comparable graphs for ${id}`);
  const before = database(old);
  const after = database(next);
  const result = {
    id,
    symbols: 0,
    symbolsAdded: 0,
    symbolsRemoved: 0,
    links: 0,
    linksAdded: 0,
    linksRemoved: 0,
    definite: 0,
    changed: [],
  };
  try {
    const files = new Set([...inventory(before), ...inventory(after)]);
    const oldSymbols = symbols(before),
      newSymbols = symbols(after);
    const oldLinks = links(before),
      newLinks = links(after);
    for (const file of files) {
      const oldKeys = new Set(
        oldSymbols.all(file).map((row) => sourceKey(parse(row))),
      );
      const newKeys = new Set(
        newSymbols.all(file).map((row) => sourceKey(parse(row))),
      );
      result.symbols += oldKeys.size;
      for (const key of newKeys) if (!oldKeys.has(key)) result.symbolsAdded++;
      for (const key of oldKeys) if (!newKeys.has(key)) result.symbolsRemoved++;
      const map = (statement) => {
        const sites = new Map();
        for (const row of statement.all(file)) {
          const link = parse(row);
          const key = sampleKey(old, link);
          const at = sites.get(key) ?? [];
          at.push(link);
          sites.set(key, at);
        }
        return sites;
      };
      const oldSites = map(oldLinks),
        newSites = map(newLinks);
      for (const [site, values] of newSites)
        result.linksAdded += Math.max(
          0,
          values.length - (oldSites.get(site)?.length ?? 0),
        );
      for (const [site, values] of oldSites) {
        const replacements = newSites.get(site) ?? [];
        const nextTargets = replacements
          .filter(({ resolution }) => resolution === "resolved")
          .map(({ target }) => target);
        result.links += values.length;
        result.linksRemoved += Math.max(0, values.length - replacements.length);
        for (const { resolution, target, targetName, range } of values) {
          if (resolution !== "resolved") continue;
          result.definite++;
          const at = nextTargets.indexOf(target);
          if (at >= 0) nextTargets.splice(at, 1);
          else
            result.changed.push({
              file,
              range,
              targetName,
              target: JSON.parse(target),
              candidate: replacements.map(({ resolution, target, data }) => ({
                resolution,
                target: JSON.parse(target),
                reason: data?.reason,
              })),
            });
        }
      }
    }
  } finally {
    before.close();
    after.close();
  }
  console.log(JSON.stringify(result));
}
