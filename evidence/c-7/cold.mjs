// SPDX-License-Identifier: MIT
// Run three cold trials on the same dev server and source copies.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const baseline = JSON.parse(
  readFileSync(join(scratch, "main-run.json"), "utf8"),
);
const selected = ["excalidraw/excalidraw", "pmndrs/zustand"];
const work = mkdtempSync(join(scratch, "cold-"));
function run(command, args, cwd, log, codes) {
  const file = openSync(log, "w");
  const errors = openSync(log + ".err", "w");
  try {
    const result = spawnSync(command, args, {
      cwd,
      stdio: ["ignore", file, errors],
    });
    if (!codes.includes(result.status))
      throw result.error ?? Error(`Exit ${result.status}: ${log}`);
  } finally {
    closeSync(file);
    closeSync(errors);
  }
}
for (const [i, repo] of selected.entries()) {
  const row = baseline.repos.find(({ id }) => id === repo);
  if (row?.outcome !== "finished")
    throw Error(`Missing baseline source for ${repo}`);
  const source = join(scratch, row.attempt, "checkout");
  const checkout = join(work, String(i));
  for (const name of readdirSync(source))
    if (name !== ".git" && name !== ".pymtheg")
      cpSync(join(source, name), join(checkout, name), {
        recursive: true,
        verbatimSymlinks: true,
      });
  const observations = [];
  for (const [j, build] of ["main", "candidate", "main"].entries()) {
    const cli = join(scratch, build, "dist/cli/main.js");
    const prefix = join(work, `${i}-${j}`);
    run(
      process.execPath,
      [cli, "init", ".", "--name", repo, "--format", "json"],
      checkout,
      prefix + "-init.json",
      [0],
    );
    run(
      "/usr/bin/time",
      [
        "-f",
        "%e %M",
        "-o",
        prefix + "-time",
        process.execPath,
        cli,
        "graph",
        "index",
        "--root",
        ".",
        "--json",
      ],
      checkout,
      prefix + "-index.json",
      [0, 2],
    );
    const output = JSON.parse(readFileSync(prefix + "-index.json", "utf8"));
    if (output.command !== "index" || !output.counts)
      throw Error("No graph index result");
    const [seconds, kibibytes] = readFileSync(prefix + "-time", "utf8")
      .trim()
      .split("\n")
      .at(-1)
      .split(/\s+/)
      .map(Number);
    observations.push({ build, seconds, kibibytes });
    renameSync(join(checkout, ".pymtheg"), prefix + "-storage");
  }
  console.log(JSON.stringify({ repo, observations }));
}
