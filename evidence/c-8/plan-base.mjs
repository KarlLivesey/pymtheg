// SPDX-License-Identifier: MIT
// C-8 evidence: the input the plan's generated block was regenerated from.
// C-4's 40-pin plan input (all Go and TypeScript pins, from which the block
// on main was generated) with its Go pins replaced by this chunk's candidate
// records; the result is passed to coverage.mjs with the SW-3 base, exactly
// as C-4 did.
// Usage: node plan-base.mjs --into FILE.gz --overlay FILE --output FILE
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const { values } = parseArgs({
  options: { into: { type: "string" }, overlay: { type: "string" }, output: { type: "string" } },
});
const read = (path) => {
  const bytes = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
const into = read(values.into);
const overlay = read(values.overlay);
const repos = new Map(into.repos.map((row) => [row.id, row]));
for (const row of overlay.repos) {
  const previous = repos.get(row.id);
  if (!previous || previous.commit !== row.commit) throw Error(`Overlay does not match ${row.id}`);
  repos.set(row.id, row);
}
const ids = [...repos.keys()].sort();
writeFileSync(values.output, JSON.stringify({ ...into, repos: ids.map((id) => repos.get(id)) }));
console.error(`${ids.length} repositories, ${overlay.repos.length} replaced`);
