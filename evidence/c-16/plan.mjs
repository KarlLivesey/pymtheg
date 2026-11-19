// SPDX-License-Identifier: MIT
// Keep the previously measured pins while overlaying the C-16 replay.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";

const read = (path) =>
  JSON.parse(
    path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path),
  );
const [source, output] = process.argv.slice(2);
const candidate = read(source);
if (
  candidate.repos.length !== 18 ||
  candidate.repos.some(
    ({ language, outcome }) =>
      language !== "typescript" || outcome !== "finished",
  )
)
  throw Error("Expected the candidate export for all 18 TypeScript pins");
const repos = new Map();
const go = read("evidence/c-14/coverage-plan-input.json.gz");
for (const packet of [
  read("evidence/sw-3/breakdown.json.gz"),
  read("evidence/c-8/coverage-plan-input.json.gz"),
  read("evidence/c-10/coverage-plan-input.json.gz"),
  { repos: go.repos.filter(({ language }) => language === "go") },
  candidate,
]) {
  for (const repo of packet.repos) repos.set(repo.id, repo);
}
writeFileSync(
  output,
  gzipSync(JSON.stringify({ ...candidate, repos: [...repos.values()] })),
);
