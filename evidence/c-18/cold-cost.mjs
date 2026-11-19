// SPDX-License-Identifier: MIT
// Use the original pinned sources and one tmpfs for three fresh graph stores.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteGraphStore } from "../../dist/graph/store.js";

const [scratch, results, work, base, candidate] = process.argv.slice(2);
const run = JSON.parse(readFileSync(results, "utf8"));
for (const id of ["serde-rs/serde", "helix-editor/helix"]) {
  const pin = run.repos.find((repo) => repo.id === id);
  if (pin?.outcome !== "finished") throw Error(`Missing completed pin ${id}`);
  const source = join(work, pin.attempt, "checkout");
  const storePath = ".pymtheg/rebuildable";
  const prior = new DatabaseSync(join(source, storePath, "graph.sqlite"), { readOnly: true });
  const { value: project } = prior.prepare("SELECT value FROM graph_meta WHERE key='project'").get();
  prior.close();
  for (const [label, build] of [["base-1", base], ["candidate", candidate], ["base-2", base]]) {
    const directory = join(scratch, "cold-cost", id.split("/")[1], label);
    const checkout = join(directory, "checkout");
    mkdirSync(directory, { recursive: true });
    cpSync(source, checkout, {
      recursive: true,
      filter: (file) => file !== join(source, storePath),
    });
    mkdirSync(join(checkout, storePath), { recursive: true });
    new SqliteGraphStore(join(checkout, storePath, "graph.sqlite"), project).close();
    const measure = join(directory, "time.txt");
    const child = spawnSync("/usr/bin/time", [
      "-q", "-f", "%U %S %e %M", "-o", measure,
      process.execPath, resolve(build, "dist/cli/main.js"),
      "graph", "index", "--root", ".", "--json",
    ], { cwd: checkout, maxBuffer: 32 * 1024 * 1024 });
    if (child.error) throw child.error;
    writeFileSync(join(directory, "index.json"), child.stdout);
    writeFileSync(join(directory, "index.err"), child.stderr);
    const body = JSON.parse(child.stdout.toString("utf8"));
    if (![0, 2].includes(child.status) || body.sync?.complete !== true || !body.counts)
      throw Error(`Cold index did not finish for ${id} ${label}`);
    console.log(id, label, readFileSync(measure, "utf8").trim(), body.counts.links);
  }
}
