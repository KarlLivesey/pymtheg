// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scratch = process.env.PYM_SCRATCH;
if (!scratch) throw Error("Set PYM_SCRATCH to an empty sweep directory on disk");

// Include all tracked source languages when deciding which pins run alone.
// The release's inventory is of the same unchanged commits.
const { repos } = JSON.parse(readFileSync("evidence/sw-1/results.json", "utf8"));
const serial = repos.filter(({ trackedSource }) =>
  Object.values(trackedSource.lines).reduce((total, lines) => total + lines, 0) > 300_000)
  .flatMap(({ id }) => ["--serial-pin", id]);

for (const [mode, ...flags] of [
  ["bare"], ["installed", "--installed"], ["go-toolchain", "--go-toolchain"],
  ["rust-toolchain", "--rust-toolchain"],
]) {
  console.error(`Starting ${mode}`);
  const run = spawnSync(process.execPath, ["scripts/sweep/run.mjs", "--local-build", ".",
    "--parallel", "2", "--output", join(scratch, `${mode}-run.json`), ...flags, ...serial,
  ], { stdio: "inherit" });
  if (run.error || run.status !== 0) throw run.error ?? Error(`${mode} exited ${run.status ?? run.signal}`);
}
