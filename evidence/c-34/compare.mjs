// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

const scratch = process.env.PYM_SCRATCH;
const path = (name) => join(scratch, name);
const read = (name) => JSON.parse(readFileSync(path(name), "utf8"));
const publish = path("publish");
mkdirSync(publish, { recursive: true });
const run = (...args) =>
  execFileSync(process.execPath, args, { stdio: "inherit" });
const before = read("main.json").repos;
const after = read("final.json").repos;
assert.equal(after.length, 10);
assert.ok(after.every((p) => p.outcome === "finished"));
run("evidence/c-31/compare.mjs");
const comparison = read("comparison.json");
assert.equal(comparison.changes.length, 0);
const opaque = "opaque-item-may-shadow-name";

function readSites(pin, runName) {
  const db = new DatabaseSync(
    path(
      join(runName, pin.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    ),
    { readOnly: true },
  );
  const sites = new Map();
  for (const row of db
    .prepare(
      `
    SELECT l.target, l.body, t.symbol
    FROM graph_links l LEFT JOIN graph_library_targets t ON t.link=l.id AND t.role='target'
    WHERE l.module='rust'`,
    )
    .iterate()) {
    const l = JSON.parse(row.body);
    const reasons = (l.data?.uncertainty ?? l.data?.reason ?? "")
      .split(/;\s*/)
      .filter(Boolean);
    const key = JSON.stringify([
      l.file,
      l.range,
      l.kind,
      l.targetName,
      l.sourceKey,
      l.origin,
    ]);
    if (!sites.has(key)) sites.set(key, []);
    sites.get(key).push({ reasons, definite: !!(row.target || row.symbol) });
  }
  db.close();
  return sites;
}

function unmatched(before, after) {
  const used = new Set();
  const pending = before.filter((site) => {
    const i = after.findIndex(
      (next, i) =>
        !used.has(i) && JSON.stringify(site) === JSON.stringify(next),
    );
    if (i < 0) return true;
    used.add(i);
    return false;
  });
  return [pending, after.filter((_, i) => !used.has(i))];
}

for (const record of comparison.pins) {
  const baseline = before.find((p) => p.id === record.id);
  const candidate = after.find((p) => p.id === record.id);
  assert.equal(baseline.commit, candidate.commit);
  assert.equal(record.symbolLoss + record.symbolGain, 0);
  const x = readSites(baseline, "main");
  const y = readSites(candidate, "final");
  assert.equal(x.size, y.size);
  const opacity = {
    before: 0,
    after: 0,
    liftedToLevel2: 0,
    removedBelowLevel2: 0,
    gainedBelowLevel2: 0,
  };
  const remainingReasons = {};
  const carriesOpacity = (l) => !l.definite && l.reasons.includes(opaque);
  for (const [key, previous] of x) {
    const following = y.get(key);
    assert.equal(
      following?.length,
      previous.length,
      `Site changed on ${record.id} at ${key}`,
    );
    opacity.before += previous.filter(carriesOpacity).length;
    opacity.after += following.filter(carriesOpacity).length;
    const [old, next] =
      previous.length === 1
        ? [previous, following]
        : unmatched(previous, following);
    assert.ok(
      old.length <= 1 ||
        [old, next].some(
          (sites) =>
            new Set(sites.map((site) => JSON.stringify(site))).size === 1,
        ),
      `Several distinct transitions at ${record.id} ${key}`,
    );
    for (const [i, prev] of old.entries()) {
      if (carriesOpacity(prev) && !carriesOpacity(next[i])) {
        if (next[i].definite) opacity.liftedToLevel2++;
        else {
          opacity.removedBelowLevel2++;
          const reason = next[i].reasons.join("; ");
          remainingReasons[reason] = (remainingReasons[reason] ?? 0) + 1;
        }
      } else if (!carriesOpacity(prev) && carriesOpacity(next[i])) {
        opacity.gainedBelowLevel2++;
      }
    }
  }
  record.opacity = opacity;
  record.remainingReasons = remainingReasons;
}
comparison.totals.opacity = {};
for (const { opacity } of comparison.pins)
  for (const [k, n] of Object.entries(opacity))
    comparison.totals.opacity[k] = (comparison.totals.opacity[k] ?? 0) + n;
writeFileSync(
  join(publish, "comparison.json"),
  JSON.stringify(comparison, null, 2) + "\n",
);
run(
  "scripts/sweep/coverage-export.mjs",
  "--refresh",
  "--results",
  path("final.json"),
  "--scratch",
  path("final"),
  "--output",
  path("final-export.json"),
);
const inventory = read("final-export.json");
for (const repo of inventory.repos) {
  const { after: counts } = comparison.pins.find((p) => p.id === repo.id);
  for (const key of ["links", "level2", "assumed"])
    assert.equal(repo.counts.rust[key], counts[key]);
  delete repo.shortlist;
  for (const sites of Object.values(repo.examples))
    for (const example of sites) {
      delete example.code;
      delete example.target;
    }
}
writeFileSync(
  join(publish, "coverage-plan-input.json.gz"),
  gzipSync(JSON.stringify(inventory) + "\n", { level: 9 }),
);

const gains = readFileSync(path("new-links.jsonl"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map(JSON.parse);
assert.equal(
  gains.length,
  comparison.totals.after.level2 - comparison.totals.before.level2,
);
const sample = gains.slice(0, 30).map((row) => {
  const pin = after.find((p) => p.id === row.id);
  const lines = readFileSync(
    path(join("final", pin.attempt, "checkout", row.file)),
    "utf8",
  ).split("\n");
  return {
    ...row,
    source: lines.slice(Math.max(0, row.line - 3), row.line + 2),
  };
});
writeFileSync(
  path("gain-samples.json"),
  JSON.stringify(sample, null, 2) + "\n",
);
console.log(JSON.stringify(comparison.totals));
