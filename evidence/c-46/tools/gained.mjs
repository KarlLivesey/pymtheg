// SPDX-License-Identifier: MIT
// C-46 gained.mjs BEFORE_SCRATCH BEFORE.json AFTER_SCRATCH AFTER.json OUT.json [SAMPLE]
// The TypeScript links that rest on a C-46 convention after (an assumption
// `ts-unbuilt-entry-is-{bundler-entry,src-twin,rollup-entry,wrapped-compiler-emit}`), with their
// outcome before at the same site (module, file, kind, range, target name):
// counts per convention, per package (the entry's manifest), per outcome
// before and after, and the lowest-hash SAMPLE newly Level 2 sites (seed
// "c46-audit") with the source line, the target and the entry.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [beforeScratch, beforePath, afterScratch, afterPath, out, sample = "0"] =
  process.argv.slice(2);
const CONVENTIONS = {
  "ts-unbuilt-entry-is-bundler-entry": "bundler-entry",
  "ts-unbuilt-entry-is-src-twin": "src-twin",
  "ts-unbuilt-entry-is-rollup-entry": "rollup-entry",
  "ts-unbuilt-entry-is-wrapped-compiler-emit": "wrapped-compiler-emit",
};
const runs = (path) =>
  new Map(JSON.parse(readFileSync(path, "utf8")).repos.map((r) => [r.id, r]));
const before = runs(beforePath);
const after = runs(afterPath);
const open = (scratch, repo) =>
  new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
const site = (l) =>
  [l.module, l.file, l.kind, l.range.start, l.range.end, l.targetName].join(
    "|",
  );
const hash = (s) =>
  createHash("sha256")
    .update("c46-audit|" + s)
    .digest("hex");
const totals = { byConvention: {}, byOutcome: {}, byPackage: {} };
const add = (map, key, n = 1) => (map[key] = (map[key] ?? 0) + n);
const candidates = [];
for (const [id, repo] of after) {
  const prior = before.get(id);
  if (repo.outcome !== "finished" || prior?.outcome !== "finished") continue;
  const b = open(beforeScratch, prior);
  const was = new Map();
  for (const { resolution, body } of b
    .prepare(
      "SELECT resolution, body FROM graph_links WHERE module='typescript'",
    )
    .iterate()) {
    const l = JSON.parse(body);
    was.set(site(l), `${resolution}:${l.data?.reason ?? ""}`);
  }
  b.close();
  const a = open(afterScratch, repo);
  const symbols = new Map();
  for (const { id: sid, file, body } of a
    .prepare("SELECT id, file, body FROM graph_symbols")
    .iterate())
    symbols.set(sid, `${file}#${JSON.parse(body).identity}`);
  const checkout = join(afterScratch, repo.attempt, "checkout");
  for (const { resolution, target, body } of a
    .prepare(
      "SELECT resolution, target, body FROM graph_links WHERE module='typescript' AND body LIKE '%ts-unbuilt-entry-is-%'",
    )
    .iterate()) {
    const l = JSON.parse(body);
    const convention = (l.data?.assumes ?? [])
      .map((n) => CONVENTIONS[n])
      .find(Boolean);
    if (!convention) continue;
    const previous = was.get(site(l)) ?? "(no site before)";
    const now = resolution;
    const entry = l.data?.unbuiltEntry ?? {};
    add(
      totals.byConvention,
      `${convention} ${previous.split(":")[0]} → ${now}`,
    );
    add(totals.byOutcome, `${previous} → ${now}`);
    add(totals.byPackage, `${id} ${entry.build ?? "?"} (${convention})`);
    if (!previous.startsWith("resolved") && now === "resolved")
      candidates.push({
        repo: id,
        checkout,
        file: l.file,
        start: l.range.start,
        kind: l.kind,
        targetName: l.targetName,
        convention,
        before: previous,
        target: symbols.get(target) ?? null,
        entry,
        rank: hash(`${id}|${site(l)}`),
      });
  }
  a.close();
}
const picked = candidates
  .sort((x, y) => (x.rank < y.rank ? -1 : 1))
  .slice(0, Number(sample))
  .map(({ checkout, rank, start, ...rest }) => {
    const text = readFileSync(join(checkout, rest.file), "utf8");
    const from = text.lastIndexOf("\n", start - 1) + 1;
    const to = text.indexOf("\n", start);
    return {
      ...rest,
      line: text.slice(0, start).split("\n").length,
      code: text
        .slice(from, to < 0 ? undefined : to)
        .trim()
        .slice(0, 200),
    };
  });
const sort = (o) =>
  Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1]));
const result = {
  newlyLevel2: candidates.length,
  byConvention: sort(totals.byConvention),
  byOutcome: sort(totals.byOutcome),
  byPackage: sort(totals.byPackage),
  sample: picked,
};
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
console.log("newly resolved", candidates.length);
for (const [k, n] of Object.entries(result.byConvention)) console.log(n, k);
for (const [k, n] of Object.entries(result.byPackage).slice(0, 25))
  console.log(" ", n, k);
