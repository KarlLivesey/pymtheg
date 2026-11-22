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
import { readFileSync, writeFileSync } from "node:fs";
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
    ].includes(part) &&
    !/^batch=[1-9][0-9]*$/.test(part) &&
    !/^checkpoint=[0-9]+$/.test(part) &&
    !/^rows=[1-9][0-9]*$/.test(part)
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
// batch=N (measurement only): the store's write transactions are merged,
// N to one commit, by holding the transaction open across N of them. It
// prices fewer, larger transactions; it does not keep the run's crash rules.
const batch = Number(
  [...parts].find((part) => part.startsWith("batch="))?.slice(6) ?? 1,
);
// checkpoint=N (measurement only): the write-ahead log checkpoints every N
// pages instead of 10,000; 0 leaves the whole log to the checkpoint on close.
const checkpoint = [...parts]
  .find((part) => part.startsWith("checkpoint="))
  ?.slice(11);
let held = 0;
// The write lock's longest hold: BEGIN IMMEDIATE to COMMIT or ROLLBACK.
let lockedAt;
let longestHoldMs = 0;
let holds = 0;
// Holds over a second, with the first writing statement and the count of
// statements in them, to say what held the lock.
const longHolds = [];
let holdFirst;
let holdStatements = 0;
let heldDeferred = 0;
proto.exec = function (sql) {
  if (sql === "BEGIN IMMEDIATE") lockedAt = performance.now();
  else if (
    lockedAt !== undefined &&
    (sql === "COMMIT" || sql.startsWith("ROLLBACK;") || sql === "ROLLBACK")
  ) {
    const held = performance.now() - lockedAt;
    longestHoldMs = Math.max(longestHoldMs, held);
    if (held > 1000)
      longHolds.push({
        ms: Math.round(held),
        first: holdFirst,
        statements: holdStatements,
      });
    holds++;
    lockedAt = undefined;
    holdFirst = undefined;
    holdStatements = 0;
  }
  if (checkpoint !== undefined && sql.includes("wal_autocheckpoint=10000"))
    sql = sql.replace(
      "wal_autocheckpoint=10000",
      `wal_autocheckpoint=${checkpoint}`,
    );
  if (parts.has("temp-memory") && sql.includes("PRAGMA foreign_keys=ON"))
    exec.call(this, "PRAGMA temp_store=MEMORY");
  if (batch > 1) {
    const open = this.isTransaction;
    if (sql === "BEGIN IMMEDIATE" && open && held) return;
    if (sql === "BEGIN" && open && held) {
      heldDeferred++;
      return;
    }
    if (sql === "COMMIT" && heldDeferred) {
      heldDeferred--;
      return;
    }
    if (sql === "COMMIT" && ++held < batch) return;
    if (sql === "COMMIT") held = 0;
    if (sql === "ROLLBACK") held = 0;
    if (
      /^PRAGMA (journal_mode|synchronous=FULL|temp_store=MEMORY)/.test(sql) &&
      open &&
      held
    ) {
      if (sql.startsWith("PRAGMA temp_store")) return;
      held = 0;
      exec.call(this, "COMMIT");
    }
  }
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
      if (lockedAt !== undefined) {
        holdStatements++;
        if (holdFirst === undefined && !/^(SELECT|PRAGMA)/.test(sql))
          holdFirst = key(sql).slice(0, 80);
      }
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
// rows=N: the store's write batch budget instead of its default.
const rows = [...parts].find((part) => part.startsWith("rows="))?.slice(5);
if (rows !== undefined) SqliteGraphStore.writeBatchRows = Number(rows);
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
const io = () =>
  Object.fromEntries(
    readFileSync("/proc/self/io", "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(": "))
      .map(([name, value]) => [name, Number(value)]),
  );
const ioBefore = io();
const cpu = process.cpuUsage();
const wall = performance.now();
let report;
let lateIndexMs = 0;
let closeMs = 0;
try {
  report = await indexProject(root, registry, store, {
    excludeDirectories: [".pymtheg"],
    signal: new AbortController().signal,
  });
} finally {
  const closing = performance.now();
  store.close();
  closeMs = performance.now() - closing;
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
      closeMs: Math.round(closeMs),
      writeBatchRows: SqliteGraphStore.writeBatchRows,
      longestHoldMs: Math.round(longestHoldMs),
      holds,
      longHolds: longHolds.sort((a, b) => b.ms - a.ms).slice(0, 20),
      maxRssKiB: process.resourceUsage().maxRSS,
      // Bytes this process wrote: write_bytes reached the storage layer
      // (page cache of the disk or memory-backed file system).
      io: Object.fromEntries(
        Object.entries(io()).map(([name, value]) => [
          name,
          value - ioBefore[name],
        ]),
      ),
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
