// SPDX-License-Identifier: MIT
// Use the C-7 cold runner on one source copy per pin, with main bracketing C-11.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const benchmark = mkdtempSync(join(scratch, "benchmark-"));
const pins = ["vitest-dev/vitest", "withastro/astro", "honojs/hono"];
const checkouts = new Map();
for (const name of ["release", "candidate-audit"]) {
  const { repos } = JSON.parse(readFileSync(join(scratch, `${name}-run.json`), "utf8"));
  for (const repo of repos)
    if (repo.outcome === "finished") checkouts.set(repo.id, repo);
}
if (pins.some((id) => !checkouts.has(id))) throw Error("The benchmark needs completed source checkouts for all three pins");
symlinkSync(join(scratch, "work"), join(benchmark, "work"));
symlinkSync(join(scratch, "main"), join(benchmark, "main"));
symlinkSync(resolve("."), join(benchmark, "candidate"));
writeFileSync(join(benchmark, "main-run.json"), JSON.stringify({ repos: pins.map((id) => checkouts.get(id)) }));
const { status, signal } = spawnSync(process.execPath, ["evidence/c-7/cold.mjs", "candidate", ...pins], {
  env: { ...process.env, PYM_SCRATCH: benchmark }, stdio: "inherit",
});
if (status !== 0) throw Error(`Cold benchmark exited ${status ?? signal}`);
