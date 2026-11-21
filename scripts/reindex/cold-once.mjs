// SPDX-License-Identifier: MIT
// A cold index of <root> into a new store at <graph.sqlite> with the given
// project id (ids hash it), with the options `graph index` uses, so the store
// can be compared row for row with an incremental one (dump.mjs).
//   node scripts/reindex/cold-once.mjs <dist> <root> <graph.sqlite> <project id>
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, root, graph, projectId] = process.argv.slice(2);
if (!dist || !root || !graph || !projectId)
  throw Error("usage: cold-once.mjs <dist> <root> <graph.sqlite> <project id>");
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discoverLanguages, indexProject, SqliteGraphStore } =
  await load("graph/index.js");
const store = new SqliteGraphStore(graph, projectId);
try {
  await indexProject(root, await discoverLanguages(), store, {
    excludeDirectories: [".pymtheg"],
    signal: new AbortController().signal,
  });
} finally {
  store.close();
}
