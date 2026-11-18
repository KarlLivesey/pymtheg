// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, runPath, stalledManifest] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const previousStalls = new Set(read(stalledManifest).map((repo) => repo.id));
const sample = [];
const seed = "pymtheg-c1-definite-links";
const line = (text, offset) => text.slice(0, offset).split("\n").length;

for (const repo of read(runPath).repos) {
  if (repo.outcome !== "finished" || !previousStalls.has(repo.id)) continue;
  const root = join(scratch, repo.attempt, "checkout");
  const db = new DatabaseSync(join(root, ".pymtheg", "rebuildable", "graph.sqlite"), {
    readOnly: true,
  });
  try {
    for (const row of db.prepare(`
      SELECT l.body, s.body AS target
      FROM graph_links l JOIN graph_symbols s ON l.target=s.id
      WHERE l.module='rust' AND l.resolution='resolved' AND l.kind<>'contains'
    `).iterate()) {
      const link = JSON.parse(row.body);
      const key = JSON.stringify([seed, repo.id, link.file, link.kind, link.range, link.targetName, link.key]);
      const rank = createHash("sha256").update(key).digest("hex");
      if (sample.length === 20 && rank >= sample.at(-1).rank) continue;
      sample.push({ rank, repo: repo.id, root, link, target: JSON.parse(row.target) });
      sample.sort((a, b) => a.rank.localeCompare(b.rank));
      if (sample.length > 20) sample.pop();
    }
  } finally {
    db.close();
  }
}
const output = sample.map(({ repo, root, link, target }) => {
  const source = readFileSync(join(root, link.file), "utf8");
  const definition = readFileSync(join(root, target.file), "utf8");
  return {
    repo, kind: link.kind, file: link.file, line: line(source, link.range.start),
    name: link.targetName,
    target: { file: target.file, line: line(definition, target.range.start), identity: target.identity },
  };
});
console.log(JSON.stringify(output, null, 2));
