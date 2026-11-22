// SPDX-License-Identifier: MIT
// C-38: one case edit (cases.json: comment, body or export) on a fresh copy
// of a pin, re-indexed as the CLI does, must leave the store equal row for
// row to a cold index of the edited tree (measure.mjs compares only after
// the edit is reverted). Prints the differences, if any, and the run's
// TypeScript counters.
//   node scripts/reindex/edit-equals-cold.mjs <dist> <scratch> <repo id> <edit> <work label>
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareRows, storeRows } from "./dump.mjs";

const [distArg, scratch, id, edit, label] = process.argv.slice(2);
if (!label)
  throw Error(
    "usage: edit-equals-cold.mjs <dist> <scratch> <repo id> <edit> <work label>",
  );
const dist = resolve(distArg);
const here = new URL(".", import.meta.url).pathname;
const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const pin = cases.pins.find((item) => item.id === id);
const name = id.replace(/[^A-Za-z0-9._-]/g, "_");
const base = join(scratch, "edit-check", label, name);
const root = join(base, "tree");
if (existsSync(base)) throw Error(`exists: ${base}`);
mkdirSync(base, { recursive: true });
cpSync(join(scratch, "pins", name), root, { recursive: true });
const node = (script, ...rest) =>
  execFileSync(process.execPath, [join(here, script), dist, ...rest], {
    stdio: ["ignore", "ignore", "inherit"],
  });
execFileSync(
  process.execPath,
  [join(dist, "cli/main.js"), "init", ".", "--name", name, "--format", "json"],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);
node("index-once.mjs", root, join(base, "first.json"));
const path = join(root, pin.file);
const original = readFileSync(path, "utf8");
const at = original.indexOf(pin.anchor) + pin.anchor.length;
const text = {
  comment: original + pin.comment,
  body: original.slice(0, at) + pin.body + original.slice(at),
  export: original + pin.export,
}[edit];
writeFileSync(path, text);
// --profile: a CPU profile of the edited re-index, in the work directory.
if (process.argv.includes("--profile"))
  execFileSync(
    process.execPath,
    [
      "--cpu-prof",
      "--cpu-prof-dir",
      base,
      "--cpu-prof-name",
      "edited.cpuprofile",
      join(here, "index-once.mjs"),
      dist,
      root,
      join(base, "edited.json"),
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
else node("index-once.mjs", root, join(base, "edited.json"));
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
const cold = join(base, "cold.sqlite");
node("cold-once.mjs", root, cold, storeRows(graph).project[0]);
const differences = compareRows(storeRows(graph), storeRows(cold));
const edited = JSON.parse(readFileSync(join(base, "edited.json"), "utf8"));
console.log(
  JSON.stringify({
    id,
    edit,
    equal: differences.length === 0,
    typescript: edited.typescript,
    changed: edited.counts?.["analyze.typescript.filesChanged"] ?? 0,
    cpuMs: edited.cpuMs,
    differences: differences.slice(0, 5),
  }).slice(0, 4000),
);
