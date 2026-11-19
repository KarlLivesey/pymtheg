// SPDX-License-Identifier: MIT
// Run the normal sweep with the same graph project IDs as the baseline.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [scratch, baseline, baselineWork, ...args] = process.argv.slice(2);
const runner = readFileSync("scripts/sweep/run.mjs", "utf8");
const anchor = '    const cold = await graph("cold", "index");';
if (!runner.includes(anchor)) throw Error("Sweep cold-index hook changed");
const temporary = join(scratch, "paired-run.mjs");
const seed = `    const baseline = JSON.parse(await readFile(process.env.PYM_PAIR_RESULTS, "utf8"));
    const before = baseline.repos.find((entry) => entry.id === repo.id && entry.commit === repo.commit);
    if (before?.outcome !== "finished") throw Error("No finished baseline for " + repo.id);
    const { DatabaseSync } = await import("node:sqlite");
    const { SqliteGraphStore } = await import(process.env.PYM_PAIR_STORE);
    const prior = new DatabaseSync(join(process.env.PYM_PAIR_WORK, before.attempt,
      "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
    const { value: project } = prior.prepare("SELECT value FROM graph_meta WHERE key='project'").get();
    prior.close();
    const directory = join(root, ".pymtheg/rebuildable");
    await mkdir(directory, { recursive: true });
    new SqliteGraphStore(join(directory, "graph.sqlite"), project).close();
`;
const warm = '    const warm = await graph("warm", "index");';
if (!runner.includes(warm)) throw Error("Sweep warm-index hook changed");
writeFileSync(
  temporary,
  runner
    .replace(anchor, seed + anchor)
    .replace(
      warm,
      '    if (process.env.PYM_PAIR_COLD_ONLY) return finalize("finished");\n' +
        warm,
    ),
);
const child = spawnSync(process.execPath, [temporary, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    PYM_PAIR_STORE: resolve("dist/graph/store.js"),
    PYM_PAIR_RESULTS: resolve(baseline),
    PYM_PAIR_WORK: resolve(baselineWork),
  },
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
