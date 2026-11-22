// SPDX-License-Identifier: MIT
// C-44: the answers lock under contention (round 5: a SQLite write
// transaction). Each round: a holder takes the lock and is killed with
// SIGKILL while holding it; meanwhile twelve `pymtheg init --trust` and one
// `pymtheg trust --revoke` of a trusted folder race. Counted: answers lost,
// commands failed, and a "Removed" while the folder stays trusted.
// Run with PYMTHEG_CONFIG_HOME set to a scratch folder.
//   node lock-load.mjs <cli> <scratch> [rounds=60]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [cliArg, scratch, roundsArg = "60"] = process.argv.slice(2);
if (!process.env.PYMTHEG_CONFIG_HOME) throw Error("set PYMTHEG_CONFIG_HOME to a scratch folder");
const cli = resolve(cliArg);
const dist = resolve(cli, "../..");
const holderScript = fileURLToPath(new URL("../../test/trust-lock-child.mjs", import.meta.url));
const { initializeWorkspace, checkoutTrust } = await import(pathToFileURL(join(dist, "project/workspace.js")).href);
const { writeLocalTrust } = await import(pathToFileURL(join(dist, "project/local-trust.js")).href);
const run = (args) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", (code) => done({ code, out }));
  });
const holder = (project) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [holderScript, "hold", project], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("held\n")) done(child);
    });
    child.on("exit", () => fail(Error("holder exited before holding")));
  });
let lost = 0, failed = 0, falseRemovals = 0, revokesMissed = 0;
const rounds = Number(roundsArg);
for (let round = 0; round < rounds; round++) {
  const victim = join(scratch, `victim-${round}`);
  const kill = join(scratch, `kill-${round}`);
  const dirs = Array.from({ length: 12 }, (_, i) => join(scratch, `r${round}-${i}`));
  for (const dir of [victim, kill, ...dirs]) {
    mkdirSync(dir, { recursive: true });
    await initializeWorkspace(dir);
  }
  await writeLocalTrust(victim, "trusted");
  const held = await holder(kill);
  const all = Promise.all([run(["trust", "--revoke", victim]), ...dirs.map((dir) => run(["init", dir, "--trust"]))]);
  held.kill("SIGKILL");
  const [revoked, ...inits] = await all;
  failed += [revoked, ...inits].filter((r) => r.code !== 0).length;
  for (const dir of dirs) if ((await checkoutTrust(dir)) !== "trusted") lost++;
  const victimState = await checkoutTrust(victim);
  if (/Removed/.test(revoked.out) && victimState !== "unanswered") falseRemovals++;
  if (victimState !== "unanswered") revokesMissed++;
}
const result = { rounds, inits: rounds * 12, killedHolders: rounds, revokes: rounds, lost, failed, falseRemovals, revokesMissed };
writeFileSync(join(scratch, "lock-load.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
