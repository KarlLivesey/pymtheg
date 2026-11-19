// SPDX-License-Identifier: MIT
import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { measured } from "../../scripts/sweep/run.mjs";

const [scratch, receipt, ...pins] = process.argv.slice(2);
const candidate = process.env.C23_BUILD ?? "candidate-build";
const baseline = process.env.C23_BASE_BUILD ?? "main-build";
const { repos } = JSON.parse(await readFile(receipt, "utf8"));
const env = { ...process.env };
delete env.NODE_OPTIONS;
const output = join(scratch, "cold-comparison-" + candidate);
await mkdir(output);

for (const pin of pins) {
  const repo = repos.find(({ id }) => pin === id);
  if (repo?.outcome !== "finished" || repo.install?.status !== "installed")
    throw Error(`Need a completed install for ${pin}`);
  const root = join(scratch, repo.attempt, "checkout");
  const state = join(root, ".pymtheg", "rebuildable");
  const logs = join(output, pin.replace("/", "-"));
  await mkdir(logs);
  const backup = join(logs, "sweep-state");
  await rename(state, backup);
  try {
    for (const [label, build] of [
      ["main", baseline],
      ["candidate", candidate],
      ["main-repeat", baseline],
    ]) {
      const log = join(logs, label);
      const result = await measured({
        command: "unshare",
        args: [
          "--user",
          "--map-root-user",
          "--net",
          "--",
          process.execPath,
          join(scratch, build, "dist", "cli", "main.js"),
          "graph",
          "index",
          "--root",
          ".",
          "--json",
        ],
        cwd: root,
        log,
        seconds: 3600,
        env,
        foreground: true,
      });
      await rename(state, join(logs, label + "-state")).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      const response = JSON.parse(await readFile(log + ".out", "utf8"));
      if (
        response.schema !== "pymtheg.graph/v1" ||
        ![0, 2].includes(result.code)
      )
        throw Error(`Cold index did not complete for ${pin} ${label}`);
      console.log(
        JSON.stringify({ pin, label, status: response.status, ...result }),
      );
    }
  } finally {
    await rename(backup, state);
  }
}
