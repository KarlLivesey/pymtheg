// SPDX-License-Identifier: MIT
// C-35: what a cold index spends in the store. Runs one cold index of
// <root> into a new store at <graph.sqlite> (the options `graph index` uses)
// and records, per SQL statement text: calls, wall time (including the
// triggers and index maintenance it causes), rows changed and bytes bound;
// transactions; the indexer's stages and work counts; and, after the run,
// the pages and payload bytes of every table and index (dbstat) and the
// row count of every table. Measurement variants change only the store's
// schema for this run, to price one candidate at a time:
//   --variant no-dirty-triggers   drop the 21 completion-invalidation triggers
//   --variant late-indexes        drop the secondary indexes, build them after
//   --variant temp-memory         the store's connection keeps temporary files
//                                 (statement journals) in memory
// Timings are observations; counts are deterministic.
//   node scripts/store-cost/measure.mjs <dist> <root> <graph.sqlite> <out.json> [--variant V]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sqlite from "node:sqlite";

const [dist, root, graph, out, ...flags] = process.argv.slice(2);
if (!out)
  throw Error(
    "usage: measure.mjs <dist> <root> <graph.sqlite> <out.json> [--variant V]",
  );
const variantAt = flags.indexOf("--variant");
// Variants combine with "+", for example temp-memory+late-indexes.
const variant = variantAt < 0 ? "production" : flags[variantAt + 1];
const parts = new Set(variant.split("+"));
for (const part of parts)
  if (
    ![
      "production",
      "no-dirty-triggers",
      "late-indexes",
      "temp-memory",
    ].includes(part)
  )
    throw Error(`unknown variant ${part}`);

const statements = new Map();
const key = (sql) => sql.replace(/\s+/g, " ").trim().slice(0, 160);
const entry = (sql) => {
  const k = key(sql);
  let e = statements.get(k);
  if (!e)
    statements.set(
      k,
      (e = {
        calls: 0,
        wallMs: 0,
        changes: 0,
        bytes: 0,
        prepares: 0,
        prepareMs: 0,
      }),
    );
  return e;
};
const bound = (args) => {
  let bytes = 0;
  for (const arg of args)
    if (typeof arg === "string") bytes += Buffer.byteLength(arg);
  return bytes;
};
const proto = sqlite.DatabaseSync.prototype;
const prepare = proto.prepare;
const exec = proto.exec;
let inStatement = false;
proto.exec = function (sql) {
  if (parts.has("temp-memory") && sql.includes("PRAGMA foreign_keys=ON"))
    exec.call(this, "PRAGMA temp_store=MEMORY");
  const e = entry(sql);
  const started = performance.now();
  try {
    return exec.call(this, sql);
  } finally {
    e.calls++;
    e.wallMs += performance.now() - started;
  }
};
proto.prepare = function (sql, ...rest) {
  const e = entry(sql);
  const preparing = performance.now();
  const statement = prepare.call(this, sql, ...rest);
  e.prepares++;
  e.prepareMs += performance.now() - preparing;
  // Whether the plan sorts or deduplicates in a temporary B-tree (which
  // temp_store decides the place of), or uses a temporary index.
  if (
    e.temporary === undefined &&
    /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)/i.test(sql)
  )
    try {
      e.temporary = prepare
        .call(this, `EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => row.detail)
        .filter((detail) => /TEMP|AUTOMATIC/.test(detail));
    } catch {
      e.temporary = null;
    }
  for (const method of ["run", "get", "all", "iterate"]) {
    const original = statement[method];
    statement[method] = function (...args) {
      if (inStatement) return original.apply(this, args);
      inStatement = true;
      const started = performance.now();
      try {
        const result = original.apply(this, args);
        if (method === "run") e.changes += Number(result.changes);
        return result;
      } finally {
        inStatement = false;
        e.calls++;
        e.bytes += bound(args);
        e.wallMs += performance.now() - started;
      }
    };
  }
  return statement;
};

const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discoverLanguages, indexProject, SqliteGraphStore } =
  await load("graph/index.js");
const { graphWork, resetGraphWork } = await load("graph/work.js");
const registry = await discoverLanguages();
const store = new SqliteGraphStore(graph, "c35-measure");
// The schema changes of a variant go through their own connection, before
// the run: the store's connection sees them as another writer's commit.
const side = new sqlite.DatabaseSync(graph);
const indexes = side
  .prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name",
  )
  .all();
if (parts.has("no-dirty-triggers"))
  for (const row of side
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'graph_index_dirty_%'",
    )
    .all())
    side.exec(`DROP TRIGGER ${row.name}`);
if (parts.has("late-indexes"))
  for (const row of indexes)
    if (row.name !== "graph_file_status") side.exec(`DROP INDEX ${row.name}`);
side.close();
resetGraphWork();
statements.clear();
const cpu = process.cpuUsage();
const wall = performance.now();
let report;
let lateIndexMs = 0;
try {
  report = await indexProject(root, registry, store, {
    excludeDirectories: [".pymtheg"],
    signal: new AbortController().signal,
  });
} finally {
  store.close();
}
if (parts.has("late-indexes")) {
  const db = new sqlite.DatabaseSync(graph);
  const started = performance.now();
  for (const row of indexes)
    if (row.name !== "graph_file_status") db.exec(row.sql);
  lateIndexMs = performance.now() - started;
  db.close();
}
const used = process.cpuUsage(cpu);
const wallMs = performance.now() - wall;

const db = new sqlite.DatabaseSync(graph, { readOnly: true });
const objects = db
  .prepare(
    `SELECT s.name, m.type, m.tbl_name AS tbl, count(*) AS pages,
      sum(s.payload) AS payload, sum(s.unused) AS unused, sum(s.pgsize) AS bytes
    FROM dbstat s LEFT JOIN sqlite_master m ON m.name=s.name
    GROUP BY s.name ORDER BY bytes DESC`,
  )
  .all()
  .map((row) => ({ ...row }));
const tables = Object.fromEntries(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map(({ name }) => [
      name,
      Number(db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n),
    ]),
);
// Where the bytes of graph_files.body go: the source text, the parse result
// (symbols, links), and the rest of the record.
const fileBody = db
  .prepare(
    `SELECT sum(length(body)) AS body, sum(length(json_extract(body,'$.text'))) AS text,
      sum(length(json_extract(body,'$.result'))) AS result,
      sum(length(json_extract(body,'$.result.symbols'))) AS symbols,
      sum(length(json_extract(body,'$.result.links'))) AS links
    FROM graph_files`,
  )
  .get();
const pageSize = Number(db.prepare("PRAGMA page_size").get().page_size);
const pageCount = Number(db.prepare("PRAGMA page_count").get().page_count);
db.close();

writeFileSync(
  out,
  JSON.stringify(
    {
      variant,
      wallMs: Math.round(wallMs),
      cpuMs: Math.round((used.user + used.system) / 1000),
      lateIndexMs: Math.round(lateIndexMs),
      maxRssKiB: process.resourceUsage().maxRSS,
      report: {
        claimed: report.claimed,
        failedCount: report.failedCount,
        symbols: report.symbols,
        links: report.links,
        analysisErrors: report.analysisErrors.length,
        resolutionErrors: report.resolutionErrors.length,
      },
      databaseBytes: pageSize * pageCount,
      fileBody: { ...fileBody },
      objects,
      tables,
      statements: [...statements]
        .map(([sql, e]) => ({
          sql,
          ...e,
          wallMs: Math.round(e.wallMs),
          prepareMs: Math.round(e.prepareMs),
        }))
        .sort((a, b) => b.wallMs - a.wallMs),
      stages: Object.fromEntries(
        Object.entries(graphWork.stages).map(([name, time]) => [
          name,
          {
            wallMs: Math.round(time.wallMs),
            cpuMs: Math.round(time.cpuMs),
            calls: time.calls,
          },
        ]),
      ),
      counts: graphWork.counts,
    },
    null,
    1,
  ),
);
