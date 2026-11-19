// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";

const [bareFile, output, ...attempts] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const bare = read(bareFile);
const runs = attempts.map(read);
const installed = new Map();
for (const run of runs)
  for (const repo of run.repos) installed.set(repo.id, repo);
const pins = bare.repos.map((repo) => {
  const attempt = installed.get(repo.id);
  if (!attempt || repo.commit !== attempt.commit)
    throw Error(`Missing installed attempt for ${repo.id}`);
  return attempt;
});
writeFileSync(
  output,
  JSON.stringify({
    ...runs.at(-1),
    repos: bare.repos.map((repo, index) =>
      pins[index].outcome === "finished" ? pins[index] : repo,
    ),
  }),
);
writeFileSync(
  output.replace(/\.json$/, "-attempts.json"),
  JSON.stringify({ ...runs.at(-1), repos: pins }),
);
