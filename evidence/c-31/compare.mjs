// SPDX-License-Identifier: MIT
// Compare every stored Rust Level 2 link by source site and target identity.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const root = process.env.PYM_SCRATCH;
const load = (variant) =>
  JSON.parse(readFileSync(join(root, variant + ".json"), "utf8")).repos;
const before = load("main");
const variant = process.argv[2] ?? "final";
const after = load(process.argv[3] ?? variant);
const rank = (site) =>
  createHash("sha256")
    .update(JSON.stringify(["c31-gains-v1", site]))
    .digest("hex");
function snapshot(record, run) {
  const db = new DatabaseSync(
    join(
      root,
      run,
      record.attempt,
      "checkout/.pymtheg/rebuildable/graph.sqlite",
    ),
    { readOnly: true },
  );
  const symbols = new Map();
  for (const { body } of db
    .prepare(
      "SELECT body FROM graph_symbols WHERE json_extract(body, '$.module')='rust'",
    )
    .iterate()) {
    const s = JSON.parse(body);
    symbols.set(s.id, JSON.stringify([s.file, s.kind, s.key, s.identity]));
  }
  const library = new Map();
  for (const { link, ...row } of db
    .prepare(
      "SELECT link,ecosystem,unit,symbol,version,version_source,evidence FROM graph_library_targets WHERE role='target'",
    )
    .iterate()) {
    library.set(link, row);
  }
  const files = new Map();
  for (const { path, source } of db
    .prepare(
      "SELECT path, json_extract(body,'$.text') AS source FROM graph_files WHERE json_extract(body, '$.module')='rust'",
    )
    .iterate()) {
    const starts = [0];
    for (let i = 0; i < source.length; i++)
      if (source[i] === "\n") starts.push(i + 1);
    files.set(path, { source, starts });
  }
  const links = new Map();
  const counts = { links: 0, level2: 0, assumed: 0, blank: 0 };
  for (const { id, target, resolution, body } of db
    .prepare(
      "SELECT id,target,resolution,body FROM graph_links WHERE module='rust'",
    )
    .iterate()) {
    const l = JSON.parse(body);
    const lib = library.get(id);
    const key = JSON.stringify([
      l.file,
      l.range.start,
      l.range.end,
      l.kind,
      l.targetName,
      l.sourceKey ?? "",
      l.origin,
    ]);
    const definite = !!(target || lib?.symbol);
    const assumed = !!l.data?.assumes?.length;
    const reason = l.data?.uncertainty ?? l.data?.reason ?? "";
    const value = {
      id,
      l,
      target: target ? symbols.get(target) : lib,
      definite,
      assumed,
      reason,
      resolution,
    };
    const sites = links.get(key) ?? [];
    sites.push(value);
    links.set(key, sites);
    counts.links++;
    if (definite) {
      counts.level2++;
      counts.assumed += Number(assumed);
    } else if (!reason) counts.blank++;
  }
  db.close();
  return { symbols: new Set(symbols.values()), links, counts, files };
}
const notes = [],
  newLinks = [],
  changes = [];
const totals = {
  before: {},
  after: {},
  common: { links: 0, before: 0, after: 0, beforeAssumed: 0, afterAssumed: 0 },
};
for (const a of after) {
  const b = before.find((r) => r.id === a.id && r.commit === a.commit);
  if (b?.outcome !== "finished" || a.outcome !== "finished") {
    notes.push({ id: a.id, before: b?.outcome, after: a.outcome });
    continue;
  }
  const x = snapshot(b, "main"),
    y = snapshot(a, variant);
  const record = {
    id: a.id,
    before: x.counts,
    after: y.counts,
    common: {
      links: 0,
      before: 0,
      after: 0,
      beforeAssumed: 0,
      afterAssumed: 0,
    },
    compared: 0,
    lost: 0,
    symbolsBefore: x.symbols.size,
    symbolsAfter: y.symbols.size,
    symbolLoss: 0,
    symbolGain: 0,
  };
  for (const k of ["before", "after"])
    for (const [name, n] of Object.entries(record[k]))
      totals[k][name] = (totals[k][name] ?? 0) + n;
  for (const k of x.symbols) if (!y.symbols.has(k)) record.symbolLoss++;
  for (const k of y.symbols) if (!x.symbols.has(k)) record.symbolGain++;
  for (const [k, prev] of x.links) {
    const next = y.links.get(k) ?? [];
    const encode = (l) => JSON.stringify([l.target, l.assumed]);
    const matched = new Set();
    for (const l of prev.filter((l) => l.target)) {
      record.compared++;
      const i = next.findIndex(
        (candidate, j) => !matched.has(j) && encode(candidate) === encode(l),
      );
      if (i >= 0) matched.add(i);
      else {
        record.lost++;
        changes.push({
          id: a.id,
          site: k,
          previous: encode(l),
          after: next.map(encode),
        });
      }
    }
    if (prev.length === next.length) {
      for (const [phase, sites] of [
        ["before", prev],
        ["after", next],
      ])
        for (const l of sites.filter((l) => l.definite)) {
          record.common[phase]++;
          record.common[phase + "Assumed"] += Number(l.assumed);
        }
      record.common.links += prev.length;
      const unresolved = prev.filter((link) => !link.definite);
      for (const [i, { l, target, assumed, definite }] of next.entries()) {
        if (!definite || matched.has(i) || !unresolved.length) continue;
        const { source, starts } = y.files.get(l.file);
        let low = 0,
          high = starts.length;
        while (low + 1 < high) {
          const mid = (low + high) >>> 1;
          if (starts[mid] <= l.range.start) low = mid;
          else high = mid;
        }
        const line = low;
        const excerpt = source
          .slice(starts[line], starts[line + 1] ?? source.length)
          .trim();
        newLinks.push({
          rank: rank([a.id, a.commit, k, i]),
          id: a.id,
          commit: a.commit,
          file: l.file,
          line: line + 1,
          column: l.range.start - starts[line] + 1,
          kind: l.kind,
          spelling: l.targetName,
          target,
          assumed,
          beforeReason: unresolved.shift().reason,
          excerpt,
        });
      }
    }
  }
  for (const [k, n] of Object.entries(record.common)) totals.common[k] += n;
  notes.push(record);
}
writeFileSync(
  join(root, "comparison.json"),
  JSON.stringify({ pins: notes, totals, changes }, null, 2) + "\n",
);
writeFileSync(
  join(root, "new-links.jsonl"),
  newLinks
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map((s) => JSON.stringify(s))
    .join("\n") + "\n",
);
console.log(
  JSON.stringify({
    pins: notes,
    totals,
    changes: changes.length,
    gains: newLinks.length,
  }),
);
