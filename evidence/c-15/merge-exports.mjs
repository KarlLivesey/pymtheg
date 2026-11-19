// SPDX-License-Identifier: MIT
// Join coverage-export.mjs outputs of separate runs of one build:
//   node merge-exports.mjs OUT.json EXPORT.json...
// Keeps the first export's header and every repository row (later wins).
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...inputs] = process.argv.slice(2);
const exports = inputs.map((path) => JSON.parse(readFileSync(path, "utf8")));
const repos = new Map();
for (const e of exports) for (const repo of e.repos) repos.set(repo.id, repo);
writeFileSync(
  out,
  JSON.stringify({
    ...exports[0],
    repos: [...repos.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
  }),
);
console.log(`${repos.size} repositories`);
