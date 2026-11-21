// SPDX-License-Identifier: MIT
// C-22 equality check on a real pin: seeded random single-file edits, each
// followed by an incremental `graph index` (a fresh process, as the CLI) and
// a cold index of the same tree into a new store with the same project id;
// the two stores must be identical row for row (dump.mjs).
//   node scripts/reindex/random-edits.mjs <dist> <scratch> <repo id> <seed> <count> <out.json>
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { compareRows, storeRows } from "./dump.mjs";

const [distArg, scratch, id, seedArg, countArg, outArg] = process.argv.slice(2);
if (!outArg)
  throw Error(
    "usage: random-edits.mjs <dist> <scratch> <repo id> <seed> <count> <out.json>",
  );
const dist = resolve(distArg);
const here = new URL(".", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync("sweep/repos.json", "utf8"));
const repo = (manifest.repos ?? manifest).find((item) => item.id === id);
const extensions = {
  go: [".go"],
  rust: [".rs"],
  typescript: [".ts", ".tsx", ".mts", ".cts"],
}[repo.language];
const name = id.replace(/[^A-Za-z0-9._-]/g, "_");
const base = join(scratch, "random", `${name}.${seedArg}`);
const root = join(base, "tree");
if (existsSync(base)) throw Error(`exists: ${base}`);
mkdirSync(base, { recursive: true });
cpSync(join(scratch, "pins", name), root, { recursive: true });

// Deterministic PRNG (mulberry32).
let state = Number(seedArg) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const files = execFileSync("git", ["ls-files"], { cwd: root })
  .toString()
  .split("\n")
  .filter((path) => extensions.some((extension) => path.endsWith(extension)))
  .sort();
const run = (script, ...rest) =>
  execFileSync(process.execPath, [join(here, script), dist, ...rest], {
    stdio: ["ignore", "ignore", "inherit"],
  });
execFileSync(
  process.execPath,
  [join(dist, "cli/main.js"), "init", ".", "--name", name, "--format", "json"],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
run("index-once.mjs", root, join(base, "first.json"));
const projectId = storeRows(graph).project[0];
// Edits that keep, move or break code: a comment line, a blank line, a
// duplicated line, a deleted line, a no-op statement after an opening brace.
const kinds = ["comment", "blank", "duplicate", "delete", "statement"];
const statement = { go: "_ = 0", rust: "let _ = 0;", typescript: "void 0;" }[
  repo.language
];
const steps = [];
for (let step = 0; step < Number(countArg); step++) {
  const file = pick(files);
  const path = join(root, file);
  const lines = readFileSync(path, "utf8").split("\n");
  let kind = pick(kinds);
  const at = Math.floor(random() * lines.length);
  if (kind === "statement") {
    const braces = lines
      .map((line, index) => (line.trimEnd().endsWith("{") ? index : -1))
      .filter((index) => index >= 0);
    if (braces.length) lines.splice(pick(braces) + 1, 0, statement);
    else kind = "comment";
  }
  if (kind === "comment") lines.splice(at, 0, "// c22 random edit");
  if (kind === "blank") lines.splice(at, 0, "");
  if (kind === "duplicate") lines.splice(at, 0, lines[at] ?? "");
  if (kind === "delete") lines.splice(at, 1);
  writeFileSync(path, lines.join("\n"));
  run("index-once.mjs", root, join(base, `step-${step}.json`));
  const cold = join(base, `cold-${step}.sqlite`);
  run("cold-once.mjs", root, cold, projectId);
  const differences = compareRows(storeRows(graph), storeRows(cold));
  const incremental = JSON.parse(
    readFileSync(join(base, `step-${step}.json`), "utf8"),
  );
  steps.push({
    step,
    file,
    kind,
    line: at + 1,
    equal: differences.length === 0,
    differences,
    wallMs: incremental.wallMs,
    failed: incremental.report?.failedCount,
  });
  console.log(
    `${id} step ${step} ${kind} ${file}:${at + 1}: ${differences.length ? "DIFFERENT " + JSON.stringify(differences).slice(0, 1500) : "equal"}`,
  );
  rmSync(cold);
  for (const suffix of ["-wal", "-shm"])
    if (existsSync(cold + suffix)) rmSync(cold + suffix);
}
writeFileSync(
  outArg,
  JSON.stringify(
    { id, seed: Number(seedArg), steps, equal: steps.every((s) => s.equal) },
    null,
    1,
  ),
);
