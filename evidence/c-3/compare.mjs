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
const seed = "c-3:6a32d988";
const sample = new Map();
const changed = [];

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
      buildOutput: 0,
      workspaceEntry: 0,
      baselineCold: before.cold,
      candidateCold: repo.cold,
    };
    runs.push(run);
    for (const file of files) {
      const original = Map.groupBy(oldLinks.all(file).map(parse), (link) =>
        sampleKey(repo, link),
      );
      const updated = Map.groupBy(newLinks.all(file).map(parse), (link) =>
        sampleKey(repo, link),
      );
      const source = texts.get(file)?.text ?? "";
      for (const [key, links] of updated) {
        const old = original.get(key) ?? [];
        for (const link of links) {
          const reason = link.data?.reasonWithoutConfig ?? link.data?.reason;
          if (reason === "workspace-build-output-missing") run.buildOutput++;
          if (reason === "workspace-entry-unavailable") run.workspaceEntry++;
          if (
            !verified(link) ||
            old.some((prior) => prior.resolution === "resolved") ||
            link.kind === "contains"
          )
            continue;
          const group =
            !old.length && link.kind === "references"
              ? "lexical-reference"
              : link.kind === "calls" && link.target.file === file
                ? "local-call"
                : old.some((prior) => prior.data?.reason === "external-package")
                  ? "workspace"
                  : "other";
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
              declaration: location(
                texts.get(link.target.file).text,
                link.target.range.start,
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
          if (
            equivalent?.resolution === "resolved" &&
            (!verified(link) || verified(equivalent))
          )
            continue;
          changed.push({
            repo: repo.id,
            file,
            ...location(source, link.range.start),
            kind: link.kind,
            before: label(link.target),
            after: next.map((item) => ({
              target: label(item.target),
              resolution: item.resolution,
              reason: item.data?.reason,
              assumptions: item.data?.assumes,
              candidates: candidatesFor.all(item.id).map(({ body }) =>
                label(JSON.parse(body)),
              ),
            })),
          });
        }
      }
    }
  } finally {
    oldDb.close();
    newDb.close();
  }
}
const quotas = { "local-call": 10, workspace: 5, "lexical-reference": 5 };
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
  JSON.stringify({ seed, runs, changed, sample: chosen }, null, 2) + "\n";
const output = process.argv[2];
if (output) writeFileSync(join(scratch, output), report);
else process.stdout.write(report);
