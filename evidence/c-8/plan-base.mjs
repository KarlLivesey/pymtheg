// SPDX-License-Identifier: MIT
// C-8 evidence: the inputs the plan's generated block is built from. Starts
// from one file and lays further exports over it in order (a repository in a
// later file replaces the earlier record; one not there yet is added), keeping
// the first file's own fields. main's block at 6b3cdf2 is reproduced by
// coverage.mjs --results evidence/c-7/review-2/coverage-plan-input.json.gz
// with --base (the SW-3 breakdown with C-4 input laid over it); this
// chunk's Go pins are laid over C-7's input (coverage-plan-input-round2).
// Usage: node plan-base.mjs --into FILE[.gz] --overlay FILE[.gz] [--overlay …] --output FILE
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    into: { type: "string" },
    overlay: { type: "string", multiple: true },
    output: { type: "string" },
  },
});
const read = (path) => {
  const bytes = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
// The starting input's own fields (release, mode) are kept; only records change.
const merged = read(values.into);
const repos = new Map(merged.repos.map((row) => [row.id, row]));
for (const path of values.overlay ?? []) {
  const overlay = read(path);
  for (const row of overlay.repos) {
    const previous = repos.get(row.id);
    if (previous && previous.commit !== row.commit) throw Error(`Overlay does not match ${row.id}`);
    repos.set(row.id, row);
  }
}
const ids = [...repos.keys()].sort();
writeFileSync(values.output, JSON.stringify({ ...merged, repos: ids.map((id) => repos.get(id)) }));
console.error(`${ids.length} repositories`);
