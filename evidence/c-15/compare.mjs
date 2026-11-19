// SPDX-License-Identifier: MIT
// C-15 comparison of two sweep runs of the same pins: every stored link,
// every symbol key and every library-target row. Usage:
//   node compare.mjs BASE_SCRATCH BASE_RUN CAND_SCRATCH CAND_RUN OUT
// Writes OUT (summary JSON) and OUT.changes.jsonl: one line per link site
// whose outcome, target, candidates or library rows differ, with its source
// line, both reasons and the target's declaration line; and
// OUT.labels.jsonl: links whose only change is the failed-file reason,
// ordered by a fixed-seed hash (seed "c15") for the hand audit.
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
    const symbols = new Map();
    for (const { body } of db.prepare("SELECT body FROM graph_symbols").iterate()) {
      const s = JSON.parse(body);
      symbols.set(s.id, {
        key: JSON.stringify([s.module, s.file, s.kind, s.identity, s.ordinal]),
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
      let site = [l.module, l.file, l.kind, l.range.start, l.range.end, l.targetName].join("|");
      while (links.has(site)) site += "+";
      links.set(site, {
        module: l.module,
        file: l.file,
        kind: l.kind,
        start: l.range.start,
        targetName: l.targetName,
        resolution: row.resolution,
        target: row.target ? (symbols.get(row.target)?.key ?? row.target) : null,
        targetSymbol: row.target ? symbols.get(row.target) : undefined,
        candidates: (candidates.get(row.id) ?? []).sort(),
        libraries: (libraries.get(row.id) ?? []).sort(),
        reason: [l.data?.reason, l.data?.uncertainty].filter(Boolean).join(" | "),
        method: !!l.data?.method,
        gap: l.data?.receiverTyping?.gap ?? (l.data?.receiverGap ? `parser:${l.data.receiverGap}` : undefined),
      });
    }
    return { checkout, symbols, links };
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
const changes = [];
const labels = [];
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
for (const [id, b] of base) {
  const c = cand.get(id);
  if (!c?.attempt || !b.attempt) {
    summary.push({ id, skipped: true });
    continue;
  }
  const before = load(baseScratch, b),
    after = load(candScratch, c);
  const keysBefore = new Set([...before.symbols.values()].map((s) => s.key));
  const keysAfter = new Set([...after.symbols.values()].map((s) => s.key));
  const row = {
    id,
    symbolKeysRemoved: [...keysBefore].filter((k) => !keysAfter.has(k)).length,
    symbolKeysAdded: [...keysAfter].filter((k) => !keysBefore.has(k)).length,
    links: { before: before.links.size, after: after.links.size },
    sitesOnlyBefore: 0,
    sitesOnlyAfter: 0,
    rust: { links: 0, level2Before: 0, level2After: 0, taintBefore: 0, taintAfter: 0 },
    definiteBefore: 0,
    definiteKept: 0,
    definiteChanged: 0,
    libraryRowsChanged: 0,
    level2Lost: 0,
    transitions: {},
  };
  for (const [site, l] of before.links) {
    const a = after.links.get(site);
    if (!a) {
      row.sitesOnlyBefore++;
      continue;
    }
    if (l.module === "rust") {
      row.rust.links++;
      if (level2(l)) row.rust.level2Before++;
      if (level2(a)) row.rust.level2After++;
      if (taint(l)) row.rust.taintBefore++;
      if (taint(a)) row.rust.taintAfter++;
    }
    if (level2(l) && !level2(a)) row.level2Lost++;
    if (l.resolution === "resolved") {
      row.definiteBefore++;
      if (a.resolution === "resolved" && a.target === l.target) row.definiteKept++;
      else row.definiteChanged++;
    }
    const libChanged = JSON.stringify(l.libraries) !== JSON.stringify(a.libraries);
    if (libChanged) row.libraryRowsChanged++;
    const changed =
      l.resolution !== a.resolution ||
      l.target !== a.target ||
      JSON.stringify(l.candidates) !== JSON.stringify(a.candidates) ||
      libChanged;
    if (!changed) {
      // Reason-only change: the failed-file reason dropped or added.
      if (taint(l) !== taint(a)) {
        row[taint(l) ? "labelDropped" : "labelAdded"] =
          (row[taint(l) ? "labelDropped" : "labelAdded"] ?? 0) + 1;
        const src = text(after.checkout, l.file);
        const line = lineOf(src, l.start);
        labels.push({
          rank: createHash("sha256").update(`c15|${id}|${site}`).digest("hex"),
          repo: id,
          file: l.file,
          line,
          code: src.split("\n")[line - 1]?.trim().slice(0, 160),
          kind: l.kind,
          targetName: l.targetName,
          resolution: a.resolution,
          gap: a.gap,
          before: l.reason,
          after: a.reason,
        });
      }
      continue;
    }
    const t = `${l.resolution}->${a.resolution}`;
    row.transitions[t] = (row.transitions[t] ?? 0) + 1;
    const src = text(after.checkout, l.file);
    const line = lineOf(src, l.start);
    const target = a.targetSymbol
      ? {
          file: a.targetSymbol.file,
          line: lineOf(text(after.checkout, a.targetSymbol.file), a.targetSymbol.start),
          name: a.targetSymbol.name,
          kind: a.targetSymbol.kind,
        }
      : undefined;
    changes.push({
      repo: id,
      file: l.file,
      line,
      code: src.split("\n")[line - 1]?.trim().slice(0, 160),
      kind: l.kind,
      method: l.method,
      targetName: l.targetName,
      before: { resolution: l.resolution, reason: l.reason, target: l.target, libraries: l.libraries },
      after: { resolution: a.resolution, reason: a.reason, target, libraries: a.libraries },
    });
  }
  for (const site of after.links.keys())
    if (!before.links.has(site)) row.sitesOnlyAfter++;
  summary.push(row);
  console.error(id, JSON.stringify(row));
}
writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
writeFileSync(out + ".changes.jsonl", changes.map((x) => JSON.stringify(x)).join("\n") + "\n");
writeFileSync(out + ".labels.jsonl", labels.sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((x) => JSON.stringify(x)).join("\n") + "\n");
