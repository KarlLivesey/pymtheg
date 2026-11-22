// SPDX-License-Identifier: MIT
// C-48: the C-45 edit sequence through the MCP server's graph jobs instead
// of a new process per index: a cold index, an unchanged one, then each
// edit of scripts/reindex/cases.json and its revert, all in one GraphJobs
// (one persistent worker with its index session, as the server runs). Each
// step is written as <out dir>/<pin>/<pin>.<step>.json in the shape
// scripts/resident/stages.mjs reads: the worker's counters and stage
// times, the process CPU and wall time of the job, the server's resident
// set after the job and its peak so far. The final store is compared with
// a cold index row for row.
//   node scripts/resident/mcp-edits.mjs <dist> <scratch> <repo id> <out dir> [--edits body,export]
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const editsAt = args.indexOf("--edits");
const edits = editsAt < 0 ? ["body", "export"] : args.splice(editsAt, 2)[1].split(",");
const [distArg, scratch, id, outArg] = args;
const dist = resolve(distArg);
const load = (path) => import(pathToFileURL(join(dist, path)).href);
const { GraphJobs } = await load("mcp/graph-jobs.js");
const { discoverLanguages, indexProject, SqliteGraphStore } = await load("graph/index.js");
const here = new URL(".", import.meta.url).pathname;
const { compareRows, storeRows } = await import(join(here, "../reindex/dump.mjs"));
const cases = JSON.parse(readFileSync(join(here, "../reindex/cases.json"), "utf8"));
const pin = cases.pins.find((item) => item.id === id);
const name = id.replace(/[^A-Za-z0-9._-]/g, "_");
const out = join(resolve(outArg), name);
mkdirSync(out, { recursive: true });
const root = join(scratch, "mcp-work", name);
cpSync(join(scratch, "pins", name), root, { recursive: true });
mkdirSync(join(root, ".pymtheg"), { recursive: true });
const file = join(root, pin.file);
const original = readFileSync(file, "utf8");
const variants = {
  comment: original + pin.comment,
  body: (() => {
    const at = original.indexOf(pin.anchor);
    const end = at + pin.anchor.length;
    return original.slice(0, end) + pin.body + original.slice(end);
  })(),
  export: original + pin.export,
};
const jobs = new GraphJobs(root);
const step = async (label) => {
  const cpu = process.cpuUsage();
  const wall = performance.now();
  const job = jobs.start({ command: "index" });
  await job.done;
  const used = process.cpuUsage(cpu);
  const record = {
    wallMs: Math.round(performance.now() - wall),
    cpuMs: Math.round((used.user + used.system) / 1000),
    startupCpuMs: 0,
    moduleLoadCpuMs: 0,
    state: job.state,
    error: job.error,
    session: job.session,
    generation: jobs.generation,
    rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    maxRssKiB: process.resourceUsage().maxRSS,
    counts: job.work?.counts ?? {},
    stages: job.work?.stages ?? {},
  };
  writeFileSync(join(out, `${name}.${label}.json`), JSON.stringify(record, null, 1));
  console.log(
    `${id} ${label}: ${job.state}, wall ${record.wallMs} ms, cpu ${record.cpuMs} ms, rss ${record.rssMiB} MiB, worker ${record.generation}, session ${JSON.stringify(job.session)}`,
  );
};
try {
  await step("cold");
  await step("warm");
  for (const edit of edits) {
    writeFileSync(file, variants[edit]);
    await step(edit);
    writeFileSync(file, original);
    await step(`${edit}-revert`);
  }
} finally {
  await jobs.close();
}
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
const rows = storeRows(graph);
const coldPath = join(scratch, "mcp-work", `${name}.cold.sqlite`);
const cold = new SqliteGraphStore(coldPath, rows.project[0]);
try {
  await indexProject(root, await discoverLanguages(), cold, { excludeDirectories: [".pymtheg"] });
} finally {
  cold.close();
}
const differences = compareRows(rows, storeRows(coldPath));
console.log(`${id} last revert equals cold: ${differences.length ? "NO " + JSON.stringify(differences).slice(0, 400) : "yes"}`);
