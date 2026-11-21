// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";

const [bareFile, installedFile, output] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const bare = read(bareFile);
const installed = read(installedFile);
const byPin = new Map(installed.repos.map((repo) => [repo.id, repo]));
if (bare.repos.length !== 18 || byPin.size !== 18)
  throw Error("Expected matching 18-pin sweeps");
const repos = bare.repos.map((repo) => {
  const other = byPin.get(repo.id);
  if (other?.commit !== repo.commit) throw Error(`Pin mismatch ${repo.id}`);
  return other.outcome === "finished" && other.install?.status === "installed"
    ? other
    : repo;
});
writeFileSync(output, JSON.stringify({ ...installed, mode: "paired", repos }));
