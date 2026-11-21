// SPDX-License-Identifier: MIT
// C-35: the per-row cost of the graph schema's writes, isolated. Creates a
// store with the production schema in <dir>, then times inserting <files>
// files of <per> symbols and links each (one transaction per file, as
// replaceFile does) under each variant of the schema:
//   production          as the store creates it
//   no-dirty-triggers   without the completion-invalidation triggers
//   no-foreign-keys     PRAGMA foreign_keys=OFF
//   no-secondary        without the secondary indexes
//   temp-memory         PRAGMA temp_store=MEMORY (statement journals in memory)
//   temp-memory-at-begin  MEMORY only while each write transaction begins
// Prints microseconds per row. Timings are observations.
//   node scripts/store-cost/micro.mjs <dist> <dir> [files] [per]
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sqlite from "node:sqlite";

const [dist, dir, filesArg, perArg] = process.argv.slice(2);
const files = Number(filesArg ?? 200);
const per = Number(perArg ?? 50);
const { SqliteGraphStore } = await import(
  pathToFileURL(resolve(dist, "graph/index.js")).href
);
const pad = "x".repeat(600);
for (const variant of [
  "production",
  "no-dirty-triggers",
  "no-foreign-keys",
  "no-secondary",
  "temp-memory",
  "temp-memory-at-begin",
  "production",
]) {
  const path = join(dir, `micro-${variant}.sqlite`);
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(path + suffix)) rmSync(path + suffix);
  new SqliteGraphStore(path, "micro").close();
  const db = new sqlite.DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL");
  db.exec(
    "PRAGMA foreign_keys=" + (variant === "no-foreign-keys" ? "OFF" : "ON"),
  );
  if (variant === "temp-memory") db.exec("PRAGMA temp_store=MEMORY");
  if (variant === "no-dirty-triggers")
    for (const { name } of db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'graph_index_dirty_%'",
      )
      .all())
      db.exec(`DROP TRIGGER ${name}`);
  if (variant === "no-secondary")
    for (const { name } of db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL",
      )
      .all())
      db.exec(`DROP INDEX ${name}`);
  const file = db.prepare("INSERT INTO graph_files VALUES (?,?,?)");
  const symbol = db.prepare("INSERT INTO graph_symbols VALUES (?,?,?,?,?)");
  const link = db.prepare("INSERT INTO graph_links VALUES (?,?,?,?,?,?,?,?,?)");
  let symbolMs = 0;
  let linkMs = 0;
  for (let f = 0; f < files; f++) {
    const path = `pkg${f % 20}/file${f}.go`;
    if (variant === "temp-memory-at-begin")
      db.exec("PRAGMA temp_store=MEMORY; BEGIN IMMEDIATE; PRAGMA temp_store=DEFAULT");
    else db.exec("BEGIN IMMEDIATE");
    file.run(path, `{"path":"${path}","text":"${pad}"}`, "clean");
    let started = performance.now();
    for (let s = 0; s < per; s++)
      symbol.run(
        `s:${f}:${s}:${pad.slice(0, 40)}`,
        path,
        `Name${s}`,
        "function",
        `{"identity":"id${f}.${s}","pad":"${pad.slice(0, 200)}"}`,
      );
    symbolMs += performance.now() - started;
    started = performance.now();
    for (let l = 0; l < per; l++)
      link.run(
        `l:${f}:${l}:${pad.slice(0, 40)}`,
        path,
        `s:${f}:${l % per}:${pad.slice(0, 40)}`,
        null,
        "calls",
        `{"pad":"${pad}"}`,
        "go",
        "parse",
        "unresolved",
      );
    linkMs += performance.now() - started;
    db.exec("COMMIT");
  }
  db.close();
  console.log(
    `${variant}: symbol ${((1000 * symbolMs) / (files * per)).toFixed(1)} µs/row, link ${((1000 * linkMs) / (files * per)).toFixed(1)} µs/row`,
  );
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(path + suffix)) rmSync(path + suffix);
}
