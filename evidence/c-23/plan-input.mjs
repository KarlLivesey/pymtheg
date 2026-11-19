// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const [installedPath, output] = process.argv.slice(2);
const previous = JSON.parse(
  gunzipSync(readFileSync("evidence/c-20/coverage-plan-input.json.gz")),
);
const installedCoverage = JSON.parse(readFileSync(installedPath, "utf8"));
const pins = new Map(
  previous.installedCoverage.repos.map(({ id, commit }) => [id, commit]),
);
if (
  installedCoverage.repos.length !== pins.size ||
  installedCoverage.repos.some(({ id, commit }) => pins.get(id) !== commit)
)
  throw Error("Expected the same 18 paired TypeScript pins");
writeFileSync(output, gzipSync(JSON.stringify({ ...previous, installedCoverage })));
