// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { libraryScore } from "../../scripts/sweep/coverage-rules.mjs";

const scratch = process.env.PYM_SCRATCH;
const archived = JSON.parse(
  gunzipSync(readFileSync("evidence/sw-3/breakdown.json.gz")),
);
const read = (name) => JSON.parse(readFileSync(join(scratch, name), "utf8"));
const group = (packet) => new Map(packet.repos.map((repo) => [repo.id, repo]));
const base = group(archived);
const release = group(read("release-coverage.json"));
const main = group(read("main-coverage.json"));
const candidateAgainstRelease = group(read("candidate-coverage.json"));
const candidate = group(read("candidate-main-coverage.json"));
const isTS = (module) => module === "typescript";
function score(rows) {
  const measures = libraryScore(rows, isTS);
  const stored = rows.filter(
    (row) => row[0] === "typescript" && row[2] === "library",
  );
  const storedLevel = (level) =>
    stored.reduce((sum, row) => sum + (row[9] === level ? row[7] : 0), 0);
  return {
    all: measures.total,
    checkout: measures.resolved,
    named: measures.symbol,
    level2: measures.level2,
    storedSymbol: storedLevel(2),
    storedUnitOnly: storedLevel(1),
  };
}
const aggregate = (ids, data) =>
  score(ids.flatMap((id) => data.get(id)?.breakdown ?? []));
const shared = (ids, data) =>
  ids.reduce(
    (result, id) => {
      const row = data.get(id)?.shared?.typescript;
      result.links += row?.links ?? 0;
      result.level2 += row?.level2 ?? 0;
      return result;
    },
    { links: 0, level2: 0 },
  );
const ids = [...candidate.keys()].filter(
  (id) =>
    candidate.get(id).outcome === "finished" &&
    main.get(id)?.outcome === "finished",
);
const releaseIds = [...release.keys()].filter(
  (id) => release.get(id).outcome === "finished",
);
const matchedReleaseIds = releaseIds.filter(
  (id) => candidate.has(id) && candidate.get(id).outcome === "finished",
);
const baselineDifferences = releaseIds.flatMap((id) => {
  const expected = score(base.get(id)?.breakdown ?? []);
  const actual = score(release.get(id).breakdown);
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : [{ id, expected, actual }];
});
const sampleItems = new Set(["ts-runtime", "ts-package", "ts-package-chain"]);
const samples = JSON.parse(
  gunzipSync(readFileSync("evidence/sw-3/samples.json.gz")),
).samples;
const settled = samples.flatMap((sample) => {
  if (!sampleItems.has(sample.item)) return [];
  const current = candidate.get(sample.repo)?.checks?.[sample.key] ?? [];
  if (!current.length || !current.every((row) => row.library?.level === 2))
    return [];
  const { item, repo, file, line, source, code } = sample;
  return [
    {
      item,
      repo,
      file,
      line,
      source: source ?? code,
      targets: current.map((row) => row.library),
    },
  ];
});
const losses = {};
for (const [id, repo] of candidateAgainstRelease)
  for (const [category, { count, examples }] of Object.entries(
    repo.legacyTypeScriptLosses ?? {},
  )) {
    const row = (losses[category] ??= { count: 0, examples: [] });
    row.count += count;
    if (row.examples.length < 7)
      row.examples.push(...examples.map((site) => ({ repo: id, ...site })));
  }

console.log(
  JSON.stringify(
    {
      main: {
        ids,
        before: aggregate(ids, main),
        after: aggregate(ids, candidate),
        sharedBefore: shared(ids, main),
        sharedAfter: shared(ids, candidate),
      },
      release: {
        ids: matchedReleaseIds,
        before: aggregate(matchedReleaseIds, release),
        after: aggregate(matchedReleaseIds, candidate),
        sharedBefore: shared(matchedReleaseIds, release),
        sharedAfter: shared(matchedReleaseIds, candidateAgainstRelease),
        baselineDifferences,
      },
      byRepo: [...candidate].map(([id, row]) => ({
        id,
        main: main.get(id)?.outcome,
        candidate: row.outcome,
        before: score(main.get(id)?.breakdown ?? []),
        after: score(row.breakdown ?? []),
      })),
      settled,
      losses,
    },
    null,
    2,
  ),
);
