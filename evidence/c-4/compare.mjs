// SPDX-License-Identifier: MIT
// C-4 evidence: compares the Go links of two sweep runs (base and candidate
// builds) site by site. A site is (file, kind, start, end). Reports, per
// repository: Go links, definite links, sites that became definite (existing
// sites and new ones), and every site whose definite target changed or was
// lost. Draws a fixed-seed sample of newly definite links (calls and
// references) for hand-checking.
// Usage: node compare.mjs --scratch DIR --base base-run.json --candidate cand-run.json [--sample 20] [--seed c-4]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    scratch: { type: "string" },
    base: { type: "string" },
    candidate: { type: "string" },
    sample: { type: "string", default: "20" },
    seed: { type: "string", default: "c-4" },
  },
});
const runs = (path) =>
  new Map(
    JSON.parse(readFileSync(join(values.scratch, path), "utf8")).repos.map(
      (record) => [record.id, record],
    ),
  );
const base = runs(values.base);
const candidate = runs(values.candidate);

function load(record) {
  const db = new DatabaseSync(
    join(values.scratch, record.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const symbols = new Map();
  for (const row of db
    .prepare("SELECT id, file, kind, json_extract(body,'$.identity') AS identity FROM graph_symbols")
    .iterate())
    symbols.set(row.id, `${row.file}:${row.kind}:${row.identity}`);
  const links = new Map();
  for (const row of db
    .prepare("SELECT file, kind, target, resolution, body FROM graph_links WHERE module='go'")
    .iterate()) {
    const body = JSON.parse(row.body);
    const key = `${row.file}\u0000${row.kind}\u0000${body.range.start}\u0000${body.range.end}\u0000${body.targetName}`;
    links.set(key, {
      file: row.file,
      kind: row.kind,
      start: body.range.start,
      name: body.targetName,
      resolution: row.resolution,
      target: row.target ? symbols.get(row.target) : null,
    });
  }
  db.close();
  return links;
}

const lineOf = (record, file, offset) => {
  const text = readFileSync(join(values.scratch, record.attempt, "checkout", file), "utf8");
  // Offsets are UTF-16 code units.
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const source = text.split("\n")[line - 1].trim();
  return { line, source };
};

const out = { repos: [], totals: {}, changed: [], sample: [] };
const add = (bucket, key, n = 1) => (bucket[key] = (bucket[key] ?? 0) + n);
const pool = [];
for (const [id, cand] of [...candidate].sort()) {
  const was = base.get(id);
  if (!was) continue;
  const before = load(was);
  const after = load(cand);
  const row = {
    id,
    linksBefore: before.size,
    linksAfter: after.size,
    definiteBefore: [...before.values()].filter((l) => l.target).length,
    definiteAfter: [...after.values()].filter((l) => l.target).length,
    newlyDefiniteExisting: {},
    newlyDefiniteNewSite: {},
    lost: 0,
    retargeted: 0,
    removedSites: 0,
  };
  for (const [key, link] of after) {
    const old = before.get(key);
    if (link.target && !old?.target) {
      add(old ? row.newlyDefiniteExisting : row.newlyDefiniteNewSite, link.kind);
      if (link.kind === "calls" || link.kind === "references")
        pool.push({ id, record: cand, link, existing: !!old, was: old?.resolution ?? "no link" });
    }
    if (old?.target && link.target !== old.target) {
      if (link.target) row.retargeted++;
      else row.lost++;
      out.changed.push({ id, file: link.file, kind: link.kind, name: link.name, ...lineOf(cand, link.file, link.start), before: old.target, after: link.target ?? link.resolution });
    }
  }
  for (const [key, old] of before)
    if (!after.has(key)) {
      row.removedSites++;
      if (old.target)
        out.changed.push({ id, file: old.file, kind: old.kind, name: old.name, before: old.target, after: "site removed" });
    }
  out.repos.push(row);
  for (const [k, v] of Object.entries(row)) if (typeof v === "number") add(out.totals, k, v);
}
const hash = (item) =>
  createHash("sha256").update(`${values.seed}\u0000${item.id}\u0000${item.link.file}\u0000${item.link.start}\u0000${item.link.kind}`).digest("hex");
pool.sort((a, b) => (hash(a) < hash(b) ? -1 : 1));
out.poolSize = pool.length;
for (const item of pool.slice(0, Number(values.sample))) {
  const { line, source } = lineOf(item.record, item.link.file, item.link.start);
  out.sample.push({ repo: item.id, file: item.link.file, line, kind: item.link.kind, name: item.link.name, was: item.was, target: item.link.target, source });
}
console.log(JSON.stringify(out, null, 1));
