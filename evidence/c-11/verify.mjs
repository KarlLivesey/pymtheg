// SPDX-License-Identifier: MIT
// Keep the active sweep artifact fixed while building and testing the review tree.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const checkout = mkdtempSync(join(scratch, "verify-"));
const excluded = new Set([
  ".git",
  ".pymtheg",
  ".pymtheg-architecture",
  ".pymtheg-studio",
  "private",
  "project-fit",
  "node_modules",
  "dist",
  "dist-web",
]);
for (const entry of readdirSync(".")) {
  if (excluded.has(entry)) continue;
  cpSync(entry, join(checkout, entry), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => !excluded.has(basename(path)),
  });
}
symlinkSync(resolve("node_modules"), join(checkout, "node_modules"));

const filter = process.argv[2];
const full = [
  ["npm", "run", "build"],
  [process.execPath, "node_modules/typescript/bin/tsc", "--noEmit"],
  ["npm", "run", "format:check"],
  ["npm", "test"],
  [
    process.execPath,
    "--test",
    "scripts/sweep/coverage.test.mjs",
    "scripts/sweep/run.test.mjs",
  ],
];
const focused = [
  ["npm", "run", "build:core"],
  [
    process.execPath,
    "--test",
    "--test-name-pattern",
    filter,
    "test/graph-typescript-resolution.test.mjs",
  ],
];
for (const [command, ...args] of filter ? focused : full) {
  const result = spawnSync(command, args, { cwd: checkout, stdio: "inherit" });
  if (result.status !== 0)
    throw (
      result.error ??
      Error(`${args.join(" ")} exited ${result.status ?? result.signal}`)
    );
}
