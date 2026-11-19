// SPDX-License-Identifier: MIT
// C-21 comparison of two sweep runs of the same pins (main, branch): every
// stored link, symbol key and library row. Based on evidence/c-15/compare.mjs.
//   node compare.mjs BASE_SCRATCH BASE_RUN CAND_SCRATCH CAND_RUN OUT
// Writes OUT (summary JSON) and:
//   OUT.changed-definite.jsonl  every link definite on main whose outcome or
//                               target changes (with both sides' targets);
//   OUT.newly-resolved.jsonl    every Rust link resolved on the branch but not
//                               on main (old site or new site), ordered by a
//                               fixed-seed hash (seed "c21") for the hand audit;
//   OUT.other-changes.jsonl     every other changed site (outcome, candidates,
//                               library rows), for the record.
// "Newly read" files are those the branch reads and main failed.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [baseScratch, baseRun, candScratch, candRun, out] = process.argv.slice(2);
const runs = (path) =>
  new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((r) => [r.id, r]));
const base = runs(baseRun),
  cand = runs(candRun);
const lineOf = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++)
    if (text.charCodeAt(i) === 10) line++;
  return line;
};

function load(scratch, repo) {
  const checkout = join(scratch, repo.attempt, "checkout");
  const db = new DatabaseSync(
    join(checkout, ".pymtheg", "rebuildable", "graph.sqlite"),
    { readOnly: true },
  );
  try {
    const failed = new Set();
    for (const { path, status } of db
      .prepare("SELECT path, status FROM graph_files")
      .iterate())
      if (path.endsWith(".rs") && status === "failed") failed.add(path);
    const symbols = new Map();
    for (const { body } of db
      .prepare("SELECT body FROM graph_symbols")
      .iterate()) {
      const s = JSON.parse(body);
      symbols.set(s.id, {
        key: JSON.stringify([s.module, s.file, s.kind, s.identity, s.ordinal]),
        module: s.module,
        file: s.file,
        name: s.name,
        kind: s.kind,
        start: s.range.start,
      });
    }
    const candidates = new Map();
    for (const { link, symbol } of db
      .prepare("SELECT link, symbol FROM graph_candidates")
      .iterate()) {
      const list = candidates.get(link) ?? [];
      list.push(symbols.get(symbol)?.key ?? symbol);
      candidates.set(link, list);
    }
    const libraries = new Map();
    for (const r of db
      .prepare(
        "SELECT link, role, id, unit, symbol, evidence FROM graph_library_targets",
      )
      .iterate()) {
      const list = libraries.get(r.link) ?? [];
      list.push(JSON.stringify([r.role, r.id, r.unit, r.symbol, r.evidence]));
      libraries.set(r.link, list);
    }
    const links = new Map();
    for (const row of db
      .prepare("SELECT id, target, resolution, body FROM graph_links")
      .iterate()) {
      const l = JSON.parse(row.body);
      let site = [
        l.module,
        l.file,
        l.kind,
        l.range.start,
        l.range.end,
        l.targetName,
      ].join("|");
      while (links.has(site)) site += "+";
      links.set(site, {
        module: l.module,
        file: l.file,
        kind: l.kind,
        start: l.range.start,
        targetName: l.targetName,
        resolution: row.resolution,
        target: row.target
          ? (symbols.get(row.target)?.key ?? row.target)
          : null,
        targetSymbol: row.target ? symbols.get(row.target) : undefined,
        candidates: (candidates.get(row.id) ?? []).sort(),
        libraries: (libraries.get(row.id) ?? []).sort(),
        reason: [l.data?.reason, l.data?.uncertainty]
          .filter(Boolean)
          .join(" | "),
      });
    }
    return { checkout, symbols, links, failed };
  } finally {
    db.close();
  }
}

// Level 2: resolved in the checkout, or a library row naming unit and symbol.
const level2 = (l) =>
  l.resolution === "resolved" ||
  l.libraries.some((r) => {
    const [role, , unit, symbol] = JSON.parse(r);
    return role === "target" && unit && symbol;
  });
const taint = (l) => l.reason.includes("failed-file-unseen-declarations");

const summary = [];
const changedDefinite = [];
const newlyResolved = [];
const otherChanges = [];
const texts = new Map();
const text = (checkout, file) => {
  const k = join(checkout, file);
  if (!texts.has(k)) {
    try {
      texts.set(k, readFileSync(k, "utf8"));
    } catch {
      texts.set(k, "");
    }
  }
  return texts.get(k);
};
const describe = (checkout, l) => {
  const src = text(checkout, l.file);
  const line = lineOf(src, l.start);
  return {
    file: l.file,
    line,
    code: src.split("\n")[line - 1]?.trim().slice(0, 160),
  };
};
const targetOf = (checkout, l) =>
  l.targetSymbol
    ? {
        file: l.targetSymbol.file,
        line: lineOf(text(checkout, l.targetSymbol.file), l.targetSymbol.start),
        name: l.targetSymbol.name,
        kind: l.targetSymbol.kind,
      }
    : null;

for (const [id, b] of base) {
  const c = cand.get(id);
  if (!c?.attempt || !b.attempt) {
    summary.push({ id, skipped: true, base: b.outcome, cand: c?.outcome });
    continue;
  }
  const before = load(baseScratch, b),
    after = load(candScratch, c);
  const newlyRead = [...before.failed]
    .filter((f) => !after.failed.has(f))
    .sort();
  const keysBefore = new Set([...before.symbols.values()].map((s) => s.key));
  const keysAfter = new Set([...after.symbols.values()].map((s) => s.key));
  const addedKeys = [...keysAfter].filter((k) => !keysBefore.has(k));
  const row = {
    id,
    failedRustFiles: {
      before: [...before.failed].sort(),
      after: [...after.failed].sort(),
    },
    newlyRead,
    symbolKeysRemoved: [...keysBefore].filter((k) => !keysAfter.has(k)).length,
    symbolKeysAdded: addedKeys.length,
    symbolKeysAddedOutsideNewlyRead: addedKeys.filter(
      (k) => !newlyRead.includes(JSON.parse(k)[1]),
    ).length,
    rustAllSites: {
      before: { links: 0, level2: 0, taint: 0 },
      after: { links: 0, level2: 0, taint: 0 },
    },
    rustLikeForLike: { links: 0, level2Before: 0, level2After: 0 },
    sitesOnlyBefore: 0,
    sitesOnlyAfter: 0,
    sitesOnlyAfterInNewlyRead: 0,
    definiteBefore: 0,
    definiteKept: 0,
    definiteChanged: 0,
    level2Lost: 0,
    newlyResolvedOldSites: 0,
    newlyResolvedNewSites: 0,
    transitions: {},
  };
  for (const [side, graph] of [
    ["before", before],
    ["after", after],
  ])
    for (const l of graph.links.values())
      if (l.module === "rust") {
        row.rustAllSites[side].links++;
        if (level2(l)) row.rustAllSites[side].level2++;
        if (taint(l)) row.rustAllSites[side].taint++;
      }
  for (const [site, l] of before.links) {
    const a = after.links.get(site);
    if (!a) {
      row.sitesOnlyBefore++;
      if (l.resolution === "resolved") {
        row.definiteBefore++;
        row.definiteChanged++;
        changedDefinite.push({
          repo: id,
          ...describe(before.checkout, l),
          kind: l.kind,
          targetName: l.targetName,
          before: {
            resolution: l.resolution,
            target: targetOf(before.checkout, l),
          },
          after: null,
        });
      }
      continue;
    }
    if (l.module === "rust") {
      row.rustLikeForLike.links++;
      if (level2(l)) row.rustLikeForLike.level2Before++;
      if (level2(a)) row.rustLikeForLike.level2After++;
    }
    if (level2(l) && !level2(a)) row.level2Lost++;
    if (l.resolution === "resolved") {
      row.definiteBefore++;
      if (a.resolution === "resolved" && a.target === l.target)
        row.definiteKept++;
      else row.definiteChanged++;
    }
    const changed =
      l.resolution !== a.resolution ||
      l.target !== a.target ||
      JSON.stringify(l.candidates) !== JSON.stringify(a.candidates) ||
      JSON.stringify(l.libraries) !== JSON.stringify(a.libraries);
    if (!changed) continue;
    const t = `${l.resolution}->${a.resolution}`;
    row.transitions[t] = (row.transitions[t] ?? 0) + 1;
    const record = {
      repo: id,
      ...describe(after.checkout, l),
      kind: l.kind,
      targetName: l.targetName,
      before: {
        resolution: l.resolution,
        reason: l.reason,
        target: targetOf(before.checkout, l),
        candidates: l.candidates.length,
        libraries: l.libraries,
      },
      after: {
        resolution: a.resolution,
        reason: a.reason,
        target: targetOf(after.checkout, a),
        candidates: a.candidates.length,
        libraries: a.libraries,
      },
    };
    if (l.resolution === "resolved") {
      if (a.resolution === "resolved" && a.target === l.target)
        otherChanges.push(record);
      else changedDefinite.push(record);
    } else if (a.resolution === "resolved") {
      if (l.module === "rust") {
        row.newlyResolvedOldSites++;
        newlyResolved.push({
          rank: createHash("sha256").update(`c21|${id}|${site}`).digest("hex"),
          site: "old",
          ...record,
        });
      } else otherChanges.push(record);
    } else otherChanges.push(record);
  }
  for (const [site, a] of after.links) {
    if (before.links.has(site)) continue;
    row.sitesOnlyAfter++;
    if (newlyRead.includes(a.file)) row.sitesOnlyAfterInNewlyRead++;
    if (
      a.module === "rust" &&
      a.resolution === "resolved" &&
      a.kind !== "contains"
    ) {
      row.newlyResolvedNewSites++;
      newlyResolved.push({
        rank: createHash("sha256").update(`c21|${id}|${site}`).digest("hex"),
        site: newlyRead.includes(a.file)
          ? "new-in-newly-read-file"
          : "new-elsewhere",
        repo: id,
        ...describe(after.checkout, a),
        kind: a.kind,
        targetName: a.targetName,
        after: {
          resolution: a.resolution,
          reason: a.reason,
          target: targetOf(after.checkout, a),
        },
      });
    }
  }
  summary.push(row);
  console.error(
    id,
    JSON.stringify({
      ...row,
      failedRustFiles: undefined,
      newlyRead: newlyRead.length,
    }),
  );
}
const jsonl = (rows) => rows.map((x) => JSON.stringify(x)).join("\n") + "\n";
writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
writeFileSync(out + ".changed-definite.jsonl", jsonl(changedDefinite));
writeFileSync(
  out + ".newly-resolved.jsonl",
  jsonl(newlyResolved.sort((a, b) => (a.rank < b.rank ? -1 : 1))),
);
writeFileSync(out + ".other-changes.jsonl", jsonl(otherChanges));
