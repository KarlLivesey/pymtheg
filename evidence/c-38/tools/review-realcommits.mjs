// Reviewer's real-commit replay (PR 50, round 2). Run from the mirrored tree:
//   node g6.mjs <dist> <repo copy with full history and node_modules> <work> <out.json> <pin commit> <count>
// For each of the last <count> single-file commits touching one analysed
// TypeScript/JavaScript source: index the parent, check out the commit,
// index again (what a user's re-index does), record scoped or the declined
// reasons, and compare that store with a cold index of the same tree.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [distArg, repo, work, out, pinCommit, countArg] = process.argv.slice(2);
const tree = process.cwd();
const { compareRows, storeRows } = await import(
  pathToFileURL(join(tree, "scripts/reindex/dump.mjs")).href
);
const dist = resolve(distArg);
mkdirSync(work, { recursive: true });
const git = (...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
const node = (script, ...rest) =>
  execFileSync(process.execPath, [script, ...rest], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
  });
const indexOnce = (metrics) =>
  node(join(tree, "scripts/reindex/index-once.mjs"), dist, repo, metrics);
const listFile = join(work, "commits.json");
if (!existsSync(listFile)) {
  const commits = git("log", "--format=%H %P", "-n", "3000", pinCommit)
    .trim()
    .split("\n")
    .map((line) => line.split(" "))
    .filter((parts) => parts.length === 2);
  const chosen = [];
  for (const [commit, parent] of commits) {
    const changed = git("diff", "--name-only", parent, commit).trim().split("\n");
    if (
      changed.length === 1 &&
      /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(changed[0]) &&
      !/\.d\.[cm]?ts$/.test(changed[0])
    )
      chosen.push({ commit, parent, file: changed[0] });
    if (chosen.length >= Number(countArg)) break;
  }
  writeFileSync(listFile, JSON.stringify(chosen, null, 1));
}
const chosen = JSON.parse(readFileSync(listFile, "utf8"));
const results = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : [];
const limit = Number(process.env.G6_CHUNK ?? chosen.length);
const graph = join(repo, ".pymtheg/rebuildable/graph.sqlite");
let done = 0;
for (const [i, item] of chosen.entries()) {
  if (i < results.length) continue;
  if (done++ >= limit) break;
  git("checkout", "-q", "--force", "--detach", item.parent);
  if (!existsSync(graph))
    node(join(dist, "cli/main.js"), "init", ".", "--name", "g6", "--format", "json");
  indexOnce(join(work, `parent-${i}.json`));
  git("checkout", "-q", "--force", "--detach", item.commit);
  const metrics = join(work, `commit-${i}.json`);
  indexOnce(metrics);
  const m = JSON.parse(readFileSync(metrics, "utf8"));
  const cold = join(work, "cold.sqlite");
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(cold + suffix)) rmSync(cold + suffix);
  node(join(tree, "scripts/reindex/cold-once.mjs"), dist, repo, cold, storeRows(graph).project[0]);
  const differences = compareRows(storeRows(graph), storeRows(cold));
  const diff = git("diff", "--unified=0", item.parent, item.commit)
    .split("\n")
    .filter((line) => /^[-+](?![-+])/.test(line));
  const record = {
    ...item,
    changedLines: diff.length,
    touchesReturn: diff.some((line) => /\breturn\b/.test(line)),
    scoped: m.typescript?.scoped ?? 0,
    extracted: m.typescript?.extracted ?? 0,
    declined: m.typescript?.declined ?? {},
    indexed: m.report?.indexed,
    cpuMs: m.cpuMs,
    equal: differences.length === 0,
    differences: differences.slice(0, 2),
  };
  results.push(record);
  console.log(
    `${i} ${item.commit.slice(0, 8)} ${item.file} lines=${record.changedLines} return=${record.touchesReturn} scoped=${record.scoped} extracted=${record.extracted} declined=${JSON.stringify(record.declined)} equal=${record.equal}` +
      (differences.length ? ` DIFF ${JSON.stringify(differences).slice(0, 800)}` : ""),
  );
  writeFileSync(out, JSON.stringify(results, null, 1));
}
