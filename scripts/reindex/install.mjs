// SPDX-License-Identifier: MIT
// Installs a checkout's dependencies exactly as the sweep's installed mode
// does (scripts/sweep/install.mjs: lockfile, no scripts, no hooks, caches
// under <scratch>), for the C-22 warm-equals-cold checks.
//   node scripts/reindex/install.mjs <checkout> <scratch>
import { spawnSync } from "node:child_process";
import { installation } from "../sweep/install.mjs";

const [root, scratch] = process.argv.slice(2);
if (!root || !scratch) throw Error("usage: install.mjs <checkout> <scratch>");
const setup = await installation(root, scratch);
if (!setup.command)
  throw Error(`install unavailable: ${JSON.stringify(setup)}`);
const result = spawnSync(setup.command, setup.args, {
  cwd: root,
  env: setup.env,
  stdio: ["ignore", "inherit", "inherit"],
});
console.log(`${setup.manager}: exit ${result.status}`);
process.exitCode = result.status ?? 1;
