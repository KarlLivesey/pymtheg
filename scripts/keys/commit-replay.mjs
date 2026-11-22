// SPDX-License-Identifier: MIT
// C-49: what real single-file commits rewrite in the store. Replays, on a
// copy of the pin, the last <count> first-parent commits that changed one
// indexed source file and whose change still applies to the pin: each commit
// is undone on the pin (its reverse patch), indexed with `graph index` (a
// fresh process, as the CLI), compared with the store before it, then
// redone and indexed again, which must give back the first store row for
// row. Per commit it counts the files and rows written, and the files and
// rows whose meaning changed (keys replaced by symbol ids, meaning.mjs).
// The commits are chosen once into <commits.json> (with their patches) so
// every build replays the same edits.
//   node scripts/keys/commit-replay.mjs <dist> <scratch> <repo id> <count> <commits.json> <out.json>
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { compareRows, storeRows } from "../reindex/dump.mjs";
import { meaningRows, written } from "./meaning.mjs";

const [distArg, scratch, id, countArg, commitsPath, out] =
  process.argv.slice(2);
if (!out)
  throw Error(
    "usage: commit-replay.mjs <dist> <scratch> <repo id> <count> <commits.json> <out.json>",
  );
const dist = resolve(distArg);
const count = Number(countArg);
const manifest = JSON.parse(readFileSync("sweep/repos.json", "utf8"));
const repo = (manifest.repos ?? manifest).find((item) => item.id === id);
const name = id.replace(/[^A-Za-z0-9._-]/g, "_");
const pin = join(scratch, "pins", name);
const extensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    maxBuffer: 1 << 28,
  }).toString();

if (!existsSync(commitsPath)) {
  // History lives in a separate clone so the pin stays as fetched.
  const history = join(scratch, "history", name);
  if (!existsSync(history)) {
    mkdirSync(history, { recursive: true });
    git(history, "init", "--template=", "--quiet");
    git(
      history,
      "fetch",
      "--quiet",
      "--depth",
      "600",
      "--no-tags",
      repo.url,
      repo.commit,
    );
  }
  const commits = git(
    history,
    "rev-list",
    "--first-parent",
    "-n",
    "599",
    repo.commit,
  )
    .trim()
    .split("\n");
  const chosen = [];
  for (const commit of commits) {
    if (chosen.length >= count) break;
    const files = git(history, "diff", "--name-only", `${commit}^`, commit)
      .trim()
      .split("\n")
      .filter(Boolean);
    if (files.length !== 1) continue;
    const [file] = files;
    if (!extensions.some((extension) => file.endsWith(extension))) continue;
    if (!existsSync(join(pin, file))) continue;
    const patch = git(
      history,
      "diff",
      "--binary",
      commit,
      `${commit}^`,
      "--",
      file,
    );
    const patchPath = join(scratch, "history", `${name}.${commit}.patch`);
    writeFileSync(patchPath, patch);
    try {
      git(pin, "apply", "--check", patchPath);
    } catch {
      continue;
    }
    chosen.push({ commit, file, patch: patchPath });
  }
  writeFileSync(commitsPath, JSON.stringify(chosen, null, 1));
}
const commits = JSON.parse(readFileSync(commitsPath, "utf8"));

const label = out.replace(/^.*\//, "").replace(/\.json$/, "");
const base = join(scratch, "replay", `${name}.${label}`);
if (existsSync(base)) throw Error(`exists: ${base}`);
mkdirSync(base, { recursive: true });
const root = join(base, "tree");
cpSync(pin, root, { recursive: true, verbatimSymlinks: true });
const here = new URL(".", import.meta.url).pathname;
const index = (metrics) =>
  execFileSync(
    process.execPath,
    [join(here, "../reindex/index-once.mjs"), dist, root, metrics],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
execFileSync(
  process.execPath,
  [join(dist, "cli/main.js"), "init", ".", "--name", name, "--format", "json"],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
index(join(base, "first.json"));
let first = storeRows(graph);
let firstMeaning = meaningRows(graph);
const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const steps = [];
for (const [step, { commit, file, patch }] of commits.entries()) {
  git(root, "apply", patch);
  index(join(base, `undo-${step}.json`));
  const after = storeRows(graph);
  const afterMeaning = meaningRows(graph);
  const rows = written(first, after);
  const meaning = written(firstMeaning, afterMeaning);
  const changedFiles = (rowsBefore, rowsAfter) => {
    const old = new Set(rowsBefore.graph_files);
    return rowsAfter.graph_files
      .filter((row) => !old.has(row))
      .map((row) => JSON.parse(row).path);
  };
  const files = changedFiles(first, after);
  const meaningFiles = changedFiles(firstMeaning, afterMeaning);
  const metrics = JSON.parse(
    readFileSync(join(base, `undo-${step}.json`), "utf8"),
  );
  git(root, "apply", "-R", patch);
  index(join(base, `redo-${step}.json`));
  const differences = compareRows(storeRows(graph), first);
  steps.push({
    step,
    commit,
    file,
    filesWritten: files.length,
    otherFilesWritten: files.filter((path) => path !== file).length,
    filesChangedInMeaning: meaningFiles.length,
    rowsWritten: sum(rows),
    rowsChangedInMeaning: sum(meaning),
    rows,
    meaning,
    examples: files.filter((path) => path !== file).slice(0, 5),
    wallMs: metrics.wallMs,
    cpuMs: metrics.cpuMs,
    redoEqualsFirst: differences.length === 0,
    ...(differences.length ? { redoDifferences: differences } : {}),
  });
  console.log(
    `${id} ${step} ${file}: files ${files.length} (meaning ${meaningFiles.length}), rows ${sum(rows)} (meaning ${sum(meaning)})${differences.length ? " REDO DIFFERS" : ""}`,
  );
  writeFileSync(out, JSON.stringify({ id, label, steps }, null, 1));
  // Later steps are measured against the store as it now is.
  if (differences.length) {
    first = storeRows(graph);
    firstMeaning = meaningRows(graph);
  }
}
writeFileSync(out, JSON.stringify({ id, label, steps }, null, 1));
