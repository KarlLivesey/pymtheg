// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";

const [scratch, receipt, prefix] = process.argv.slice(2);
const { repos } = JSON.parse(readFileSync(receipt, "utf8"));
const seed = "pymtheg-c23-2026";
const size = 200;
const open = (repo) =>
  new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
const siteKey = (pin, file, start, end, name) =>
  JSON.stringify([pin, file, start, end, name]);
const withdrawals = new Set(
  JSON.parse(gunzipSync(readFileSync("evidence/c-20/definite-changes.json.gz")))
    .changes.filter(
      ([, , , , , , old, next]) =>
        (old.resolution === "resolved" ||
          (old.resolution === "library" && old.libraries[0]?.symbol)) &&
        !(
          next?.resolution === "resolved" ||
          (next?.resolution === "library" && next.libraries[0]?.symbol)
        ),
    )
    .map((row) => siteKey(...row.slice(0, 5))),
);
const group = (reason, kind) => JSON.stringify([reason, kind]);
const misses = `SELECT id, file, kind,
  CASE resolution WHEN 'library' THEN 'unit-only'
    ELSE coalesce(json_extract(body,'$.data.reason'),
      CASE resolution WHEN 'ambiguous' THEN 'candidate-set' ELSE 'no-recorded-reason' END)
    END AS reason,
  json_extract(body,'$.range.start') AS start, json_extract(body,'$.range.end') AS end,
  json_extract(body,'$.targetName') AS name
  FROM graph_links AS l WHERE l.module='typescript' AND resolution!='resolved'
    AND (resolution!='library' OR NOT EXISTS (
      SELECT 1 FROM graph_library_targets AS t WHERE t.link=l.id AND t.symbol IS NOT NULL
    ))`;
const totals = new Map();
const pins = [];
for (const repo of repos.filter((row) => row.outcome === "finished")) {
  const db = open(repo);
  try {
    const count = db
      .prepare(
        "SELECT count(*) AS n FROM graph_links WHERE module='typescript'",
      )
      .get().n;
    const groups = db
      .prepare(
        `SELECT reason,kind,count(*) AS n FROM (${misses}) GROUP BY reason,kind ORDER BY reason,kind`,
      )
      .all();
    const missing = groups.reduce((n, row) => n + row.n, 0);
    pins.push({
      pin: repo.id,
      commit: repo.commit,
      installed: repo.install?.status === "installed",
      count,
      missing,
      groups,
    });
    for (const row of groups.filter(
      () => repo.install?.status === "installed",
    )) {
      const key = group(row.reason, row.kind);
      totals.set(key, (totals.get(key) ?? 0) + row.n);
    }
  } finally {
    db.close();
  }
}
const total = [...totals.values()].reduce((a, b) => a + b, 0);
const quotas = [...totals].map(([key, count]) => ({
  key,
  count,
  n: Math.floor((count * size) / total),
  remainder: (count * size) % total,
  sites: [],
}));
const remaining = size - quotas.reduce((n, row) => n + row.n, 0);
quotas.sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
for (const row of quotas.slice(0, remaining)) row.n++;
const buckets = new Map(quotas.map((row) => [row.key, row]));
for (const repo of repos.filter(
  (row) => row.outcome === "finished" && row.install?.status === "installed",
)) {
  const db = open(repo);
  try {
    for (const row of db.prepare(misses).iterate()) {
      const bucket = buckets.get(group(row.reason, row.kind));
      if (!bucket.n) continue;
      const key = siteKey(repo.id, row.file, row.start, row.end, row.name);
      const rank = createHash("sha256")
        .update(seed)
        .update(key)
        .update(row.kind)
        .digest("hex");
      if (bucket.sites.length === bucket.n && rank >= bucket.sites.at(-1).rank)
        continue;
      bucket.sites.push({
        pin: repo.id,
        ...row,
        rank,
        withdrawal: withdrawals.has(key),
      });
      bucket.sites.sort((a, b) => a.rank.localeCompare(b.rank));
      if (bucket.sites.length > bucket.n) bucket.sites.pop();
    }
  } finally {
    db.close();
  }
}
const sample = quotas
  .flatMap((row) => row.sites)
  .sort((a, b) => a.rank.localeCompare(b.rank));
if (sample.length !== size)
  throw Error(`Expected ${size} sample sites, got ${sample.length}`);
writeFileSync(
  `${prefix}-counts.json.gz`,
  gzipSync(
    JSON.stringify({
      pins,
      totals: quotas.map(({ key, count, n }) => [...JSON.parse(key), count, n]),
    }),
  ),
);
writeFileSync(`${prefix}-draw.json`, JSON.stringify(sample, null, 2));
