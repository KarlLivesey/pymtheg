// SPDX-License-Identifier: MIT
// Shallow-clone each pin of a sweep manifest at its exact commit.
//   node clone-pins.mjs <manifest.json>... --into <dir>
// Skips a pin whose checkout already exists at the right commit.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const into = args[args.indexOf("--into") + 1];
const manifests = args.filter((a, i) => a !== "--into" && args[i - 1] !== "--into");
const git = (cwd, ...a) =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
mkdirSync(into, { recursive: true });
for (const manifest of manifests)
  for (const pin of JSON.parse(readFileSync(manifest, "utf8"))) {
    const dir = join(into, pin.id.replace("/", "__"));
    if (existsSync(join(dir, ".git")) && git(dir, "rev-parse", "HEAD") === pin.commit) {
      console.log(`have ${pin.id}`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q");
    git(dir, "-c", "core.hooksPath=/dev/null", "fetch", "-q", "--depth", "1", pin.url, pin.commit);
    git(dir, "-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false", "checkout", "-q", "FETCH_HEAD");
    console.log(`cloned ${pin.id} ${git(dir, "rev-parse", "HEAD")}`);
  }
