// SPDX-License-Identifier: MIT
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { measured } from "../../scripts/sweep/run.mjs";

const [scratch, receipt, pin, build = "candidate-build"] = process.argv.slice(2);
const previous = JSON.parse(await readFile(receipt, "utf8"));
const repo = previous.repos.find(({ id }) => pin === id);
if (repo?.install?.status !== "installed" || repo.outcome !== "finished")
  throw Error(`Need a completed installed graph for ${pin}`);
const root = join(scratch, repo.attempt, "checkout");
const state = join(root, ".pymtheg", "rebuildable");
const attempt = join("same-install-" + build, pin);
const logDir = join(scratch, attempt);
const indexDir = join(logDir, "checkout", ".pymtheg");
await mkdir(indexDir, { recursive: true });
const backup = join(logDir, "main-store");
const env = { ...process.env };
delete env.NODE_OPTIONS;
const start = performance.now();
await rename(state, backup);
try {
  const run = async (label, ...args) => {
    const log = join(logDir, label);
    const outcome = await measured({
      command: "unshare",
      args: [
        "--user",
        "--map-root-user",
        "--net",
        "--",
        process.execPath,
        join(scratch, build, "dist", "cli", "main.js"),
        "graph",
        ...args,
        "--root",
        ".",
        "--json",
      ],
      cwd: root,
      log,
      seconds: repo.limitSeconds - (performance.now() - start) / 1000,
      env,
      foreground: true,
    });
    const body = JSON.parse(await readFile(log + ".out", "utf8"));
    if (![0, 2].includes(outcome.code) || body.schema !== "pymtheg.graph/v1")
      throw Error(`${pin} ${label} did not complete`);
    console.log(JSON.stringify({ label, status: body.status, ...outcome }));
    return { ...outcome, status: body.status };
  };
  const cold = await run("cold", "index");
  const warm = await run("warm", "index");
  await run("status", "status", "--no-sync", "--limit", "25");
  await run("search", "search", "init", "--no-sync", "--limit", "25");
  await run(
    "file",
    "file",
    repo.querySample.file,
    "--no-sync",
    "--limit",
    "25",
  );
  await rename(state, join(indexDir, "rebuildable"));
  await writeFile(
    join(scratch, "same-install-" + build + "-run.json"),
    JSON.stringify({ ...previous, repos: [{ ...repo, attempt, cold, warm }] }),
  );
} finally {
  await rename(state, join(logDir, "interrupted")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rename(backup, state);
}
