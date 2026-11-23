// SPDX-License-Identifier: MIT
// Compare main's and a candidate's TypeScript graphs pin by pin.
// Usage: node compare.mjs SWEEP_SCRATCH MAIN.json CAND.json OUT_PREFIX
// Writes OUT_PREFIX.summary.json, OUT_PREFIX.changed.jsonl (every link that
// was Level 2 on main and is not, or has another target) and
// OUT_PREFIX.new.jsonl (every link Level 2 only in the candidate).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, mainPath, candPath, out] = process.argv.slice(2);
const runs = [mainPath, candPath].map(
  (p) => new Map(JSON.parse(readFileSync(p, "utf8")).repos.map((r) => [r.id, r])),
);
const SCOPE = new Set(["ambiguous-project", "incomplete-config", "competing-test-globals"]);

function load(repo) {
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const libs = new Map();
  for (const r of db.prepare("SELECT link, ecosystem, unit, symbol FROM graph_library_targets").iterate()) {
    const list = libs.get(r.link) ?? [];
    list.push(`${r.ecosystem}:${r.unit}:${r.symbol ?? ""}`);
    libs.set(r.link, list);
  }
  const symbols = new Map();
  for (const r of db.prepare("SELECT id, file, body FROM graph_symbols").iterate()) {
    const b = JSON.parse(r.body);
    symbols.set(r.id, `${r.file}#${b.kind}#${b.identity ?? b.name}#${b.key}`);
  }
  const owners = new Map();
  for (const r of db.prepare("SELECT path, body FROM graph_files WHERE json_extract(body,'$.module')='typescript'").iterate()) {
    const d = JSON.parse(r.body).result?.data ?? {};
    owners.set(r.path, d.projects ? `tie:${d.projects.join("+")}` : (d.project ?? "(none)"));
  }
  const links = new Map();
  for (const r of db.prepare("SELECT id, file, body, resolution, json_extract(body,'$.targetId') AS targetId FROM graph_links WHERE module='typescript'").iterate()) {
    const b = JSON.parse(r.body);
    const key = JSON.stringify([r.file, b.kind, b.range.start, b.range.end, b.targetName, b.sourceKey]);
    const lib = (libs.get(r.id) ?? []).sort();
    const level2 =
      r.resolution === "resolved" ||
      (r.resolution === "library" && lib.some((l) => !l.endsWith(":")));
    links.set(key, {
      file: r.file,
      kind: b.kind,
      start: b.range.start,
      name: b.targetName,
      resolution: r.resolution,
      reason: b.data?.reason ?? null,
      target: r.resolution === "resolved" ? symbols.get(r.targetId) ?? r.targetId : lib.join(","),
      level2,
      projects: b.data?.projects,
      byProject: b.data?.byProject ? Object.keys(b.data.byProject) : undefined,
    });
  }
  db.close();
  return { links, symbols: new Set(symbols.values()), owners };
}

const summary = [];
const changed = [];
const fresh = [];
for (const [pin, mainRepo] of runs[0]) {
  const candRepo = runs[1].get(pin);
  if (mainRepo.outcome !== "finished" || candRepo?.outcome !== "finished") {
    summary.push({ pin, main: mainRepo.outcome, cand: candRepo?.outcome });
    continue;
  }
  const a = load(mainRepo);
  const b = load(candRepo);
  const row = {
    pin,
    links: [a.links.size, b.links.size],
    level2: [0, 0],
    likeForLikeLevel2: 0,
    onlyMain: 0,
    onlyCand: 0,
    changedDefinite: 0,
    newlyDefinite: 0,
    symbolsOnlyMain: [...a.symbols].filter((s) => !b.symbols.has(s)).length,
    symbolsOnlyCand: [...b.symbols].filter((s) => !a.symbols.has(s)).length,
    ownerChanges: {},
    scope: {},
  };
  for (const [path, owner] of a.owners) {
    const next = b.owners.get(path);
    if (next !== owner) {
      const k = `${owner} -> ${next}`;
      row.ownerChanges[k] = (row.ownerChanges[k] ?? 0) + 1;
    }
  }
  for (const l of a.links.values()) if (l.level2) row.level2[0]++;
  for (const l of b.links.values()) if (l.level2) row.level2[1]++;
  for (const [key, l] of a.links) {
    const m = b.links.get(key);
    if (!m) {
      row.onlyMain++;
      if (l.level2) changed.push({ pin, ...l, now: null });
      continue;
    }
    if (m.level2) row.likeForLikeLevel2++;
    if (l.level2 && (!m.level2 || m.target !== l.target)) {
      row.changedDefinite++;
      changed.push({ pin, ...l, now: { resolution: m.resolution, reason: m.reason, target: m.target } });
    }
    if (!l.level2 && m.level2) {
      row.newlyDefinite++;
      fresh.push({ pin, ...m, before: { resolution: l.resolution, reason: l.reason, projects: l.projects } });
    }
    const reason = l.reason && SCOPE.has(l.reason) ? l.reason : l.reason === "no-symbol" && a.owners.get(l.file) !== b.owners.get(l.file) ? "no-symbol (owner changed)" : undefined;
    if (reason) {
      const k = `${reason} | ${a.owners.get(l.file)} -> ${b.owners.get(l.file)} | ${m.level2 ? "level2" : m.reason ?? m.resolution}`;
      row.scope[k] = (row.scope[k] ?? 0) + 1;
    }
  }
  for (const key of b.links.keys()) if (!a.links.has(key)) row.onlyCand++;
  summary.push(row);
  console.error(pin, row.level2, "changed", row.changedDefinite, "new", row.newlyDefinite, "symbols", row.symbolsOnlyMain, row.symbolsOnlyCand);
}
writeFileSync(`${out}.summary.json`, JSON.stringify(summary, null, 1) + "\n");
writeFileSync(`${out}.changed.jsonl`, changed.map((r) => JSON.stringify(r)).join("\n") + (changed.length ? "\n" : ""));
writeFileSync(`${out}.new.jsonl`, fresh.map((r) => JSON.stringify(r)).join("\n") + (fresh.length ? "\n" : ""));
