// SPDX-License-Identifier: MIT
// Installs a checkout's dependencies exactly as the sweep's installed mode
// does (scripts/sweep/install.mjs: lockfile, no scripts, no hooks, caches
// under <scratch>), for the C-22 warm-equals-cold checks.
//   node scripts/reindex/install.mjs <checkout> <scratch>
import { spawnSync } from "node:child_process";
import { installation, installerCommand } from "../sweep/install.mjs";

const [root, scratch] = process.argv.slice(2);
if (!root || !scratch) throw Error("usage: install.mjs <checkout> <scratch>");
const setup = await installation(root, scratch);
if (!setup.command && !setup.native)
  throw Error(`install unavailable: ${JSON.stringify(setup)}`);
// As the sweep runs it: the pinned installer (or corepack with the pinned
// manager as its first argument), then the install arguments.
const result = spawnSync(
  await installerCommand(setup, scratch),
  [...(setup.prefix ?? []), ...setup.args],
  {
    cwd: root,
    env: setup.env,
    stdio: ["ignore", "inherit", "inherit"],
  },
);
console.log(`${setup.manager}: exit ${result.status}`);
process.exitCode = result.status ?? 1;
