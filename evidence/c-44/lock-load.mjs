// SPDX-License-Identifier: MIT
// C-44 round 4: the answers-file lock under contention, as the review
// measured it. Twelve `pymtheg init --trust` at once, for `rounds` rounds
// (lost answers counted), and `pymtheg trust --revoke` of a trusted folder
// racing twelve inits, for `races` rounds (a "Removed" while the folder
// stays trusted counted). Run with PYMTHEG_CONFIG_HOME set to a scratch
// folder.
//   node lock-load.mjs <cli> <scratch> [rounds=15] [races=60]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [cliArg, scratch, roundsArg = "15", racesArg = "60"] = process.argv.slice(2);
if (!process.env.PYMTHEG_CONFIG_HOME) throw Error("set PYMTHEG_CONFIG_HOME to a scratch folder");
const cli = resolve(cliArg);
const dist = resolve(cli, "../..");
const { initializeWorkspace, checkoutTrust } = await import(pathToFileURL(join(dist, "project/workspace.js")).href);
const run = (args) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", (code) => done({ code, out }));
  });
let lost = 0, failed = 0, falseRemovals = 0;
for (let round = 0; round < Number(roundsArg); round++) {
  const dirs = Array.from({ length: 12 }, (_, i) => join(scratch, `load-${round}-${i}`));
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
    await initializeWorkspace(dir);
  }
  const results = await Promise.all(dirs.map((dir) => run(["init", dir, "--trust"])));
  failed += results.filter((r) => r.code !== 0).length;
  for (const dir of dirs) if ((await checkoutTrust(dir)) !== "trusted") lost++;
}
for (let race = 0; race < Number(racesArg); race++) {
  const victim = join(scratch, `victim-${race}`);
  await initializeWorkspace(victim, undefined, { trust: "trusted" });
  const dirs = Array.from({ length: 12 }, (_, i) => join(scratch, `race-${race}-${i}`));
  for (const dir of dirs) await initializeWorkspace(dir);
  const [revoked] = await Promise.all([run(["trust", "--revoke", victim]), ...dirs.map((dir) => run(["init", dir, "--trust"]))]);
  if (/Removed/.test(revoked.out) && (await checkoutTrust(victim)) !== "unanswered") falseRemovals++;
  for (const dir of dirs) if ((await checkoutTrust(dir)) !== "trusted") lost++;
}
const result = { rounds: Number(roundsArg), inits: Number(roundsArg) * 12 + Number(racesArg) * 12, races: Number(racesArg), lost, failed, falseRemovals };
writeFileSync(join(scratch, "lock-load.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
