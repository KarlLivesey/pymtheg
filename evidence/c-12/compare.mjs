// SPDX-License-Identifier: MIT
// Compare the main and C-12 sweep databases on their pinned Rust sites.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const scratch = process.env.PYM_SCRATCH;
const exact = process.argv.includes("--exact");
const seed = "c12-rust-macro-scope-2026-11-19";
const read = (name) => JSON.parse(readFileSync(join(scratch, name), "utf8"));
const main = new Map(
  read(process.env.C12_BASELINE_RUN ?? "main-run.json").repos.map((repo) => [
    repo.id,
    repo,
  ]),
);
const checkout = (repo, baseline = false) =>
  join(
    (baseline
      ? process.env.C12_BASELINE_WORK
      : process.env.C12_CANDIDATE_WORK) ?? scratch,
    repo.attempt,
    "checkout",
  );
const bump = (obj, key) => (obj[key] = (obj[key] ?? 0) + 1);
const sortKeys = (a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
const rankOf = (parts) =>
  createHash("sha256")
    .update(JSON.stringify([seed, ...parts]))
    .digest("hex");

function graph(repo, baseline = false) {
  const db = new DatabaseSync(
    join(checkout(repo, baseline), ".pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const symbols = new Map(
    db
      .prepare(
        "SELECT id, file, kind, body FROM graph_symbols WHERE json_extract(body, '$.module')='rust'",
      )
      .all()
      .map(({ id, file, kind, body }) => {
        const { key, ordinal, identity } = JSON.parse(body);
        return [id, JSON.stringify([file, kind, key, ordinal, identity])];
      }),
  );
  const links =
    db.prepare(`SELECT l.id,l.file,l.kind,l.origin,l.body,l.target,l.resolution,
    t.ecosystem,t.unit,t.symbol,t.version,t.version_source,t.evidence
    FROM graph_links l LEFT JOIN graph_library_targets t ON t.link=l.id AND t.role='target'
    WHERE l.module='rust'`);
  const candidates = db.prepare(
    "SELECT symbol FROM graph_candidates WHERE link=?",
  );
  const libraryCandidates =
    db.prepare(`SELECT ecosystem,unit,symbol,version,version_source,evidence
    FROM graph_library_targets WHERE link=? AND role='candidate' ORDER BY ecosystem,unit,symbol,version,version_source,evidence`);
  const file = db.prepare("SELECT body FROM graph_files WHERE path=?");
  return { db, symbols, links, candidates, libraryCandidates, file };
}

function reason(data) {
  const detail = [data.reason, data.uncertainty].filter(Boolean).join("; ");
  if (detail.includes("opaque-item-may-shadow-name"))
    return "opaque macro scope";
  if (detail.includes("item-under-opaque-attribute"))
    return "item under opaque attribute";
  if (
    /glob|namespace-binding|conditional-(?:name|binding)|competing/.test(detail)
  )
    return "competing import, glob or binding";
  if (/Cargo|dependency-|directory-source/.test(detail)) return "Cargo edge";
  if (/associated-owner/.test(detail)) return "associated owner";
  if (/failed-file|invalid-code|parser-internal/.test(detail))
    return "unread or failed file";
  if (/receiver/.test(detail)) return "receiver";
  if (data.blocked) return "lexical or generic binding";
  return detail ? "other recorded reason" : "no recorded reason";
}

function site(row, store) {
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
  const definite =
    row.resolution === "resolved" || row.resolution === "library";
  const library = row.resolution === "library";
  const level2 = definite && (!library || row.symbol !== null);
  const receiver = row.kind === "calls" && !!data.method;
  const target = JSON.stringify(
    library
      ? [
          row.ecosystem,
          row.unit,
          row.symbol,
          row.version,
          row.version_source,
          row.evidence,
        ]
      : row.target
        ? store.symbols.get(row.target)
        : row.resolution === "ambiguous" && (receiver || exact)
          ? [
              store.candidates
                .all(row.id)
                .map(({ symbol }) => store.symbols.get(symbol))
                .sort(),
              ...(exact ? [store.libraryCandidates.all(row.id)] : []),
            ]
          : null,
  );
  return {
    key,
    body,
    definite,
    level2,
    receiver,
    target,
    outcome: row.resolution,
    assumed: data.assumes?.includes("rust-external-macro-name") ?? false,
    reason: reason(data),
    ...(exact ? { metadata: JSON.stringify(data) } : {}),
  };
}

function compare(previous, current) {
  const a = graph(previous, true),
    b = graph(current);
  try {
    const counters = {},
      oldSites = new Map(),
      changed = [],
      assumedSample = [],
      provenSample = [];
    const reasons = { main: {}, proven: {}, included: {} };
    const symbolKeys = new Set(b.symbols.values());
    const missingSymbols = [...a.symbols.values()].filter(
      (key) => !symbolKeys.delete(key),
    );
    const sources = new Map();
    const parsed = new Map();
    for (const row of a.links.iterate()) {
      const s = site(row, a);
      bump(counters, "mainSites");
      if (s.level2) bump(counters, "mainLevel2");
      if (s.definite) bump(counters, "existingDefinite");
      if (s.receiver) bump(counters, "receiverCalls");
      if (s.outcome === "unresolved") bump(reasons.main, s.reason);
      const prior = oldSites.get(s.key) ?? [];
      prior.push({ ...s, body: undefined });
      oldSites.set(s.key, prior);
    }
    for (const row of b.links.iterate()) {
      const s = site(row, b),
        old = oldSites.get(s.key);
      const matching =
        old?.findIndex(
          (p) =>
            p.outcome === s.outcome &&
            p.target === s.target &&
            p.metadata === s.metadata,
        ) ?? -1;
      const prior = old?.splice(Math.max(0, matching), 1)[0];
      if (old && !old.length) oldSites.delete(s.key);
      bump(counters, "candidateSites");
      if (s.level2) bump(counters, "includedLevel2");
      if (s.level2 && !s.assumed) bump(counters, "provenLevel2");
      if (s.assumed) bump(counters, `assumed:${s.outcome}`);
      if (s.outcome === "unresolved") {
        bump(reasons.proven, s.reason);
        bump(reasons.included, s.reason);
      } else if (s.assumed)
        bump(reasons.proven, prior?.reason ?? "no recorded reason");
      if (prior) {
        bump(counters, "sharedSites");
        if (prior.level2) bump(counters, "sharedMainLevel2");
        if (s.level2) bump(counters, "sharedIncludedLevel2");
        if (s.level2 && !s.assumed) bump(counters, "sharedProvenLevel2");
        if ((exact || prior.definite || prior.receiver) && matching < 0)
          changed.push({
            key: s.key,
            before: [prior.outcome, prior.target, prior.metadata],
            after: [s.outcome, s.target, s.metadata],
          });
      } else bump(counters, "addedSites");
      if (!s.level2 || prior?.level2) continue;
      if (!s.assumed) bump(counters, `newProven:${s.outcome}`);
      const rank = rankOf([current.id, current.commit, s.key]);
      const sample = s.assumed ? assumedSample : provenSample;
      const limit = s.assumed ? 10 : 20;
      if (
        sample.some((row) => row.rank === rank) ||
        (sample.length === limit && rank >= sample.at(-1).rank)
      )
        continue;
      if (!sources.has(row.file))
        sources.set(
          row.file,
          readFileSync(join(checkout(current), row.file), "utf8"),
        );
      const text = sources.get(row.file);
      const line = text.slice(0, s.body.range.start).split("\n").length;
      const scope = s.body.data?.scope ?? "";
      let nearby;
      if (s.assumed) {
        if (!parsed.has(row.file))
          parsed.set(
            row.file,
            JSON.parse(b.file.get(row.file).body).result.data,
          );
        const { standardMacroScopes = [], opaqueAttributes = [] } = parsed.get(
          row.file,
        );
        nearby = [
          ...standardMacroScopes,
          ...opaqueAttributes.filter((attr) => attr.input !== undefined),
        ]
          .filter(
            (origin) =>
              !origin.scope ||
              scope === origin.scope ||
              scope.startsWith(`${origin.scope}::`),
          )
          .map(({ name, raw, start, scope }) => ({
            name: raw ?? name,
            scope,
            line: text.slice(0, start).split("\n").length,
          }));
      }
      sample.push({
        rank,
        file: row.file,
        line,
        kind: row.kind,
        name: s.body.targetName,
        scope,
        code: text.split("\n")[line - 1]?.trim(),
        target: JSON.parse(s.target),
        before: prior?.reason,
        nearby,
      });
      sample.sort(sortKeys);
      if (sample.length > limit) sample.pop();
    }
    for (const [key, rows] of oldSites)
      for (const row of rows) {
        bump(counters, "removedSites");
        if (exact || row.definite || row.receiver)
          changed.push({ key, before: [row.outcome, row.target], after: null });
      }
    return {
      counters,
      reasons,
      missingSymbols,
      newSymbols: [...symbolKeys],
      changed,
      assumedSample,
      provenSample,
    };
  } finally {
    a.db.close();
    b.db.close();
  }
}

const results = read(
  process.env.C12_CANDIDATE_RUN ?? "candidate-run.json",
).repos.map((repo) => {
  const previous = main.get(repo.id);
  if (
    repo.commit !== previous?.commit ||
    previous.outcome !== "finished" ||
    repo.outcome !== "finished"
  ) {
    return {
      id: repo.id,
      commit: repo.commit,
      main: previous?.outcome,
      candidate: repo.outcome,
    };
  }
  return { id: repo.id, commit: repo.commit, ...compare(previous, repo) };
});
const sampledPins = new Set(
  results
    .filter((row) => row.assumedSample?.length === 10)
    .map((row) => ({ id: row.id, rank: rankOf([row.id, row.commit]) }))
    .sort(sortKeys)
    .slice(0, 6)
    .map((row) => row.id),
);
for (const row of results)
  if (!sampledPins.has(row.id)) delete row.assumedSample;
writeFileSync(
  join(scratch, "compare.json"),
  JSON.stringify({ seed, results }, null, 2),
);
if (
  exact &&
  results.some(
    (row) =>
      !row.counters ||
      row.changed.length ||
      row.missingSymbols.length ||
      row.newSymbols.length ||
      row.counters.addedSites ||
      row.counters.removedSites,
  )
)
  process.exitCode = 1;
