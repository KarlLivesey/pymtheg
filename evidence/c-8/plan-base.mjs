// SPDX-License-Identifier: MIT
// C-8 evidence: the input the plan's generated block was regenerated from.
// Starts from one chunk's plan input and lays further exports over it in
// order (a repository in a later file replaces the earlier record; one that is
// not there yet is added). The result is passed to coverage.mjs with the SW-3
// base, exactly as the earlier chunks did. For main at efa0e9e: C-4's input,
// then C-1's, reproduces docs/coverage-plan.md; this chunk's Go pins go last.
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
let merged = read(values.into);
const repos = new Map(merged.repos.map((row) => [row.id, row]));
for (const path of values.overlay ?? []) {
  const overlay = read(path);
  for (const row of overlay.repos) {
    const previous = repos.get(row.id);
    if (previous && previous.commit !== row.commit) throw Error(`Overlay does not match ${row.id}`);
    repos.set(row.id, row);
  }
  merged = { ...overlay, repos: [] };
}
const ids = [...repos.keys()].sort();
writeFileSync(values.output, JSON.stringify({ ...merged, repos: ids.map((id) => repos.get(id)) }));
console.error(`${ids.length} repositories`);
