// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";

const [scratch, baselineRun, candidateRun] = process.argv.slice(2);
const readRun = (path) =>
  new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((repo) => [repo.id, repo]));
const candidate = readRun(candidateRun);

async function dump(repo, role) {
  const result = createHash("sha256");
  const path = join(scratch, repo.attempt, "checkout", ".pymtheg", "rebuildable", "graph.sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  const output = createWriteStream(join(scratch, repo.id.replace("/", "-") + "-" + role + ".jsonl"));
  const symbols = new Map();
  const candidates = new Map();
  try {
    for (const { body } of db.prepare("SELECT body FROM graph_symbols").iterate()) {
      const s = JSON.parse(body);
      symbols.set(s.id, {
        identity: JSON.stringify([s.module, s.file, s.kind, s.identity, s.ordinal]),
        status: s.status,
      });
    }
    for (const { link, symbol } of db.prepare("SELECT link, symbol FROM graph_candidates").iterate()) {
      const list = candidates.get(link) ?? [];
      list.push(JSON.stringify(symbols.get(symbol)));
      candidates.set(link, list);
    }
    const rows = [];
    for (const row of db.prepare("SELECT id, source, target, resolution, body FROM graph_links").iterate()) {
      const { id, sourceId, targetId, candidates: ignored, ...body } = JSON.parse(row.body);
      if (body.module === "rust" && Array.isArray(body.data?.targets))
        body.data.targets = body.data.targets.map((id) => {
          if (!symbols.has(id)) throw Error("Unmatched would-be target " + id);
          return symbols.get(id).identity;
        }).sort();
      rows.push(JSON.stringify({
        ...body,
        resolution: row.resolution,
        source: symbols.get(row.source)?.identity ?? null,
        target: symbols.get(row.target) ?? null,
        candidates: (candidates.get(row.id) ?? []).sort(),
      }));
    }
    rows.sort();
    for (const row of rows) {
      if (!output.write(row + "\n")) await new Promise((resume) => output.once("drain", resume));
      result.update(row + "\n");
    }
    return { links: rows.length, sha256: result.digest("hex") };
  } finally {
    db.close();
    output.end();
    await finished(output);
  }
}
const comparison = [];
for (const [id, baseline] of readRun(baselineRun)) {
  const after = candidate.get(id);
  if (!after || after.outcome !== "finished" || baseline.outcome !== "finished")
    throw Error("Comparison requires two finished graphs for " + id);
  const before = await dump(baseline, "release");
  const current = await dump(after, "candidate");
  comparison.push({ id, before, after: current, identical: before.sha256 === current.sha256 });
}
console.log(JSON.stringify(comparison, null, 2));
