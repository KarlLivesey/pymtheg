// SPDX-License-Identifier: MIT
// C-53 diagnosis: what a cold index writes in each phase, and how often each
// link row is written. Runs one cold index of <root> into a new store and
// records every graph write statement by phase: the parse write (until the
// first module's analysis input is read), the analysis writes (until the
// first resolution write) and the resolution writes. Per phase and table:
// statements, rows changed and bytes bound. Per link id: each body written
// (inserted, or rewritten in place), so it can say how many links were
// written more than once and what differed between the writes.
//   node scripts/link-writes/diagnose.mjs <dist> <root> <graph.sqlite> <out.json>
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sqlite from "node:sqlite";

const [dist, root, graph, out] = process.argv.slice(2);
if (!out)
  throw Error("usage: diagnose.mjs <dist> <root> <graph.sqlite> <out.json>");
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discoverLanguages, indexProject, SqliteGraphStore } =
  await load("graph/index.js");

let phase = "parse";
const proto = SqliteGraphStore.prototype;
const filesAt = proto.filesAt;
proto.filesAt = function (...args) {
  if (phase === "parse") phase = "analysis";
  return filesAt.apply(this, args);
};
const replaceAnalysis = proto.replaceAnalysis;
proto.replaceAnalysis = function (...args) {
  phase = "resolution";
  return replaceAnalysis.apply(this, args);
};

const totals = {};
const tally = (table, verb, changes, bytes) => {
  const key = `${phase} ${verb} ${table}`;
  const entry = (totals[key] ??= { statements: 0, rows: 0, bytes: 0 });
  entry.statements++;
  entry.rows += changes;
  entry.bytes += bytes;
};
/** Link id → [{phase, how, body}] for every body written. */
const writes = new Map();
const record = (id, how, body) => {
  let list = writes.get(id);
  if (!list) writes.set(id, (list = []));
  list.push({ phase, how, body });
};
const write =
  /^\s*(INSERT|UPDATE|DELETE)\b[^]*?\b(?:INTO|FROM)?\s*(graph_\w+)/i;
const db = sqlite.DatabaseSync.prototype;
const prepare = db.prepare;
db.prepare = function (sql, ...rest) {
  const statement = prepare.call(this, sql, ...rest);
  const match = write.exec(sql);
  if (!match) return statement;
  const verb = match[1].toUpperCase();
  const table = /UPDATE\s+(graph_\w+)/i.exec(sql)?.[1] ?? match[2];
  const linkInsert = /^INSERT INTO graph_links VALUES/.test(sql);
  const bodyUpdate = /^UPDATE graph_links SET body=\? WHERE id=\?/.test(sql);
  const run = statement.run;
  statement.run = function (...args) {
    const result = run.apply(this, args);
    let bytes = 0;
    for (const arg of args)
      if (typeof arg === "string") bytes += Buffer.byteLength(arg);
    tally(table, verb, Number(result.changes), bytes);
    if (linkInsert) record(args[0], "insert", args[5]);
    if (bodyUpdate) record(args[1], "update", args[0]);
    return result;
  };
  return statement;
};

const store = new SqliteGraphStore(graph, "c53-diagnose");
const started = performance.now();
try {
  await indexProject(root, await discoverLanguages(), store, {
    excludeDirectories: [".pymtheg"],
    signal: new AbortController().signal,
  });
} finally {
  store.close();
}
const wallMs = Math.round(performance.now() - started);

// What differs between two bodies of one link: the target and outcome
// fields the resolution decides, or anything else (data, range, ...).
const OUTCOME = new Set([
  "targetId",
  "targetStatus",
  "resolution",
  "candidates",
  "libraries",
]);
const differs = (a, b) => {
  const x = JSON.parse(a);
  const y = JSON.parse(b);
  const fields = new Set();
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
    if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) fields.add(key);
  if (!fields.size) return "identical";
  return [...fields].every((field) => OUTCOME.has(field))
    ? "outcome only"
    : `other: ${[...fields]
        .filter((field) => !OUTCOME.has(field))
        .sort()
        .join(",")}`;
};
const byModule = {};
const final = new sqlite.DatabaseSync(graph, { readOnly: true });
const moduleOf = new Map(
  final
    .prepare("SELECT id, module FROM graph_links")
    .all()
    .map((row) => [row.id, row.module]),
);
final.close();
for (const [id, list] of writes) {
  const module = moduleOf.get(id) ?? "(removed)";
  const entry = (byModule[module] ??= {
    links: 0,
    writes: {},
    pattern: {},
    steps: {},
    bodyBytes: 0,
  });
  entry.links++;
  entry.writes[list.length] = (entry.writes[list.length] ?? 0) + 1;
  const pattern = list.map((item) => `${item.phase}:${item.how}`).join(" → ");
  entry.pattern[pattern] = (entry.pattern[pattern] ?? 0) + 1;
  for (let i = 1; i < list.length; i++) {
    const step = `${list[i - 1].phase}→${list[i].phase} ${differs(list[i - 1].body, list[i].body)}`;
    entry.steps[step] = (entry.steps[step] ?? 0) + 1;
  }
  for (const item of list) entry.bodyBytes += Buffer.byteLength(item.body);
}
writeFileSync(
  out,
  JSON.stringify(
    {
      root,
      wallMs,
      phases: Object.fromEntries(
        Object.entries(totals).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
      links: byModule,
    },
    null,
    1,
  ),
);
