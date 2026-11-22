// SPDX-License-Identifier: MIT
// SW-6: for every TypeScript link below Level 2 in the finished installed
// graphs, keep the N lowest-ranked sites per first stored blocker across all
// pins (rank = sha256(seed, pin, commit, link id), the exporter's rule), with
// a source excerpt. Also count each group by pin and link kind.
// Run from the sweep tree: node evidence/sw-6/draw-installed.mjs RUN.json OUT.json [N] [SEED]
import { hash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedLibraryIdentity } from "../../scripts/sweep/coverage-rules.mjs";
import { firstBlocker, storedReasons } from "../../scripts/sweep/coverage-refresh-data.mjs";

const [runPath, out, n = "10", seed = "pymtheg-sw6-2026"] = process.argv.slice(2);
const limit = Number(n);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const scratch = dirname(runPath);
// The exporter's privacy filter for excerpts from public pins.
const excerpt = (text, max = 200) =>
  text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(\b(?:https?|wss?|ssh):\/\/)[^/\s`"'?]+/gi, "$1[host]")
    .replace(/\blocalhost\b/gi, "[host]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]")
    .replace(/(?:\/home\/|\/Users\/|\/root\/|[A-Za-z]:\\Users\\)[^\s`"']+/g, "[path]")
    .trim().slice(0, max);
const groups = new Map();
for (const repo of run.repos) {
  if (repo.outcome !== "finished") continue;
  const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const sourceFor = db.prepare("SELECT json_extract(body,'$.text') AS text FROM graph_files WHERE path=?");
  const texts = new Map();
  const rows = db.prepare(`SELECT l.file,l.id,l.kind,l.module,l.resolution,l.body,t.unit,t.symbol,t.evidence
    FROM graph_links l LEFT JOIN graph_library_targets t ON l.resolution='library' AND t.link=l.id AND t.role='target'
    WHERE l.module='typescript'`).iterate();
  for (const row of rows) {
    const { data = {}, range, targetName } = JSON.parse(row.body);
    const library = row.resolution === "library" ? storedLibraryIdentity({ file: row.file, resolution: row.resolution, library: row }) : null;
    if (row.resolution === "resolved" || library?.level === 2) continue;
    const reason = firstBlocker(storedReasons(data), row.resolution);
    const group = groups.get(reason) ?? { reason, links: 0, pins: {}, kinds: {}, sites: [] };
    group.links++;
    group.pins[repo.id] = (group.pins[repo.id] ?? 0) + 1;
    group.kinds[row.kind] = (group.kinds[row.kind] ?? 0) + 1;
    groups.set(reason, group);
    const rank = hash("sha256", `${seed}\0${repo.id}\0${repo.commit}\0${row.id}`);
    if (group.sites.length === limit && rank >= group.sites.at(-1).rank) continue;
    let text = texts.get(row.file);
    if (text === undefined) texts.set(row.file, (text = sourceFor.get(row.file)?.text ?? ""));
    const start = range?.start ?? 0;
    const line = text.slice(0, start).split("\n").length;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", start);
    const site = {
      rank, pin: repo.id, file: row.file, line, kind: row.kind, outcome: row.resolution,
      reasons: storedReasons(data), target: excerpt(targetName ?? "", 120),
      ...(library ? { unit: library.unit } : {}),
      code: excerpt(text.slice(Math.max(lineStart, start - 90), Math.min(lineEnd < 0 ? text.length : lineEnd, start + 130))),
    };
    const at = group.sites.findIndex((entry) => rank < entry.rank);
    group.sites.splice(at < 0 ? group.sites.length : at, 0, site);
    if (group.sites.length > limit) group.sites.pop();
  }
  db.close();
  console.error(`${repo.id} done`);
}
const result = [...groups.values()].sort((a, b) => b.links - a.links);
writeFileSync(out, JSON.stringify({ seed, limit, groups: result }, null, 1) + "\n");
