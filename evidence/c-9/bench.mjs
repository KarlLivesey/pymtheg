// SPDX-License-Identifier: MIT
// Compare cold indexes on one storage device against two main runs.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const results = JSON.parse(readFileSync(join(scratch, "candidate-run.json"), "utf8"));
const bench = mkdtempSync(join(scratch, "cold-"));
const builds = [
  ["main 1", join(scratch, "main-build/dist/cli/main.js")],
  ["candidate", join(scratch, "candidate-build/dist/cli/main.js")],
  ["main 2", join(scratch, "main-build/dist/cli/main.js")],
];
function run(command, args, cwd, accepted = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { error += chunk; });
    child.on("error", reject).on("close", (status) => {
      if (accepted.includes(status)) resolve(output);
      else reject(Error(error || `${command} exited ${status}`));
    });
  });
}
async function measure(id) {
  const observations = [];
  const repo = results.repos.find((row) => row.id === id && row.outcome === "finished");
  if (!repo) throw Error(`No finished candidate for ${id}`);
  for (const [variant, entry] of builds) {
    const root = join(bench, id.split("/")[1], variant.replaceAll(" ", "-"));
    await run("git", ["clone", "--quiet", "--shared", "--no-checkout", join(scratch, repo.attempt, "checkout"), root], bench);
    await run("git", ["checkout", "--quiet", "--detach", repo.commit], root);
    await run(process.execPath, [entry, "init", ".", "--name", id, "--format", "json"], root);
    const statistics = join(root, "../", variant.replaceAll(" ", "-") + ".time");
    const response = JSON.parse(await run("/usr/bin/time", ["-f", "%e %M", "-o", statistics,
      process.execPath, entry, "graph", "index", "--root", ".", "--json"], root, [0, 2]));
    const [seconds, peakKiB] = readFileSync(statistics, "utf8").trim().split("\n").at(-1).split(/\s+/).map(Number);
    if (!Number.isFinite(seconds) || !Number.isSafeInteger(peakKiB)) throw Error(`Invalid measurement for ${id} ${variant}`);
    observations.push({ repo: id, variant, seconds, peakKiB, status: response.status, counts: response.counts });
    console.error(`${id} ${variant} · ${seconds} seconds, ${peakKiB} KiB`);
  }
  return observations;
}
const ids = process.argv.slice(2);
if (ids.length !== 2 || new Set(ids).size !== 2) throw Error("Pass two different finished pins");
const observations = [];
for (const id of ids) observations.push(...await measure(id));
console.log(JSON.stringify(observations, null, 2));
