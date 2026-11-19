// SPDX-License-Identifier: MIT
// Run the unchanged repository initialization test alone on main and C-11.
import { spawnSync } from "node:child_process";
import { readFileSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const [memory] = process.argv.slice(2);
if (!scratch || !memory || statfsSync(memory).type !== 0x01021994)
  throw Error("The self-index bracket requires a tmpfs scratch directory");
const env = { ...process.env, PYM_SCRATCH: memory, TMPDIR: memory };
const test = [
  process.execPath,
  "--test",
  "--test-name-pattern",
  "this repository initializes and serves commands",
  "test/project-init-clean.test.mjs",
];
const builds = [
  ["main", join(scratch, "main-src")],
  ["head", resolve(".")],
];
let failed = false;
for (let run = 1; run <= 3; run++) {
  for (const [build, cwd] of builds) {
    const timing = join(scratch, `self-index-${build}-${run}.time`);
    const result = spawnSync(
      "/usr/bin/time",
      ["-f", "%e %U %S %M", "-o", timing, ...test],
      { cwd, env, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    const [seconds, userSeconds, systemSeconds, rssKiB] = readFileSync(
      timing,
      "utf8",
    )
      .trim()
      .split("\n")
      .at(-1)
      .split(/\s+/)
      .map(Number);
    console.log(
      JSON.stringify({
        build,
        run,
        seconds,
        userSeconds,
        systemSeconds,
        rssKiB,
        exitCode: result.status,
        signal: result.signal,
      }),
    );
    failed ||= result.status !== 0;
  }
}
process.exitCode = failed ? 1 : 0;
