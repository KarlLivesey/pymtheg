// resolved-rows.mjs SCRATCH RUN : per pin, stored `resolved` link rows and
// how many of them carry no recorded assumption (`data.assumes`). Also
// whether two runs' context rows differ only in C-20's dependency stamp,
// when a second RUN is given.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, run, other] = process.argv.slice(2);
const repos = (path) => JSON.parse(readFileSync(path, "utf8")).repos;
const open = (repo) =>
  new DatabaseSync(join(scratch, repo.attempt, "checkout", ".pymtheg", "rebuildable", "graph.sqlite"), { readOnly: true });
const others = other ? new Map(repos(other).map((r) => [r.id, r])) : new Map();
let total = 0;
let plain = 0;
for (const repo of repos(run)) {
  const db = open(repo);
  let resolved = 0;
  let withoutAssumption = 0;
  for (const { body } of db.prepare("SELECT body FROM graph_links WHERE resolution='resolved'").iterate()) {
    resolved++;
    if (!(JSON.parse(body).data?.assumes ?? []).length) withoutAssumption++;
  }
  total += resolved;
  plain += withoutAssumption;
  const row = { id: repo.id, resolved, withoutAssumption };
  const pair = others.get(repo.id);
  if (pair) {
    const contexts = (d) => new Map(d.prepare("SELECT path, body FROM graph_contexts").all().map((r) => [r.path, JSON.parse(r.body)]));
    const a = contexts(db);
    const b = contexts(open(pair));
    let differ = 0;
    let stampOnly = 0;
    for (const [path, x] of a) {
      const y = b.get(path);
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      differ++;
      const strip = (v) => ({ ...v, dependency: { ...(v?.dependency ?? {}), stamp: null } });
      if (JSON.stringify(strip(x)) === JSON.stringify(strip(y))) stampOnly++;
    }
    row.contextsDiffer = differ;
    row.contextsStampOnly = stampOnly;
  }
  console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ resolved: total, withoutAssumption: plain }));
