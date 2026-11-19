// SPDX-License-Identifier: MIT
// C-24: compare a candidate sweep with several runs of main, site by site,
// using the C-12 comparator's site key and decision (outcome, target or
// library row, receiver candidate sets, assumption marks). Main is itself
// unstable between runs, so "lost" means: a decision some main run made
// definite that the candidate does not reproduce. Writes a JSON summary and
// draws an audit sample of newly definite Level 2 links at a fixed seed.
// Usage: node union.mjs OUT.json CANDIDATE.json MAIN.json [MAIN.json ...]
// Each results file X.json has its sweep scratch folder at X/.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [out, candidatePath, ...mainPaths] = process.argv.slice(2);
const seed = process.env.PYM_AUDIT_SEED ?? "c24-rust-determinism-2026-11-19";
const auditSize = Number(process.env.PYM_AUDIT_SIZE ?? 40);
const load = (path) => {
  const results = JSON.parse(readFileSync(path, "utf8"));
  const scratch = path.replace(/\.json$/, "");
  return new Map(
    results.repos
      .filter((repo) => repo.outcome === "finished")
      .map((repo) => [repo.id, join(scratch, repo.attempt, "checkout")]),
  );
};
const candidate = load(candidatePath);
const mains = mainPaths.map(load);
const rank = (parts) =>
  createHash("sha256")
    .update(JSON.stringify([seed, ...parts]))
    .digest("hex");

function sites(checkout) {
  const db = new DatabaseSync(
    join(checkout, ".pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const symbols = new Map(
    db
      .prepare(
        "SELECT id,file,kind,body FROM graph_symbols WHERE json_extract(body,'$.module')='rust'",
      )
      .all()
      .map(({ id, file, kind, body }) => {
        const { key, ordinal, identity } = JSON.parse(body);
        return [id, JSON.stringify([file, kind, key, ordinal, identity])];
      }),
  );
  const candidates = db.prepare(
    "SELECT symbol FROM graph_candidates WHERE link=?",
  );
  const result = new Map();
  for (const row of db
    .prepare(
      `SELECT l.id,l.file,l.kind,l.origin,l.body,l.target,l.resolution,
      t.ecosystem,t.unit,t.symbol,t.version,t.version_source,t.evidence
      FROM graph_links l LEFT JOIN graph_library_targets t ON t.link=l.id AND t.role='target'
      WHERE l.module='rust'`,
    )
    .iterate()) {
    const body = JSON.parse(row.body),
      data = body.data ?? {};
    const key = JSON.stringify([
      row.file,
      row.kind,
      row.origin,
      body.range.start,
      body.range.end,
      body.targetName,
      body.sourceKey,
    ]);
    const library = row.resolution === "library";
    const definite = row.resolution === "resolved" || library;
    const receiver = row.kind === "calls" && !!data.method;
    const target = library
      ? JSON.stringify([
          row.ecosystem,
          row.unit,
          row.symbol,
          row.version,
          row.version_source,
          row.evidence,
        ])
      : row.target
        ? symbols.get(row.target)
        : row.resolution === "ambiguous" && receiver
          ? JSON.stringify(
              candidates
                .all(row.id)
                .map(({ symbol }) => symbols.get(symbol))
                .sort(),
            )
          : null;
    const decision = JSON.stringify([
      row.resolution,
      target,
      [...(data.assumes ?? [])].sort(),
    ]);
    const list = result.get(key) ?? [];
    list.push({
      decision,
      definite,
      level2: definite && (!library || row.symbol !== null),
      file: row.file,
      start: body.range.start,
      kind: row.kind,
      name: body.targetName,
      target,
      reason: [data.reason, data.uncertainty].filter(Boolean).join("; "),
    });
    result.set(key, list);
  }
  db.close();
  return { result, symbols: new Set(symbols.values()) };
}

const summary = { seed, pins: [] };
const fresh = [];
for (const [id, checkout] of candidate) {
  const runs = mains.map((m) => m.get(id));
  if (runs.some((r) => !r)) {
    summary.pins.push({ id, skipped: "not finished in every main run" });
    continue;
  }
  const cand = sites(checkout);
  const main = runs.map(sites);
  const row = {
    id,
    candidateSites: 0,
    candidateLevel2: 0,
    mainSites: main.map(() => 0),
    mainLevel2: main.map(() => 0),
    likeForLikeSites: 0,
    likeForLikeCandidateLevel2: 0,
    likeForLikeMainLevel2: main.map(() => 0),
    mainUnstableSites: 0,
    unionDefinite: 0,
    lostStable: [],
    lostUnstable: 0,
    lostUnstableSamples: [],
    newLevel2: 0,
    newLevel2Stable: 0,
    retargeted: 0,
    symbolKeysMissing: [...main[0].symbols].filter((k) => !cand.symbols.has(k))
      .length,
    symbolKeysAdded: [...cand.symbols].filter((k) => !main[0].symbols.has(k))
      .length,
  };
  for (const [i, m] of main.entries())
    for (const list of m.result.values())
      for (const s of list) {
        row.mainSites[i]++;
        if (s.level2) row.mainLevel2[i]++;
      }
  for (const [key, list] of cand.result) {
    const others = main.map((m) => m.result.get(key) ?? []);
    const shared = others.every((o) => o.length === list.length);
    for (const [j, s] of list.entries()) {
      row.candidateSites++;
      if (s.level2) row.candidateLevel2++;
      const before = others.map((o) => o[j]);
      if (shared) {
        row.likeForLikeSites++;
        if (s.level2) row.likeForLikeCandidateLevel2++;
        before.forEach((b, i) => b?.level2 && row.likeForLikeMainLevel2[i]++);
      }
      const decisions = new Set(before.filter(Boolean).map((b) => b.decision));
      const unstable = decisions.size > 1;
      if (unstable) row.mainUnstableSites++;
      const definiteBefore = before.filter((b) => b?.definite);
      if (definiteBefore.length) row.unionDefinite++;
      const lost = definiteBefore.filter((b) => b.decision !== s.decision);
      if (lost.length) {
        if (unstable) {
          row.lostUnstable++;
          if (row.lostUnstableSamples.length < 12)
            row.lostUnstableSamples.push({
              file: s.file,
              start: s.start,
              kind: s.kind,
              name: s.name,
              main: [...decisions],
              candidate: s.decision,
            });
        } else
          row.lostStable.push({
            file: s.file,
            start: s.start,
            kind: s.kind,
            name: s.name,
            main: lost[0].decision,
            candidate: s.decision,
            reason: s.reason,
          });
        if (s.definite) row.retargeted++;
      }
      if (s.level2 && !before.some((b) => b?.level2 && b.decision === s.decision)) {
        row.newLevel2++;
        if (!unstable) row.newLevel2Stable++;
        fresh.push({ id, ...s, mainBefore: [...decisions], rank: rank([id, key, j]) });
      }
    }
  }
  // Sites that main had and the candidate does not have at all.
  row.mainOnlySites = 0;
  for (const [key, list] of main[0].result)
    if (!cand.result.has(key)) row.mainOnlySites += list.length;
  summary.pins.push(row);
  console.log(
    id,
    `L2 ${row.mainLevel2.join("/")} -> ${row.candidateLevel2} of ${row.candidateSites}`,
    `lostStable ${row.lostStable.length} lostUnstable ${row.lostUnstable}`,
    `new ${row.newLevel2} (stable ${row.newLevel2Stable}) unstable ${row.mainUnstableSites}`,
    `symbols -${row.symbolKeysMissing} +${row.symbolKeysAdded}`,
  );
}
fresh.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
summary.audit = fresh.slice(0, auditSize).map(({ rank: _r, ...s }) => s);
writeFileSync(out, JSON.stringify(summary, null, 1));
