// SPDX-License-Identifier: MIT
// Run on the dev server against the completed release and candidate sweeps.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sampleKey } from "../../scripts/sweep/coverage-rules.mjs";

const scratch = process.env.PYM_SCRATCH;
const read = (name) => JSON.parse(readFileSync(join(scratch, name), "utf8"));
const previous = new Map(
  read("baseline-run.json").repos.map((repo) => [repo.id, repo]),
);
const current = read(process.argv[3] ?? "candidate-run.json").repos;
const seed = "c-3-review:b04f14fa";
const sample = new Map();
const changed = [];
const rechecked = [];
const missingIdentities = [];
const priorReview = readFileSync("evidence/c-3/changed-sites.md", "utf8")
  .split("\n")
  .flatMap((row) => {
    const match = /^\| (\S+) \| `(.+):(\d+)` \| ([a-z-]+) \| `([^`]+)` \|/.exec(row);
    return match ? [{
      repo: match[1], file: match[2], line: Number(match[3]), kind: match[4], before: match[5],
    }] : [];
  });
const reviewByFile = Map.groupBy(priorReview, ({repo,file}) => repo + "\0" + file);

const select = (db) =>
  db.prepare(`
  SELECT l.body, l.resolution, s.body AS target FROM graph_links l INDEXED BY graph_link_file
  LEFT JOIN graph_symbols s ON s.id=l.target
  WHERE l.file=? AND l.module='typescript'`);
const open = (repo) =>
  new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
const parse = (row) => ({
  ...JSON.parse(row.body),
  resolution: row.resolution,
  target: row.target ? JSON.parse(row.target) : undefined,
});
const targetKey = (target) =>
  target &&
  [target.file, target.kind, target.identity, target.ordinal].join("\0");
const symbolsFor = (db) => db.prepare(`
  SELECT json_extract(body,'$.identity') AS identity, kind,
    json_extract(body,'$.ordinal') AS ordinal
  FROM graph_symbols WHERE file=? AND json_extract(body,'$.module')='typescript'`);
const verified = (link) =>
  link?.resolution === "resolved" && !link.data?.assumes?.length;
const label = (target) =>
  target &&
  `${target.file}#${target.identity}` +
    (target.ordinal ? ` (ordinal ${target.ordinal})` : "");
const count = (db) => ({
  symbols: db
    .prepare(
      "SELECT count(*) AS n FROM graph_symbols WHERE json_extract(body,'$.module')='typescript'",
    )
    .get().n,
  lexical: db
    .prepare("SELECT count(*) AS n FROM graph_symbols WHERE kind='lexical'")
    .get().n,
  scoped: db.prepare(
    "SELECT count(*) AS n FROM graph_symbols WHERE json_extract(body,'$.data.scoped')=1",
  ).get().n,
  scopedKinds: Object.fromEntries(db.prepare(`
    SELECT kind,count(*) AS n FROM graph_symbols
    WHERE json_extract(body,'$.data.scoped')=1 GROUP BY kind
  `).all().map(({ kind, n }) => [kind, n])),
  scopedLinks: Object.fromEntries(db.prepare(`
    SELECT l.kind,count(*) AS n FROM graph_links l JOIN graph_symbols s ON l.target=s.id
    WHERE json_extract(s.body,'$.data.scoped')=1 GROUP BY l.kind
  `).all().map(({kind,n}) => [kind,n])),
  links: db
    .prepare("SELECT count(*) AS n FROM graph_links WHERE module='typescript'")
    .get().n,
});
const location = (source, offset) => {
  const start = offset === 0 ? 0 : source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  return {
    line: source.slice(0, start).split("\n").length,
    code: source
      .slice(start, end === -1 ? undefined : end)
      .trim()
      .slice(0, 200),
  };
};

const runs = [];
for (const repo of current) {
  const before = previous.get(repo.id);
  if (!before || before.outcome !== "finished" || repo.outcome !== "finished")
    continue;
  const oldDb = open(before);
  const newDb = open(repo);
  try {
    const oldLinks = select(oldDb);
    const newLinks = select(newDb);
    const oldSymbols = symbolsFor(oldDb);
    const newSymbols = symbolsFor(newDb);
    const texts = newDb.prepare(
      "SELECT json_extract(body,'$.text') AS text FROM graph_files WHERE path=?",
    );
    const candidatesFor = newDb.prepare(`
      SELECT s.body FROM graph_candidates c JOIN graph_symbols s ON s.id=c.symbol
      WHERE c.link=? ORDER BY s.file,s.kind,s.id`);
    const oldSources = oldDb.prepare(
      "SELECT path FROM graph_files WHERE json_extract(body,'$.module')='typescript'",
    );
    const newSources = newDb.prepare(
      "SELECT path FROM graph_files WHERE json_extract(body,'$.module')='typescript'",
    );
    const files = new Set(
      [...oldSources.all(), ...newSources.all()].map(({ path }) => path),
    );
    const run = {
      repo: repo.id,
      before: count(oldDb),
      after: count(newDb),
      newlyDefinite: {},
      plainLocalReferences: 0,
      plainLocalReferenceMismatches: [],
      buildOutput: 0,
      workspaceEntry: 0,
      baselineCold: before.cold,
      candidateCold: repo.cold,
    };
    runs.push(run);
    for (const file of files) {
      const newKeys = new Set(newSymbols.all(file).map((row) => targetKey({ file, ...row })));
      for (const row of oldSymbols.all(file)) {
        if (!newKeys.has(targetKey({ file, ...row })))
          missingIdentities.push({ repo: repo.id, file, ...row });
      }
      const original = Map.groupBy(oldLinks.all(file).map(parse), (link) =>
        sampleKey(repo, link),
      );
      const updated = Map.groupBy(newLinks.all(file).map(parse), (link) =>
        sampleKey(repo, link),
      );
      const source = texts.get(file)?.text ?? "";
      const reviewedHere = reviewByFile.get(repo.id + "\0" + file);
      for (const [key, links] of updated) {
        const old = original.get(key) ?? [];
        for (const link of links) {
          if (link.data?.localBinding && link.resolution === "resolved") {
            run.plainLocalReferences++;
            if (!old.some((prior) => prior.resolution === "unresolved" &&
              prior.kind === "references" && prior.data?.reason === "local"))
              run.plainLocalReferenceMismatches.push({ file, ...location(source, link.range.start) });
          }
          const reason = link.data?.reasonWithoutConfig ?? link.data?.reason;
          if (reason === "workspace-build-output-missing") run.buildOutput++;
          if (reason === "workspace-entry-unavailable") run.workspaceEntry++;
          if (
            !verified(link) ||
            old.some((prior) => prior.resolution === "resolved") ||
            link.kind === "contains"
          )
            continue;
          let group = "other";
          if (link.data?.localBinding) group = "plain-reference";
          else if (!old.length && link.kind === "references") group = "scoped-reference";
          else if (link.kind === "calls" && link.target.file === file) group = "local-call";
          else if (old.some((prior) => prior.data?.reason === "external-package")) group = "workspace";
          run.newlyDefinite[group] = (run.newlyDefinite[group] ?? 0) + 1;
          const rank = createHash("sha256")
            .update(seed + key)
            .digest("hex");
          const entries = sample.get(group) ?? [];
          if (entries.length < 20 || rank < entries.at(-1).rank) {
            entries.push({
              rank,
              repo: repo.id,
              file,
              ...location(source, link.range.start),
              kind: link.kind,
              name: link.targetName,
              from: old[0]?.data?.reason ?? null,
              target: label(link.target),
              ...(link.data?.localBinding ? { binding: link.data.localBinding } : {}),
              declaration: location(
                texts.get(link.target.file).text,
                link.data?.localBinding?.start ?? link.target.range.start,
              ),
            });
            entries.sort((a, b) => a.rank.localeCompare(b.rank));
            if (entries.length > 20) entries.pop();
            sample.set(group, entries);
          }
        }
      }
      for (const [key, links] of original) {
        const next = updated.get(key) ?? [];
        for (const link of links) {
          if (link.resolution !== "resolved") continue;
          const equivalent = next.find(
            (item) => targetKey(item.target) === targetKey(link.target),
          );
          const restored =
            equivalent?.resolution === "resolved" &&
            (!verified(link) || verified(equivalent));
          const before = label(link.target);
          const reviewed = reviewedHere?.find((row) =>
            row.kind === link.kind && row.before === before &&
            row.line === location(source, link.range.start).line,
          );
          if (restored && !reviewed) continue;
          const row = {
            repo: repo.id,
            file,
            ...location(source, link.range.start),
            kind: link.kind,
            before,
            beforeKind: link.target?.kind,
            after: next.map((item) => ({
              target: label(item.target),
              resolution: item.resolution,
              reason: item.data?.reason,
              assumptions: item.data?.assumes,
              candidates: candidatesFor.all(item.id).map(({ body }) =>
                label(JSON.parse(body)),
              ),
            })),
          };
          if (reviewed) rechecked.push({ ...row, restored });
          if (!restored) changed.push(row);
        }
      }
    }
  } finally {
    oldDb.close();
    newDb.close();
  }
}
const quotas = { "local-call": 8, workspace: 5, "scoped-reference": 5, "plain-reference": 2 };
const chosen = Object.entries(quotas).flatMap(([group, quota]) =>
  (sample.get(group) ?? []).slice(0, quota),
);
if (chosen.length < 20) {
  const rest = [...sample.values()]
    .flat()
    .filter((entry) => !chosen.includes(entry))
    .sort((a, b) => a.rank.localeCompare(b.rank));
  chosen.push(...rest.slice(0, 20 - chosen.length));
}
const report =
  JSON.stringify({ seed, runs, changed, rechecked, priorReview: priorReview.length, missingIdentities, sample: chosen }, null, 2) + "\n";
const output = process.argv[2];
if (output) writeFileSync(join(scratch, output), report);
else process.stdout.write(report);
