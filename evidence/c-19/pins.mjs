// SPDX-License-Identifier: MIT
// C-19: the 18 Rust pins that finished in the sweep (all 20 Rust entries of
// sweep/repos.json except swc and embassy, still open at the wall limit), as
// "name url sha" lines. name = the repository name, lower-cased.
import { readFileSync } from "node:fs";
const repos = JSON.parse(readFileSync(new URL("../../sweep/repos.json", import.meta.url), "utf8"));
const open = new Set(["swc-project/swc", "embassy-rs/embassy"]);
for (const r of repos) {
  if (r.language !== "rust" || open.has(r.id)) continue;
  console.log(`${r.id.split("/")[1].toLowerCase()} ${r.url} ${r.commit}`);
}
