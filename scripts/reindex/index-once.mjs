// SPDX-License-Identifier: MIT
// One `graph index` in a fresh process, exactly as the CLI runs it (same
// entry point, an abort signal, progress on), recording the C-22 work
// counters, per-stage times, CPU time and peak memory.
//   node scripts/reindex/index-once.mjs <dist dir> <project root> <out.json>
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, root, out] = process.argv.slice(2);
if (!dist || !root || !out)
  throw Error("usage: index-once.mjs <dist> <root> <out.json>");
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { executeGraph } = await load("graph/commands.js");
const work = await load("graph/work.js").catch(() => undefined);
const typescript = await load("graph/languages/typescript/index.js");
work?.resetGraphWork();
const cpu = process.cpuUsage();
const wall = performance.now();
const response = await executeGraph(
  { command: "index", root },
  { signal: new AbortController().signal, progress: () => {} },
);
const wallMs = performance.now() - wall;
const used = process.cpuUsage(cpu);
const report = response.sync.report;
writeFileSync(
  out,
  JSON.stringify(
    {
      wallMs: Math.round(wallMs),
      cpuMs: Math.round((used.user + used.system) / 1000),
      // Peak resident set of this process, in KiB.
      maxRssKiB: process.resourceUsage().maxRSS,
      complete: response.sync.complete,
      report: report && {
        discovered: report.discovered,
        claimed: report.claimed,
        indexed: report.indexed,
        unchanged: report.unchanged,
        removed: report.removed,
        symbols: report.symbols,
        links: report.links,
        unresolved: report.unresolved,
        ambiguous: report.ambiguous,
        library: report.library,
        failedCount: report.failedCount,
        errors: report.errors.length,
        analysisErrors: report.analysisErrors,
        resolutionErrors: report.resolutionErrors,
      },
      counts: work ? { ...work.graphWork.counts } : null,
      typescript: { ...typescript.statistics },
      stages: work
        ? Object.fromEntries(
            Object.entries(work.graphWork.stages).map(([name, time]) => [
              name,
              {
                wallMs: Math.round(time.wallMs),
                cpuMs: Math.round(time.cpuMs),
                calls: time.calls,
              },
            ]),
          )
        : null,
    },
    null,
    1,
  ),
);
