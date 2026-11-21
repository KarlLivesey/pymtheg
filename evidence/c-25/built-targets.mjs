// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const [scratch, receipt] = process.argv.slice(2);
const repos = JSON.parse(readFileSync(receipt, "utf8")).repos;
const result = [];
for (const repo of repos) {
  if (repo.outcome !== "finished" || repo.install?.status !== "installed")
    continue;
  const root = realpathSync(resolve(scratch, repo.sourceAttempt ?? repo.attempt, "checkout"));
  const db = new DatabaseSync(
    resolve(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const files = new Map();
  for (const table of ["graph_files", "graph_contexts"])
    for (const { path, body } of db.prepare(`SELECT path, body FROM ${table}`).iterate()) {
      const item = JSON.parse(body);
      if (item.text !== undefined && !item.dependency)
        files.set("/" + path, item.text);
    }
  const dirs = new Map();
  function entries(path) {
    if (!dirs.has(path)) dirs.set(path, { files: [], directories: [] });
    return dirs.get(path);
  }
  for (const file of files.keys()) {
    let dir = posix.dirname(file);
    entries(dir).files.push(posix.basename(file));
    while (dir !== "/") {
      const parent = posix.dirname(dir);
      const list = entries(parent).directories;
      const name = posix.basename(dir);
      if (list.includes(name)) break;
      list.push(name);
      dir = parent;
    }
  }
  const host = {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => "/",
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
    readDirectory: (name, extensions, excludes, includes, depth) =>
      ts.matchFiles(name, extensions, excludes, includes, true, "/", depth,
        (dir) => dirs.get(dir) ?? { files: [], directories: [] }, (name) => name),
    onUnRecoverableConfigFileDiagnostic() {},
  };
  const built = new Set();
  const isOutput = /\.(?:d\.[cm]?ts|[cm]?js|jsx)$/;
  for (const name of files.keys()) {
    if (!/(?:tsconfig|jsconfig)[^/]*\.json$/.test(name)) continue;
    const parsed = ts.getParsedCommandLineOfConfigFile(name, {}, host);
    if (!parsed || parsed.errors.length || parsed.options.noEmit ||
        !(parsed.options.outDir || parsed.options.declarationDir || parsed.options.outFile))
      continue;
    for (const input of parsed.fileNames)
      for (const file of ts.getOutputFileNames(parsed, input, false))
        if (file !== input && isOutput.test(file) && files.has(file))
          built.add(file.slice(1));
  }
  const targets = db.prepare(`SELECT t.file AS path, count(*) AS links
      FROM graph_links l JOIN graph_symbols t ON t.id=l.target
      WHERE l.module='typescript' AND l.resolution='resolved'
      GROUP BY t.file`).all();
  db.close();
  if (targets.some(({ path }) => path.startsWith("/") || path.split("/").includes("..")))
    throw Error("Unsafe graph path");
  const git = (args, input) => {
    const run = spawnSync("git", args, { cwd: root, input, encoding: "utf8", maxBuffer: 16_000_000 });
    if (run.error || ![0, 1].includes(run.status)) throw Error("Could not read Git paths");
    return new Set(run.stdout.split("\0").filter(Boolean));
  };
  const ignored = git(["check-ignore", "--no-index", "-z", "--stdin"],
    targets.map(({ path }) => path + "\0").join(""));
  const tracked = git(["ls-files", "-z"]);
  const safeMap = (path) => {
    if (!/\.d\.[cm]?ts$/.test(path)) return false;
    const file = join(root, path + ".map");
    return existsSync(file) && realpathSync(file).startsWith(root + "/");
  };
  const counts = { pin: repo.id, built: 0, ignoreMatch: 0, ignoredUntracked: 0, declarationMap: 0, builtOrIgnored: 0 };
  for (const { path, links } of targets) {
    if (built.has(path)) counts.built += links;
    if (ignored.has(path)) counts.ignoreMatch += links;
    if (ignored.has(path) && !tracked.has(path)) counts.ignoredUntracked += links;
    if (safeMap(path)) counts.declarationMap += links;
    if (built.has(path) || ignored.has(path) || safeMap(path)) counts.builtOrIgnored += links;
  }
  result.push(counts);
}
console.log(JSON.stringify(result, null, 2));
