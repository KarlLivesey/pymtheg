// SPDX-License-Identifier: MIT
// Summarize the two finished coverage exports and the reference sample matches.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { libraryScore } from "../../scripts/sweep/coverage-rules.mjs";

const scratch = process.env.PYM_SCRATCH;
const read = (file) => JSON.parse(readFileSync(join(scratch, file), "utf8"));
const before = read("main-coverage.json");
const after = read("candidate-coverage.json");
const samples = JSON.parse(gunzipSync(readFileSync("evidence/sw-3/samples.json.gz"))).samples;
const main = new Map(before.repos.map((repo) => [repo.id, repo]));
const candidate = new Map(after.repos.map((repo) => [repo.id, repo]));
const finished = (repo) => repo?.outcome === "finished";
const matches = after.repos.filter((repo) => finished(repo) && finished(main.get(repo.id)));

function score(rows) {
  const rust = rows.filter(([module]) => module === "rust");
  const measure = libraryScore(rust);
  const stored = rust.filter((row) => row[2] === "library");
  const byKind = {};
  for (const row of stored) byKind[row[1]] = (byKind[row[1]] ?? 0) + row[7];
  return {
    total: measure.total, inside: measure.resolved, librarySymbol: measure.symbol,
    storedSymbol: stored.filter((row) => row[9] === 2).reduce((total, row) => total + row[7], 0),
    wholeUnit: measure.unitOnly, level2: measure.level2, byKind,
  };
}
const repos = matches.map((repo) => ({ id: repo.id, before: score(main.get(repo.id).breakdown),
  after: score(repo.breakdown), shared: repo.shared?.rust }));
const settled = samples.flatMap((sample) => {
  if (!["rust-macro", "rust-std-path", "rust-external-targets"].includes(sample.item)) return [];
  const isSettled = (fact) => sample.label === "outside" ? fact.library?.level === 2 : fact.state === "resolved";
  const current = candidate.get(sample.repo)?.checks?.[sample.key] ?? [];
  if (!current.length || !current.every(isSettled) || sample.observations.every(isSettled)) return [];
  const { item, repo, file, line, source, code } = sample;
  return [{ item, repo, file, line, source: source ?? code, targets: current }];
});
console.log(JSON.stringify({
  repos,
  before: score(matches.flatMap((repo) => main.get(repo.id).breakdown)),
  after: score(matches.flatMap((repo) => repo.breakdown)),
  shared: repos.reduce((result, { shared }) => ({ links: result.links + (shared?.links ?? 0), level2: result.level2 + (shared?.level2 ?? 0) }), { links: 0, level2: 0 }),
  unmatched: [...new Set([...main.keys(), ...candidate.keys()])].filter((id) => !finished(main.get(id)) || !finished(candidate.get(id)))
    .map((id) => ({ id, before: main.get(id)?.outcome, after: candidate.get(id)?.outcome })),
  settled,
}, null, 2));
