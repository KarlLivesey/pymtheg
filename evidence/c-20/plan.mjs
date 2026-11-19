// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const [barePath, installedPath, output] = process.argv.slice(2);
const read = (path) =>
  JSON.parse(
    path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path),
  );
const previous = read("evidence/c-16/coverage-plan-input.json.gz");
const bare = read(barePath);
const installedCoverage = read(installedPath);
// The plan also counts TypeScript files from Go and Rust pins. Keep their
// existing TypeScript observations because the paired sweep did not run them.
const repos = new Map(previous.repos.map((row) => [row.id, row]));
for (const row of bare.repos) {
  if (
    row.language !== "typescript" ||
    row.outcome !== "finished" ||
    repos.get(row.id)?.commit !== row.commit
  )
    throw Error(`Missing paired bare graph for ${row.id}`);
  repos.set(row.id, row);
}
writeFileSync(
  output,
  gzipSync(
    JSON.stringify({ ...bare, repos: [...repos.values()], installedCoverage }),
  ),
);
