// SPDX-License-Identifier: MIT
// C-42: compare main's and the candidate's installed TypeScript graphs pin by
// pin. Every symbol must be unchanged. Every link site must have the same
// resolution, checkout targets and candidates, library rows and data, except
// the `mergedGlobal` mark. Level 2 is reported without and with the
// proposed rule (coverage-rules.mjs `mergedGlobalLevel2`); row counts are the
// stored symbols, links and library rows.
// Usage: node compare.mjs SCRATCH MAIN.json HEAD.json OUT_PREFIX
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mergedGlobalLevel2, storedLibraryIdentity } from "../../scripts/sweep/coverage-rules.mjs";

const [scratch, mainPath, headPath, out] = process.argv.slice(2);
const runs = [mainPath, headPath].map(
  (path) => new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((repo) => [repo.id, repo])),
);
function load(repo) {
  const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const libraries = db.prepare("SELECT role, ecosystem, unit, symbol, version, evidence FROM graph_library_targets WHERE link=? ORDER BY role, ecosystem, unit, symbol");
  // Symbol ids include the project id, so symbols and candidates are compared
  // by file, kind, identity and key.
  const symbolKey = ({ file, body }) => {
    const symbol = JSON.parse(body);
    return `${file}\0${symbol.kind}\0${symbol.identity}\0${symbol.key}`;
  };
  const candidates = db.prepare("SELECT s.file, s.body FROM graph_candidates c JOIN graph_symbols s ON s.id=c.symbol WHERE c.link=?");
  const symbolIds = new Map(db.prepare("SELECT id, file, body FROM graph_symbols").all().map((row) => [row.id, symbolKey(row)]));
  const symbols = new Set(symbolIds.values());
  const links = new Map();
  for (const row of db.prepare("SELECT id, file, resolution, body FROM graph_links WHERE module='typescript'").iterate()) {
    const link = JSON.parse(row.body);
    const { mergedGlobal, ...data } = link.data ?? {};
    const libs = libraries.all(row.id);
    const checkout = candidates.all(row.id).map(symbolKey).sort();
    links.set(`${row.file}\0${link.kind}\0${link.range.start}\0${link.targetName}`, {
      file: row.file,
      line: link.range.start,
      name: link.targetName,
      kind: link.kind,
      resolution: row.resolution,
      mergedGlobal: mergedGlobal === true,
      identity: JSON.stringify([row.resolution, link.targetId ? symbolIds.get(link.targetId) ?? link.targetId : null, checkout, libs, data]),
      level2: row.resolution === "resolved" ||
        (row.resolution === "library" && storedLibraryIdentity({ file: row.file, resolution: "library", library: libs[0] }).level === 2),
      merged: row.resolution === "ambiguous" &&
        mergedGlobalLevel2(link.data ?? {}, libs.filter(({ role }) => role === "candidate"), checkout.length),
    });
  }
  const rows = {
    symbols: symbols.size,
    links: links.size,
    libraryRows: db.prepare("SELECT count(*) AS n FROM graph_library_targets").get().n,
  };
  db.close();
  return { symbols, links, rows };
}
const summary = [];
const changed = [];
const merged = [];
for (const [id, mainRepo] of runs[0]) {
  const headRepo = runs[1].get(id);
  if (mainRepo.outcome !== "finished" || headRepo?.outcome !== "finished") continue;
  const a = load(mainRepo);
  const b = load(headRepo);
  const row = {
    pin: id,
    links: [a.links.size, b.links.size],
    level2: [0, 0],
    level2WithRule: [0, 0],
    merged: 0,
    changedLinks: 0,
    onlyMain: 0,
    onlyHead: 0,
    symbolsOnlyMain: [...a.symbols].filter((s) => !b.symbols.has(s)).length,
    symbolsOnlyHead: [...b.symbols].filter((s) => !a.symbols.has(s)).length,
    rows: [a.rows, b.rows],
  };
  for (const [side, graph] of [[0, a], [1, b]])
    for (const link of graph.links.values()) {
      if (link.level2) row.level2[side]++;
      if (link.level2 || link.merged) row.level2WithRule[side]++;
    }
  for (const [key, link] of a.links) {
    const now = b.links.get(key);
    if (!now) { row.onlyMain++; continue; }
    if (now.identity !== link.identity) {
      row.changedLinks++;
      changed.push({ pin: id, file: link.file, start: link.line, kind: link.kind, name: link.name, before: link.identity, after: now.identity });
    }
    if (now.merged) {
      row.merged++;
      merged.push({ pin: id, file: now.file, start: now.line, kind: now.kind, name: now.name });
    }
  }
  for (const key of b.links.keys()) if (!a.links.has(key)) row.onlyHead++;
  summary.push(row);
}
writeFileSync(`${out}.summary.json`, JSON.stringify(summary, null, 1) + "\n");
writeFileSync(`${out}.changed.jsonl`, changed.map((c) => JSON.stringify(c)).join("\n") + (changed.length ? "\n" : ""));
writeFileSync(`${out}.merged.jsonl`, merged.map((c) => JSON.stringify(c)).join("\n") + (merged.length ? "\n" : ""));
for (const row of summary)
  console.log(row.pin, row.level2.join("→"), "with rule", row.level2WithRule.join("→"), "merged", row.merged, "changed", row.changedLinks, "sites", row.onlyMain, row.onlyHead, "symbols", row.symbolsOnlyMain, row.symbolsOnlyHead);
