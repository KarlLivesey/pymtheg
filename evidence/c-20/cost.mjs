// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const [scratch, bareFile, installedFile, ...pins] = process.argv.slice(2);
const read = (name) => JSON.parse(readFileSync(join(scratch, name), "utf8"));
const bare = read(bareFile).repos;
const installed = read(installedFile).repos;
const costs = join(scratch, "cost");
mkdirSync(costs, { recursive: true });

function cold(repo, build, label) {
  const root = join(scratch, repo.attempt, "checkout");
  const state = join(root, ".pymtheg/rebuildable");
  const key = repo.id.replaceAll("/", "-") + "-" + label;
  if (existsSync(state)) renameSync(state, join(costs, key + "-old"));
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
    { cwd: root, stdio: "ignore" },
  );
  if (result.status !== 0 && result.status !== 2)
    throw Error(
      `Cold indexing ${repo.id} ${label} failed with ${result.status ?? result.signal}`,
    );
  const [wallSeconds, peakRssKiB, user, system] = readFileSync(metrics, "utf8")
    .trim()
    .split(/\s+/)
    .map(Number);
  // Restore the measured sweep store, preserving this cold store for inspection.
  renameSync(state, join(costs, key + "-cold"));
  renameSync(join(costs, key + "-old"), state);
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
      bare: cold(a, "candidate", "bare"),
      installed: cold(b, "candidate", "installed"),
      mainRepeat: cold(a, "main", "main-repeat"),
    }),
  );
}
