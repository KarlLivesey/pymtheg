// SPDX-License-Identifier: MIT
// C-22 check: which bytes of the graph file a no-edit `graph index` through
// the CLI changes. With the journal chosen before the run's baseline, the
// answer must be SQLite's file change counter (24-27) and its copy (92-95)
// only.
//   node scripts/reindex/journal-bytes.mjs <dist> <project root>
import "../isolated-home.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [dist, root] = process.argv.slice(2);
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
const index = () =>
  spawnSync(
    process.execPath,
    [resolve(dist, "cli/main.js"), "graph", "index", "--root", root, "--json"],
    { encoding: "utf8" },
  );
index();
const before = readFileSync(graph);
index();
const after = readFileSync(graph);
const offsets = [];
for (let i = 0; i < Math.max(before.length, after.length); i++)
  if (before[i] !== after[i]) offsets.push(i);
console.log(
  `no-edit graph index: ${offsets.length ? `bytes differ at offsets ${offsets.join(",")}` : "bytes identical"} (${before.length} → ${after.length} bytes)`,
);
