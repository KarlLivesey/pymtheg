// SPDX-License-Identifier: MIT
// Fetches pinned sweep repositories (sweep/repos.json) into <scratch>/pins/<name>
// as clean detached checkouts, for the C-22 re-index measurements.
//   node scripts/reindex/fetch.mjs <scratch> <repo id>...
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [scratch, ...ids] = process.argv.slice(2);
if (!scratch || !ids.length)
  throw Error("usage: fetch.mjs <scratch> <repo id>...");
const manifest = JSON.parse(readFileSync("sweep/repos.json", "utf8"));
const repos = manifest.repos ?? manifest;
export const pinName = (id) => id.replace(/[^A-Za-z0-9._-]/g, "_");
for (const id of ids) {
  const repo = repos.find((item) => item.id === id);
  if (!repo) throw Error(`not in sweep/repos.json: ${id}`);
  const dir = join(scratch, "pins", pinName(id));
  if (existsSync(join(dir, ".git"))) {
    console.log(`${id}: present`);
    continue;
  }
  mkdirSync(dir, { recursive: true });
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
  git("init", "--template=", "--quiet");
  git(
    "fetch",
    "--depth",
    "1",
    "--no-tags",
    "--no-recurse-submodules",
    repo.url,
    repo.commit,
  );
  git("checkout", "--quiet", "--detach", "FETCH_HEAD");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();
  if (head !== repo.commit) throw Error(`${id}: HEAD ${head} is not the pin`);
  console.log(`${id}: ${head}`);
}
