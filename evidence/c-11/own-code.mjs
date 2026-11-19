// SPDX-License-Identifier: MIT
// Reproduce the C-2 own-code checkout on the default Node heap.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const commit = "b387e3a179d7495321019363c5ba11e847834cd0";
const source = mkdtempSync(join(scratch, "t3-source-"));
const checkout = mkdtempSync(join(scratch, "t3-own-"));
const cli = resolve("dist/cli/main.js");
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.status !== 0)
    throw (
      result.error ??
      Error(
        `${command} exited ${result.status ?? result.signal}\n${result.stderr}`,
      )
    );
  return result.stdout;
}
const git = (args) =>
  run("git", ["-c", "core.hooksPath=/dev/null", ...args], source);
git(["init", "--template=", "--quiet"]);
git([
  "fetch",
  "--quiet",
  "--depth=1",
  "--no-tags",
  "--no-recurse-submodules",
  "https://github.com/pingdotgg/t3code.git",
  commit,
]);
git(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
if (git(["rev-parse", "HEAD"]).trim() !== commit) throw Error("Unexpected pin");
for (const name of readdirSync(source))
  if (name !== ".git" && name !== ".repos")
    cpSync(join(source, name), join(checkout, name), {
      recursive: true,
      verbatimSymlinks: true,
    });

run(
  process.execPath,
  [cli, "init", ".", "--name", "T3 Code own code"],
  checkout,
);
const timing = join(scratch, "own-code-time.txt");
const { NODE_OPTIONS: _nodeOptions, ...env } = process.env;
const result = spawnSync(
  "/usr/bin/time",
  [
    "-f",
    "%e %M",
    "-o",
    timing,
    process.execPath,
    cli,
    "graph",
    "index",
    "--json",
    "--root",
    ".",
  ],
  {
    cwd: checkout,
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);
const [seconds, rssKiB] = readFileSync(timing, "utf8")
  .trim()
  .split("\n")
  .at(-1)
  .split(/\s+/)
  .map(Number);
writeFileSync(join(scratch, "own-code-index.json"), result.stdout);
if (![0, 2].includes(result.status))
  throw Error(
    `Index exited ${result.status ?? result.signal}; peak ${rssKiB} KiB`,
  );
const index = JSON.parse(result.stdout);
if (index.command !== "index" || !index.counts)
  throw Error("No graph index result");
console.log(
  JSON.stringify({
    commit,
    exitCode: result.status,
    seconds,
    rssKiB,
    counts: index.counts,
  }),
);
