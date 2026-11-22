// SPDX-License-Identifier: MIT
// remaining.mjs SCRATCH BEFORE.json AFTER.json OUT.json [SAMPLE] : for every
// link the diagnostic run (BEFORE) stored as `local` with a type-literal or
// object-literal member shape, its outcome in AFTER (same site: module,
// file, kind, range, target name). Counts per shape and outcome, and the
// lowest-hash SAMPLE sites (seed "c41-remaining") still `local` per shape,
// with the source line.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, beforePath, afterPath, out, sample = "0"] = process.argv.slice(2);
const runs = (path) =>
  new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((r) => [r.id, r]));
const before = runs(beforePath),
  after = runs(afterPath);
const hash = (s) => createHash("sha256").update("c41-remaining|" + s).digest("hex");
const open = (repo) =>
  new DatabaseSync(
    join(scratch, repo.attempt, "checkout", ".pymtheg", "rebuildable", "graph.sqlite"),
    { readOnly: true },
  );
const site = (l) => [l.module, l.file, l.kind, l.range.start, l.range.end, l.targetName].join("|");
const totals = {};
const left = [];
for (const [id, repo] of before) {
  const next = after.get(id);
  if (repo.outcome !== "finished" || next?.outcome !== "finished") continue;
  const shapes = new Map();
  const a = open(repo);
  for (const { body } of a
    .prepare(
      "SELECT body FROM graph_links WHERE module='typescript' AND json_extract(body,'$.data.reason')='local'",
    )
    .iterate()) {
    const l = JSON.parse(body);
    const shape = l.data.localShape ?? "";
    if (!/^(type|object) literal/.test(shape)) continue;
    shapes.set(site(l), shape);
  }
  a.close();
  const b = open(next);
  const checkout = join(scratch, next.attempt, "checkout");
  for (const { resolution, body } of b
    .prepare("SELECT resolution, body FROM graph_links WHERE module='typescript'")
    .iterate()) {
    const l = JSON.parse(body);
    const shape = shapes.get(site(l));
    if (shape === undefined) continue;
    const outcome =
      resolution === "unresolved" ? `unresolved:${l.data?.reason ?? ""}` : resolution;
    const key = `${shape} => ${outcome}`;
    totals[key] = (totals[key] ?? 0) + 1;
    if (outcome === "unresolved:local")
      left.push({ id, checkout, file: l.file, start: l.range.start, shape, targetName: l.targetName, kind: l.kind, rank: hash(site(l)) });
  }
  b.close();
}
const picked = {};
for (const item of left.sort((x, y) => (x.rank < y.rank ? -1 : 1))) {
  const list = (picked[item.shape] ??= []);
  if (list.length >= Number(sample)) continue;
  const text = readFileSync(join(item.checkout, item.file), "utf8");
  const start = text.lastIndexOf("\n", item.start - 1) + 1;
  const end = text.indexOf("\n", item.start);
  list.push({
    repo: item.id,
    file: item.file,
    line: text.slice(0, item.start).split("\n").length,
    kind: item.kind,
    targetName: item.targetName,
    code: text.slice(start, end < 0 ? undefined : end).trim().slice(0, 200),
  });
}
const sorted = Object.fromEntries(Object.entries(totals).sort((x, y) => y[1] - x[1]));
writeFileSync(out, JSON.stringify({ totals: sorted, sample: picked }, null, 1) + "\n");
for (const [key, n] of Object.entries(sorted)) console.log(n, key);
