// SPDX-License-Identifier: MIT
// C-52 walk-probe.mjs DIST ROOT STORE OUT.json : a cold index of ROOT with
// DIST's TypeScript module into STORE (a new file), then: each taint walk's
// size and where its steps went (taintStatistics.log, observation counters),
// the failed files by first diagnostic, and the TypeScript links by first
// stored reason. Wall and CPU time and peak memory come from the caller
// (`/usr/bin/time`).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const [dist, root, storePath, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { indexProject, LanguageRegistry, SqliteGraphStore } = await load("graph/index.js");
const registry = await load("graph/languages/index.js").catch(() => undefined);
const typescript = (await load("graph/languages/typescript/index.js")).default;
const { taintStatistics } = await load("graph/languages/typescript/taint.js");
const modules = registry?.defaultModules?.() ?? [typescript];
const store = new SqliteGraphStore(storePath, "c52");
const started = performance.now();
// Progress on stderr: each walk as it ends, with the heap in use.
let logged = 0;
const progress = setInterval(() => {
  for (; logged < taintStatistics.log.length; logged++) console.error("walk", JSON.stringify(taintStatistics.log[logged]));
  console.error("heap", Math.round(process.memoryUsage().heapUsed / 1048576), "MiB");
}, 60000);
progress.unref();
const report = await indexProject(root, new LanguageRegistry(modules), store);
const wallMs = performance.now() - started;
store.close();
const db = new DatabaseSync(storePath, { readOnly: true });
const failed = {};
for (const { body } of db.prepare("SELECT body FROM graph_files WHERE status='failed'").iterate()) {
  const file = JSON.parse(body);
  if (file.module !== "typescript") continue;
  const message = (file.result?.diagnostics?.[0]?.message ?? "(none)")
    .replace(/\d+/g, "N")
    .replace(/'[^']*'/g, "'…'")
    .slice(0, 100);
  const key = `${file.result?.failureKind ?? "?"}: ${message}`;
  failed[key] = (failed[key] ?? 0) + 1;
}
const reasons = {};
for (const { r } of db
  .prepare("SELECT resolution || ':' || coalesce(json_extract(body,'$.data.reason'),'') r FROM graph_links WHERE module='typescript'")
  .iterate())
  reasons[r] = (reasons[r] ?? 0) + 1;
db.close();
const sort = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
const result = {
  wallMs: Math.round(wallMs),
  report: {
    indexed: report.indexed,
    links: report.links,
    failedCount: report.failedCount,
    analysisErrors: report.analysisErrors,
  },
  taint: {
    walks: taintStatistics.walks,
    exhausted: taintStatistics.exhausted,
    maxSteps: taintStatistics.maxSteps,
    log: taintStatistics.log,
  },
  failed: sort(failed),
  reasons: sort(reasons),
};
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify({ ...result, failed: undefined, reasons: undefined, taint: { ...result.taint, log: result.taint.log.filter((w) => w.exhausted || w.steps.fixpoint > 1e6) } }, null, 1).slice(0, 4000));
