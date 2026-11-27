// SPDX-License-Identifier: MIT
// C-50: the CLI's own cost, main against a candidate, one run at a time
// alternating builds. Per pin and build: a cold `graph index` on a fresh
// copy of the pristine checkout, then a one-file edit (a comment line
// appended to the first source file of the pin's language) and an
// incremental `graph index`. Each run is a fresh process under GNU time
// (wall, CPU, peak resident set of the whole process, both threads). The
// size of the JSON response is what crosses from the worker. Both builds
// index the same path, into a store created first with a fixed project id;
// after the last round the two builds' final stores are compared row for
// row (scripts/reindex/dump.mjs).
// Usage: node cli-cost.mjs WORK OUT.json ROUNDS main=DIST head=DIST -- NAME=PIN_DIR...
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareRows, storeRows } from "../../scripts/reindex/dump.mjs";

const args = process.argv.slice(2);
const split = args.indexOf("--");
const [work, out, rounds, ...builds] = args.slice(0, split);
const pins = args.slice(split + 1);
mkdirSync(work, { recursive: true });
const extensions = [".ts", ".tsx", ".go", ".rs"];
const firstSource = (root) => {
  const listed = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout.split("\n").sort();
  return listed.find((path) => extensions.some((e) => path.endsWith(e)) && !path.includes("node_modules"));
};
const runs = [];
const index = (dist, root) => {
  const child = spawnSync("/usr/bin/time", ["-f", "C50TIME %e %U %S %M", process.execPath, join(dist, "cli/main.js"), "graph", "index", "--root", ".", "--json"],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 });
  const line = (child.stderr ?? "").split("\n").find((l) => l.startsWith("C50TIME"));
  const [wall, user, system, peak] = line ? line.split(" ").slice(1).map(Number) : [NaN, NaN, NaN, NaN];
  return { exit: child.status, wallS: wall, cpuS: Math.round((user + system) * 10) / 10, peakMiB: Math.round(peak / 1024), responseBytes: Buffer.byteLength(child.stdout ?? "") };
};
const finals = new Map();
for (const entry of pins) {
  const [name, pin] = entry.split("=");
  const file = firstSource(pin);
  for (let round = 0; round < Number(rounds); round++)
    for (const build of builds) {
      const [label, dist] = build.split("=");
      const root = join(work, name);
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      cpSync(pin, root, { recursive: true, verbatimSymlinks: true, filter: (src) => !src.includes("/.pymtheg") });
      // The store, with a fixed project id, so the two builds' rows compare.
      const created = spawnSync(process.execPath, ["--input-type=module", "-e",
        `import { SqliteGraphStore } from ${JSON.stringify(join(dist, "graph/index.js"))};
         import { mkdirSync } from "node:fs";
         mkdirSync(${JSON.stringify(join(root, ".pymtheg/rebuildable"))}, { recursive: true });
         new SqliteGraphStore(${JSON.stringify(join(root, ".pymtheg/rebuildable/graph.sqlite"))}, "c50-cost").close();`]);
      if (created.status !== 0) throw Error(String(created.stderr));
      const cold = index(dist, root);
      appendFileSync(join(root, file), "\n// c50 edit\n");
      const edit = index(dist, root);
      const run = { pin: name, round, build: label, edited: file, cold, edit };
      runs.push(run);
      console.log(JSON.stringify(run));
      writeFileSync(out, JSON.stringify(runs, null, 1) + "\n");
      if (round === Number(rounds) - 1) {
        const saved = join(work, `${name}-${label}.sqlite`);
        spawnSync("sqlite3", [join(root, ".pymtheg/rebuildable/graph.sqlite"), `.backup ${saved}`]);
        if (!existsSync(saved)) copyFileSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), saved);
        finals.set(`${name}\0${label}`, saved);
      }
    }
  const labels = builds.map((b) => b.split("=")[0]);
  const [a, b] = labels.map((label) => storeRows(finals.get(`${name}\0${label}`)));
  const differences = compareRows(a, b);
  runs.push({ pin: name, equal: differences.length === 0, differences: differences.map((d) => ({ table: d.table, rows: d.onlyIncremental })) });
  console.log(JSON.stringify(runs.at(-1)));
  writeFileSync(out, JSON.stringify(runs, null, 1) + "\n");
}
