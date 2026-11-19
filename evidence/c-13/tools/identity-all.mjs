// identity-all.mjs SCRATCH BASE_RUN CAND_RUN OUT : runs identity.mjs on every
// repository both sweep runs indexed (cold index ok or incomplete), with the
// TypeScript module version mapped back, and writes one JSON line each.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const [scratch, baseRun, candRun, out] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const runs = (path) => new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((r) => [r.id, r]));
const base = runs(baseRun);
const cand = runs(candRun);
const db = (repo) => join(scratch, repo.attempt, "checkout", ".pymtheg", "rebuildable", "graph.sqlite");
const lines = [];
for (const [id, b] of base) {
  const c = cand.get(id);
  if (!c || !["ok", "incomplete"].includes(b.cold?.status) || !["ok", "incomplete"].includes(c.cold?.status)) {
    lines.push(JSON.stringify({ id, skipped: { base: b.outcome, candidate: c?.outcome } }));
    continue;
  }
  const result = execFileSync(
    process.execPath,
    ["--max-old-space-size=12000", join(here, "identity.mjs"), db(b), db(c), "34+typescript-=33+typescript-"],
    { maxBuffer: 1 << 28 },
  ).toString().trim();
  lines.push(JSON.stringify({ id, ...JSON.parse(result) }));
  console.error(id, "done");
}
writeFileSync(out, lines.join("\n") + "\n");
