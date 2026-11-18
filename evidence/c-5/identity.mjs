// SPDX-License-Identifier: MIT
// Row identity check for C-5. Indexes one checkout with the graph core of
// one build under a fixed project id, then prints a digest of every stored
// table, sorted. Two builds store identical rows when every digest matches.
// Usage: node identity.mjs BUILD_DIR CHECKOUT GRAPH_PATH
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [build, checkout, path] = process.argv.slice(2);
const core = (file) => import(pathToFileURL(join(build, "dist/graph", file)).href);
const { SqliteGraphStore } = await core("store.js");
const { indexProject } = await core("indexer.js");
const { discoverLanguages } = await core("registry.js");
const store = new SqliteGraphStore(path, "c5-identity");
const report = await indexProject(checkout, await discoverLanguages(), store, {
  excludeDirectories: [".pymtheg", "node_modules", ".codegraph"],
});
store.close();
const db = new DatabaseSync(path, { readOnly: true });
const tables = {};
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
  const columns = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
  const hash = createHash("sha256");
  let rows = 0;
  for (const row of db.prepare(`SELECT * FROM ${name} ORDER BY ${columns.join(",")}`).iterate()) {
    // The schema version is the one field expected to differ.
    if (name === "graph_meta" && row.key === "schema") continue;
    hash.update(JSON.stringify(columns.map((c) => row[c])) + "\n");
    rows++;
  }
  tables[name] = { rows, sha256: hash.digest("hex") };
}
const schema = db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get().value;
db.close();
console.log(JSON.stringify({ checkout: checkout.split("/").slice(-2).join("/"), schema,
  links: report.links, unresolved: report.unresolved, ambiguous: report.ambiguous, library: report.library ?? null, tables }));
