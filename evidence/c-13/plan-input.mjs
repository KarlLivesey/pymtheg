// SPDX-License-Identifier: MIT
// plan-input.mjs OUT [CANDIDATE_EXPORT...] : the coverage plan input. Starts
// from C-23's committed input (the last full TypeScript overlay, which
// reproduces main's TypeScript / JS section) and, with candidate exports,
// replaces the pins they contain, in order. Writes OUT as gzip JSON.
// Regenerate with
//   node scripts/sweep/coverage.mjs --results OUT \
//     --base evidence/sw-3/breakdown.json.gz --plan PLAN
// and copy only the TypeScript / JS section and the two completion rows.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const [out, ...candidatePaths] = process.argv.slice(2);
const read = (path) =>
  JSON.parse(
    path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path, "utf8"),
  );
const main = read("evidence/c-23/coverage-plan-input.json.gz");
const candidates = candidatePaths.map(read);
const repos = new Map(main.repos.map((repo) => [repo.id, repo]));
for (const candidate of candidates)
  for (const repo of candidate.repos) repos.set(repo.id, repo);
writeFileSync(
  out,
  gzipSync(JSON.stringify({ ...main, repos: [...repos.values()] })),
);
