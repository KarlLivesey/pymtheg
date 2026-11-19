// SPDX-License-Identifier: MIT
// C-10 comparison of two sweep runs of the same pins: every stored link and
// every symbol key. Usage:
//   node compare.mjs BASE_SCRATCH BASE_RUN CAND_SCRATCH CAND_RUN OUT [SAMPLE]
// Writes OUT (summary JSON). With SAMPLE, also writes OUT.sample.json: the
// lowest-hash newly definite links per mechanism (fixed seed "c10").
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [baseScratch, baseRun, candScratch, candRun, out, sampleSize] =
  process.argv.slice(2);
const runs = (path) =>
  new Map(
    JSON.parse(readFileSync(path, "utf8")).repos.map((r) => [r.id, r]),
  );
const base = runs(baseRun),
  cand = runs(candRun);

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
    // Library targets (graph schema 4): every row, by role and identity.
    const libraries = new Map();
    const hasLibraries = db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'graph_library_targets'")
      .get();
    if (hasLibraries)
      for (const r of db
        .prepare("SELECT link, role, id, unit, symbol, evidence FROM graph_library_targets")
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
        data: l.data ?? {},
      });
    }
    return { checkout, symbols, links };
  } finally {
    db.close();
  }
}

const mechanism = (l) =>
  l.data.localBinding
    ? "local-binding"
    : l.data.typeParameter
      ? "type-parameter"
      : l.data.method
        ? l.data.receiverExpr
          ? "method-inferred-receiver"
          : "method-written-receiver"
        : "other";
const hash = (s) => createHash("sha256").update("c10|" + s).digest("hex");
const summary = [];
const samples = [];
for (const [id, b] of base) {
  const c = cand.get(id);
  // An incomplete index (failed files) still has a graph; compare like with like.
  if (
    !c ||
    !["ok", "incomplete"].includes(b.cold?.status) ||
    b.cold?.status !== c.cold?.status
  ) {
    summary.push({ id, skipped: true });
    continue;
  }
  const before = load(baseScratch, b),
    after = load(candScratch, c);
  const keysBefore = new Set([...before.symbols.values()].map((s) => s.key));
  const keysAfter = new Set([...after.symbols.values()].map((s) => s.key));
  const row = {
    id,
    symbols: { before: keysBefore.size, after: keysAfter.size },
    symbolKeysRemoved: [...keysBefore].filter((k) => !keysAfter.has(k)).length,
    symbolKeysAdded: [...keysAfter].filter((k) => !keysBefore.has(k)).length,
    links: { before: before.links.size, after: after.links.size },
    sitesOnlyBefore: 0,
    sitesOnlyAfter: 0,
    definiteBefore: 0,
    definiteKept: 0,
    definiteChanged: [],
    libraryChanged: 0,
    ambiguousBefore: 0,
    ambiguousChanged: 0,
    newDefinite: {},
    rust: { before: 0, after: 0, total: 0 },
    receiverGaps: {},
    outsideReceivers: 0,
    outsideChanged: 0,
    libraryTargetLinks: 0,
    libraryTargetsChanged: [],
  };
  for (const [site, l] of before.links) {
    const a = after.links.get(site);
    if (!a) {
      row.sitesOnlyBefore++;
      continue;
    }
    if (l.module === "rust") {
      row.rust.total++;
      if (l.resolution === "resolved") row.rust.before++;
      if (a.resolution === "resolved") row.rust.after++;
    }
    if (l.resolution === "resolved") {
      row.definiteBefore++;
      if (a.resolution === "resolved" && a.target === l.target) row.definiteKept++;
      else
        row.definiteChanged.push({
          site,
          before: l.target,
          after: a.resolution === "resolved" ? a.target : a.resolution,
        });
    } else if (l.resolution === "library") {
      if (a.resolution !== "library") row.libraryChanged++;
    } else if (l.resolution === "ambiguous") {
      row.ambiguousBefore++;
      if (
        a.resolution !== "ambiguous" ||
        JSON.stringify(a.candidates) !== JSON.stringify(l.candidates)
      )
        row.ambiguousChanged++;
    }
    // Library target rows are compared exactly, whatever the outcome.
    if (l.libraries.length || a.libraries.length) {
      if (l.libraries.length) row.libraryTargetLinks++;
      if (JSON.stringify(l.libraries) !== JSON.stringify(a.libraries))
        row.libraryTargetsChanged.push({ site, before: l.libraries, after: a.libraries });
    }
    // A call whose receiver has a proven library type keeps its outcome.
    if (a.data.receiverTyping?.outside &&
      (a.resolution !== l.resolution || a.target !== l.target ||
        JSON.stringify(a.candidates) !== JSON.stringify(l.candidates)))
      row.outsideChanged++;
    if (l.resolution !== "resolved" && a.resolution === "resolved") {
      const m = mechanism(a);
      row.newDefinite[m] = (row.newDefinite[m] ?? 0) + 1;
      samples.push({ repo: id, checkout: after.checkout, site, mechanism: m, link: a, rank: hash(id + "|" + site) });
    }
    if (a.module === "rust" && a.data.method && a.resolution !== "resolved") {
      const gap =
        a.data.receiverTyping?.gap ??
        (a.data.receiverTyping?.outside ? "outside-type" : undefined) ??
        a.data.receiverGap ??
        (a.data.receiverType ? "written-type" : "no-recipe");
      row.receiverGaps[gap] = (row.receiverGaps[gap] ?? 0) + 1;
      if (a.data.receiverTyping?.outside) row.outsideReceivers++;
    }
  }
  for (const site of after.links.keys())
    if (!before.links.has(site)) row.sitesOnlyAfter++;
  row.definiteChanged = row.definiteChanged.slice(0, 50);
  row.libraryTargetsChanged = row.libraryTargetsChanged.slice(0, 50);
  summary.push(row);
  console.error(id, JSON.stringify({ kept: row.definiteKept, of: row.definiteBefore, changed: row.definiteChanged.length, newDefinite: row.newDefinite }));
}
writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
if (sampleSize) {
  const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;
  const picked = [];
  const by = new Map();
  for (const s of samples) {
    const list = by.get(s.mechanism) ?? [];
    list.push(s);
    by.set(s.mechanism, list);
  }
  for (const [m, list] of by) {
    list.sort((x, y) => (x.rank < y.rank ? -1 : 1));
    for (const s of list.slice(0, Number(sampleSize))) {
      const source = readFileSync(join(s.checkout, s.link.file), "utf8");
      const t = s.link.targetSymbol;
      const targetSource = t ? readFileSync(join(s.checkout, t.file), "utf8") : "";
      picked.push({
        mechanism: m,
        repo: s.repo,
        file: s.link.file,
        line: lineOf(source, s.link.start),
        code: source.split("\n")[lineOf(source, s.link.start) - 1].trim(),
        targetName: s.link.targetName,
        target: t
          ? `${t.file}:${lineOf(targetSource, t.start)} ${t.kind} ${t.name}`
          : null,
        targetLine: t ? targetSource.split("\n")[lineOf(targetSource, t.start) - 1].trim() : null,
        binding: s.link.data.localBinding ?? s.link.data.typeParameter ?? null,
      });
    }
  }
  writeFileSync(out.replace(/\.json$/, "") + ".sample.json", JSON.stringify(picked, null, 2) + "\n");
}
