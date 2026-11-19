// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const [base, bareFile, installedFile, output] = process.argv.slice(2);
const read = (file) =>
  JSON.parse(
    file.endsWith(".gz")
      ? gunzipSync(readFileSync(file))
      : readFileSync(file, "utf8"),
  );
const previous = read(base);
const bare = read(bareFile);
const installedCoverage = read(installedFile);
const pins = new Map(previous.repos.map((repo) => [repo.id, repo]));
for (const repo of [...bare.repos, ...installedCoverage.repos]) {
  const pin = pins.get(repo.id);
  if (
    pin?.commit !== repo.commit ||
    repo.language !== "typescript" ||
    pin.language !== "typescript"
  )
    throw Error(`Unexpected TypeScript pin ${repo.id}`);
}
const updated = new Map(bare.repos.map((repo) => [repo.id, repo]));
if (updated.size !== 18 || installedCoverage.repos.length !== 18)
  throw Error("Expected the paired 18-pin TypeScript sweep");
const repos = previous.repos.map((repo) => updated.get(repo.id) ?? repo);
writeFileSync(
  output,
  gzipSync(JSON.stringify({ ...previous, repos, installedCoverage })),
);
