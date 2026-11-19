// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const [scratch, bareFile, installedFile, ...pins] = process.argv.slice(2);
const build = process.env.C20_BUILD ?? "candidate";
const read = (name) => JSON.parse(readFileSync(join(scratch, name), "utf8"));
const bare = read(bareFile).repos;
const installed = read(installedFile).repos;
const costs = join(scratch, "cost");
mkdirSync(costs, { recursive: true });
const env = { ...process.env };
delete env.NODE_OPTIONS;

function cold(repo, build, label) {
  const root = join(scratch, repo.attempt, "checkout");
  const state = join(root, ".pymtheg/rebuildable");
  const key = repo.id.replaceAll("/", "-") + "-" + label + "-" + randomUUID();
  const backup = join(costs, key + "-old");
  if (existsSync(state)) renameSync(state, backup);
  const metrics = join(costs, key + ".txt");
  const result = spawnSync(
    "/usr/bin/time",
    [
      "-q",
      "-f",
      "%e %M %U %S",
      "-o",
      metrics,
      "unshare",
      "--user",
      "--map-root-user",
      "--net",
      "--",
      process.execPath,
      join(scratch, build, "dist/cli/main.js"),
      "graph",
      "index",
      "--root",
      ".",
      "--json",
    ],
    { cwd: root, stdio: "ignore", env },
  );
  // Restore the sweep store even if the cold process did not complete.
  if (existsSync(state)) renameSync(state, join(costs, key + "-cold"));
  if (existsSync(backup)) renameSync(backup, state);
  if (result.status !== 0 && result.status !== 2)
    throw Error(
      `Cold indexing ${repo.id} ${label} failed with ${result.status ?? result.signal}`,
    );
  const [wallSeconds, peakRssKiB, user, system] = readFileSync(metrics, "utf8")
    .trim()
    .split(/\s+/)
    .map(Number);
  return { wallSeconds, peakRssKiB, cpuSeconds: user + system };
}

for (const id of pins) {
  const a = bare.find((repo) => repo.id === id);
  const b = installed.find((repo) => repo.id === id);
  if (
    a?.outcome !== "finished" ||
    b?.outcome !== "finished" ||
    b.install?.status !== "installed" ||
    a.commit !== b.commit
  )
    throw Error(`Need paired attempts for ${id}`);
  console.log(
    JSON.stringify({
      id,
      main: cold(a, "main", "main"),
      bare: cold(a, build, "bare"),
      installed: cold(b, build, "installed"),
      mainRepeat: cold(a, "main", "main-repeat"),
    }),
  );
}
