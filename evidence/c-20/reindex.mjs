// SPDX-License-Identifier: MIT
// Recover a cold graph after an interrupted sweep, retaining the pinned install.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { measured } from "../../scripts/sweep/run.mjs";

const [scratch, input, output] = process.argv.slice(2);
const packet = JSON.parse(readFileSync(input, "utf8"));
const entry = join(scratch, "candidate", "dist/cli/main.js");
for (const repo of packet.repos) {
  if (repo.outcome !== "wall-limit" && repo.outcome !== "crashed") continue;
  if (packet.mode === "installed" && repo.install?.status !== "installed")
    continue;
  const attempt = join(scratch, repo.attempt);
  const checkout = join(attempt, "checkout");
  const store = join(checkout, ".pymtheg", "rebuildable");
  if (!existsSync(join(checkout, ".pymtheg", "project.json"))) continue;
  if (existsSync(store))
    renameSync(store, join(attempt, `interrupted-${randomUUID()}`));
  const cli = (log, command) =>
    measured({
      command: "unshare",
      args: [
        "--user",
        "--map-root-user",
        "--net",
        "--",
        process.execPath,
        entry,
        "graph",
        command,
        "--root",
        ".",
        "--json",
      ],
      cwd: checkout,
      log: join(attempt, log),
      seconds: command === "index" ? 1_200 : 180,
      foreground: true,
    });
  const cold = await cli("cold-retry", "index");
  if (cold.code !== 0 && cold.code !== 2) {
    console.log(repo.id, "cold retry interrupted", cold);
    continue;
  }
  const status = await cli("warm", "status");
  if (status.code !== 0 && status.code !== 2) {
    console.log(repo.id, "status failed", status);
    continue;
  }
  const indexed = JSON.parse(
    readFileSync(join(attempt, "cold-retry.out"), "utf8"),
  );
  const checked = JSON.parse(readFileSync(join(attempt, "warm.out"), "utf8"));
  if (
    indexed.command !== "index" ||
    checked.command !== "status" ||
    JSON.stringify(indexed.counts) !== JSON.stringify(checked.counts)
  )
    throw Error(`Incomplete cold receipt for ${repo.id}`);
  repo.outcome = "finished";
  repo.interrupted = repo.failure?.stage;
  delete repo.failure;
  repo.cold = { ...cold, status: indexed.status };
  repo.warm = { ...status, status: checked.status, mode: "status" };
  console.log(repo.id, "cold retry indexed", repo.cold);
}
writeFileSync(output, JSON.stringify(packet));
