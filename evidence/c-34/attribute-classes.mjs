// SPDX-License-Identifier: MIT
// Track the original census classes through the attribute extension. A class
// describes the original trace even when the link has fresher blockers.
import assert from "node:assert/strict";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const opaque = "opaque-item-may-shadow-name";
const location = (link, reasons) =>
  JSON.stringify([link.file, link.range, link.kind, reasons]);
const census = new Map();
const mixedSites = [];
const origins = new Map();
const originSets = new Map();
for await (const line of createInterface({
  input: createReadStream("evidence/c-34/diagnosis.jsonl.gz").pipe(
    createGunzip(),
  ),
})) {
  const row = JSON.parse(line);
  if (row.origin !== undefined) origins.set(row.origin, row.value[1].category);
  if (row.set !== undefined) originSets.set(row.set, row.value);
  if (!row.pin) continue;
  if (row.category === "multiple origin classes") mixedSites.push(row);
  const key = row.pin + "|" + location(row, row.reasons);
  if (!census.has(key)) census.set(key, []);
  census.get(key).push(row.category);
}

const combinations = new Map();
for (const row of mixedSites) {
  const classes = new Set();
  for (const [, , , boundedAway, , set] of row.reads) {
    if (boundedAway) continue;
    for (const origin of originSets.get(set)) classes.add(origins.get(origin));
  }
  assert.ok(classes.size > 1);
  const key = JSON.stringify([
    row.pin,
    row.sole ? "sole" : "several",
    [...classes].sort().join(" + "),
  ]);
  combinations.set(key, (combinations.get(key) ?? 0) + 1);
}

function snapshot(phase, pin) {
  const db = new DatabaseSync(
    join(
      scratch,
      phase,
      pin.attempt,
      "checkout/.pymtheg/rebuildable/graph.sqlite",
    ),
    { readOnly: true },
  );
  const sites = new Map();
  for (const row of db
    .prepare(
      `
    SELECT l.target, l.body, t.symbol FROM graph_links l
    LEFT JOIN graph_library_targets t ON t.link=l.id AND t.role='target'
    WHERE l.module='rust'`,
    )
    .iterate()) {
    const link = JSON.parse(row.body);
    const reasons = [
      ...new Set(
        (link.data?.uncertainty ?? link.data?.reason ?? "")
          .split(/;\s*/)
          .filter(Boolean),
      ),
    ];
    const id = JSON.stringify([
      link.file,
      link.range,
      link.kind,
      link.targetName,
      link.sourceKey,
      link.origin,
      link.data?.macro,
    ]);
    const definite = !!(row.target || row.symbol);
    if (!sites.has(id)) sites.set(id, []);
    sites.get(id).push({
      reasons,
      definite,
      opaque: !definite && reasons.includes(opaque),
      location: location(link, reasons),
    });
  }
  db.close();
  return sites;
}

const read = (phase) =>
  JSON.parse(readFileSync(join(scratch, phase + ".json"))).repos;
const before = read("main");
const after = read("final");
assert.equal(before.length, 10);
assert.equal(after.length, 10);
const counts = new Map();
const newReasons = new Map();
function add(category, sole, outcome, pin) {
  const key = JSON.stringify([category, sole ? "sole" : "several", pin]);
  if (!counts.has(key))
    counts.set(key, { before: 0, carrying: 0, level2: 0, other: 0, added: 0 });
  const row = counts.get(key);
  if (outcome !== "added") row.before++;
  row[outcome]++;
}
for (const pin of before) {
  const previous = snapshot("main", pin);
  const next = snapshot(
    "final",
    after.find((p) => p.id === pin.id),
  );
  const groups = new Map();
  for (const [site, old] of previous) {
    const current = next.get(site);
    assert.equal(current?.length, old.length);
    const used = new Set();
    const pending = old.map((record) => {
      const i = current.findIndex(
        (item, i) =>
          !used.has(i) && JSON.stringify(item) === JSON.stringify(record),
      );
      if (i >= 0) used.add(i);
      return [record, i];
    });
    const remaining = current.filter((_, i) => !used.has(i));
    assert.ok(
      remaining.length <= 1 ||
        new Set(remaining.map((item) => JSON.stringify(item))).size === 1 ||
        new Set(
          pending
            .filter(([, i]) => i < 0)
            .map(([item]) => JSON.stringify(item)),
        ).size === 1,
      `Different outcomes at shared site ${pin.id} ${site}`,
    );
    for (const [prior, i] of pending) {
      const result = i < 0 ? remaining.shift() : current[i];
      if (!prior.opaque) {
        if (result.opaque)
          add(
            "newly carrying opacity",
            result.reasons.every(
              (r) => r === opaque || r === "too-many-targets",
            ),
            "added",
            pin.id,
          );
        continue;
      }
      if (!groups.has(prior.location)) groups.set(prior.location, []);
      const outcome = result.opaque
        ? "carrying"
        : result.definite
          ? "level2"
          : "other";
      const sole = prior.reasons.every(
        (r) => r === opaque || r === "too-many-targets",
      );
      groups.get(prior.location).push({ outcome, sole });
      if (outcome === "other") {
        const key = JSON.stringify([pin.id, result.reasons.join("; ")]);
        newReasons.set(key, (newReasons.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [location, changes] of groups) {
    const classes = census.get(pin.id + "|" + location) ?? [];
    if (new Set(classes).size === 1) {
      for (const c of changes) add(classes[0], c.sole, c.outcome, pin.id);
    } else if (
      classes.length === changes.length &&
      changes.every((c) => c.outcome === changes[0].outcome)
    ) {
      for (const category of classes)
        add(category, changes[0].sole, changes[0].outcome, pin.id);
    } else {
      for (const c of changes)
        add("shared or unmatched original location", c.sole, c.outcome, pin.id);
    }
  }
}

const rows = [...counts].sort(([a], [b]) => a.localeCompare(b));
const table = [
  [
    "Class",
    "Other blockers on prior head",
    "Pin",
    "Before",
    "Still opaque",
    "Reached Level 2",
    "Different blocker",
    "New opacity",
  ],
  ...rows.map(([key, row]) => [...JSON.parse(key), ...Object.values(row)]),
];
writeFileSync(
  join(scratch, "publish/attribute-classes.tsv"),
  table.map((row) => row.join("\t")).join("\n") + "\n",
);
writeFileSync(
  join(scratch, "publish/attribute-reasons.tsv"),
  "Pin\tReason after proof\tLinks\n" +
    [...newReasons]
      .sort()
      .map(([key, n]) => [...JSON.parse(key), n].join("\t"))
      .join("\n") +
    "\n",
);
writeFileSync(
  join(scratch, "publish/attribute-mixed.tsv"),
  "Pin\tOther blockers on main\tExact origin classes\tLinks\n" +
    [...combinations]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => [...JSON.parse(key), count].join("\t"))
      .join("\n") +
    "\n",
);
