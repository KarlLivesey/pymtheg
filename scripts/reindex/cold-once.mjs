// SPDX-License-Identifier: MIT
// A cold index of <root> into a new store at <graph.sqlite> with the given
// project id (ids hash it), with the options `graph index` uses, so the store
// can be compared row for row with an incremental one (dump.mjs).
//   node scripts/reindex/cold-once.mjs <dist> <root> <graph.sqlite> <project id>
import "../isolated-home.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, root, graph, projectId, metrics] = process.argv.slice(2);
if (!dist || !root || !graph || !projectId)
  throw Error("usage: cold-once.mjs <dist> <root> <graph.sqlite> <project id>");
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discoverLanguages, indexProject, SqliteGraphStore } =
  await load("graph/index.js");
const store = new SqliteGraphStore(graph, projectId);
try {
  const started = performance.now();
  const report = await indexProject(root, await discoverLanguages(), store, {
    excludeDirectories: [".pymtheg"],
    signal: new AbortController().signal,
  });
  if (report.analysisErrors.length || report.resolutionErrors.length)
    throw Error(
      JSON.stringify({
        analysis: report.analysisErrors,
        resolution: report.resolutionErrors,
      }),
    );
  if (metrics) {
    const { graphWork } = await load("graph/work.js");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      metrics,
      JSON.stringify({
        report,
        counts: graphWork.counts,
        wallMs: Math.round(performance.now() - started),
      }),
    );
  }
} finally {
  store.close();
}
