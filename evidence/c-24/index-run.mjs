// SPDX-License-Identifier: MIT
// C-24: cold-index one pinned checkout with a given build under a fixed graph
// project identity, then write the normalised store dump next to the timing.
// Usage: node index-run.mjs BUILD CHECKOUT PROJECT OUT_PREFIX
// The checkout is reused between runs; its graph store files are removed
// first so every run is cold. Writes OUT_PREFIX.dump.gz, .time.txt, .index.json.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { dump } from "./normalise.mjs";

const [build, checkout, project, out] = process.argv.slice(2).map(String);
const cli = join(resolve(build), "dist/cli/main.js");
const directory = join(checkout, ".pymtheg/rebuildable");
for (const suffix of ["", "-wal", "-shm", "-journal"])
  rmSync(join(directory, "graph.sqlite" + suffix), { force: true });
if (!existsSync(join(checkout, ".pymtheg"))) {
  const init = spawnSync(
    process.execPath,
    [cli, "init", ".", "--name", "c24", "--format", "json"],
    { cwd: checkout, encoding: "utf8" },
  );
  if (init.status !== 0) throw Error("init failed: " + init.stderr);
}
mkdirSync(directory, { recursive: true });
const { SqliteGraphStore } = await import(
  join(resolve(build), "dist/graph/store.js")
);
new SqliteGraphStore(join(directory, "graph.sqlite"), project).close();
const index = spawnSync(
  "/usr/bin/time",
  ["-v", process.execPath, cli, "graph", "index", "--root", ".", "--json"],
  { cwd: checkout, encoding: "utf8", maxBuffer: 1 << 30 },
);
writeFileSync(out + ".index.json", index.stdout);
writeFileSync(out + ".time.txt", index.stderr);
writeFileSync(
  out + ".dump.gz",
  gzipSync(dump(join(directory, "graph.sqlite")).join("\n") + "\n"),
);
// KEEP=1 keeps a compact copy of the finished store as OUT_PREFIX.sqlite.
if (process.env.KEEP) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(directory, "graph.sqlite"));
  db.exec(`VACUUM INTO '${resolve(out + ".sqlite").replaceAll("'", "''")}'`);
  db.close();
}
console.log(out, "exit", index.status);
