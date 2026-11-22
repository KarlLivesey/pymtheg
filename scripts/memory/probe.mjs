// SPDX-License-Identifier: MIT
// C-40: what a cold index holds in memory, phase by phase. Runs one cold
// index of <root> into <graph.sqlite> with the options `graph index` uses
// and records, after a full garbage collection, the live heap and RSS at
// every phase boundary: each module's analysis input, its returned results
// (with their count and serialized size), every 2,000 file writes, and
// before and after each resolution write. Needs --expose-gc. Counts and
// sizes are deterministic; heap figures are as V8 reports them.
//   node --expose-gc [--max-old-space-size=N] scripts/memory/probe.mjs <dist> <root> <graph.sqlite> <out.json>
import "../isolated-home.mjs";
import { writeFileSync } from "node:fs";
import { writeHeapSnapshot } from "node:v8";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, root, graph, out] = process.argv.slice(2);
if (!out || typeof globalThis.gc !== "function")
  throw Error(
    "usage: node --expose-gc probe.mjs <dist> <root> <graph.sqlite> <out.json>",
  );
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discoverLanguages, indexProject, LanguageRegistry, SqliteGraphStore } =
  await load("graph/index.js");
const started = performance.now();
const samples = [];
const mib = (bytes) => Math.round(bytes / 1048576);
// --snapshot <point>: a heap snapshot (beside <out>) at the first sample
// whose point contains that text, to see what is retained there.
const snapshotAt = process.argv.indexOf("--snapshot");
const snapshotPoint = snapshotAt < 0 ? undefined : process.argv[snapshotAt + 1];
let snapshotTaken = false;
function sample(point, extra = {}) {
  globalThis.gc();
  if (snapshotPoint && !snapshotTaken && point.includes(snapshotPoint)) {
    snapshotTaken = true;
    writeHeapSnapshot(`${out}.heapsnapshot`);
  }
  const memory = process.memoryUsage();
  samples.push({
    point,
    seconds: Math.round((performance.now() - started) / 1000),
    heapUsedMiB: mib(memory.heapUsed),
    externalMiB: mib(memory.external + memory.arrayBuffers),
    rssMiB: mib(memory.rss),
    ...extra,
  });
  writeFileSync(out, JSON.stringify({ samples }, null, 1));
}
const registry = await discoverLanguages();
const modules = registry.modules.map((module) => ({
  ...module,
  ...(module.analyze
    ? {
        async analyze(context) {
          sample(`${module.id} analyze input`, { files: context.files.length });
          const output = await module.analyze(context);
          const results = "resolutionFiles" in output ? output.files : output;
          let bytes = 0;
          let links = 0;
          let symbols = 0;
          for (const item of results) {
            bytes += JSON.stringify(item.result).length;
            links += item.result.links?.length ?? 0;
            symbols += item.result.symbols?.length ?? 0;
          }
          sample(`${module.id} analyze returned`, {
            results: results.length,
            resultJsonMiB: mib(bytes),
            links,
            symbols,
          });
          return output;
        },
      }
    : {}),
  ...(module.resolve
    ? {
        async resolve(context) {
          sample(`${module.id} resolve input`, {
            files: context.files.length,
            symbols: context.symbols.length,
            links: context.links.length,
          });
          const result = await module.resolve(context);
          sample(`${module.id} resolve returned`, {
            resolutions: result.resolutions.length,
            added: result.links.length,
          });
          return result;
        },
      }
    : {}),
}));
const proto = SqliteGraphStore.prototype;
let writes = 0;
const replaceFile = proto.replaceFile;
proto.replaceFile = function (...args) {
  const result = replaceFile.apply(this, args);
  if (++writes % 2000 === 0) sample("file writes", { writes });
  return result;
};
const replaceAnalysis = proto.replaceAnalysis;
proto.replaceAnalysis = function (module, ...rest) {
  sample(`${module} resolution write begins`);
  const result = replaceAnalysis.call(this, module, ...rest);
  sample(`${module} resolution write ended`);
  return result;
};
const store = new SqliteGraphStore(graph, "c40-probe");
sample("start");
try {
  const report = await indexProject(
    root,
    new LanguageRegistry(modules),
    store,
    {
      excludeDirectories: [".pymtheg"],
      signal: new AbortController().signal,
    },
  );
  sample("indexed", {
    symbols: report.symbols,
    links: report.links,
    failed: report.failedCount,
  });
} finally {
  store.close();
}
writeFileSync(
  out,
  JSON.stringify(
    { samples, maxRssMiB: mib(process.resourceUsage().maxRSS * 1024) },
    null,
    1,
  ),
);
