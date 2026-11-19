// SPDX-License-Identifier: MIT
// Read completed pinned sweep attempts. Run on the dev server with PYM_SCRATCH.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const scratch = process.env.PYM_SCRATCH;
const seed = "c9-rust-library-paths-2026-11-18";
const auditRepos = new Set([
  "BurntSushi/ripgrep",
  "RustCrypto/hashes",
  "cberner/redb",
  "crossbeam-rs/crossbeam",
  "fjall-rs/fjall",
  "rust-embedded/cortex-m",
]);
const read = (name) => JSON.parse(readFileSync(join(scratch, name), "utf8"));
const main = new Map(
  read("main-run.json").repos.map((repo) => [repo.id, repo]),
);
const candidate = read("candidate-run.json").repos;
const root = (repo) => join(scratch, repo.attempt, "checkout");
const open = (repo) =>
  new DatabaseSync(join(root(repo), ".pymtheg/rebuildable/graph.sqlite"), {
    readOnly: true,
  });
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function symbolKeys(db) {
  return db
    .prepare("SELECT file,kind,body FROM graph_symbols ORDER BY file,kind")
    .iterate();
}
const key = ({ file, kind, body }) => {
  const { module, key, ordinal, identity } = JSON.parse(body);
  return JSON.stringify([module, file, kind, identity, ordinal, key]);
};
function resolved(db) {
  return db
    .prepare(
      `SELECT l.file,l.kind,l.origin,l.body,s.file AS targetFile,s.kind AS targetKind,s.body AS targetBody
    FROM graph_links l JOIN graph_symbols s ON s.id=l.target WHERE l.module='rust' AND l.resolution='resolved'`,
    )
    .iterate();
}
function linkKey(row) {
  const { range, targetName, sourceKey } = JSON.parse(row.body);
  return JSON.stringify([
    row.file,
    row.kind,
    row.origin,
    range.start,
    range.end,
    targetName,
    sourceKey,
  ]);
}
const targetKey = ({ targetFile, targetKind, targetBody }) =>
  key({ file: targetFile, kind: targetKind, body: targetBody });

function receivers(db) {
  const targets = db.prepare(
    "SELECT file,kind,body FROM graph_symbols WHERE id = ?",
  );
  const candidates =
    db.prepare(`SELECT s.file,s.kind,s.body FROM graph_candidates c
    JOIN graph_symbols s ON s.id=c.symbol WHERE c.link=?`);
  const sites =
    db.prepare(`SELECT id,file,kind,origin,body,target,resolution FROM graph_links
    WHERE module='rust' AND kind='calls' AND json_extract(body,'$.data.method') != ''`);
  const result = new Map();
  for (const row of sites.iterate()) {
    const site = linkKey(row);
    const decisions = result.get(site) ?? [];
    decisions.push(
      JSON.stringify([
        row.resolution,
        row.target ? key(targets.get(row.target)) : null,
        candidates.all(row.id).map(key).sort(),
        JSON.parse(row.body).data.open ?? null,
      ]),
    );
    result.set(site, decisions);
  }
  for (const decisions of result.values()) decisions.sort();
  return result;
}

function preservation(base, next) {
  const keys = new Set(Array.from(symbolKeys(next), key));
  const lostKeys = [];
  let symbols = 0;
  for (const row of symbolKeys(base)) {
    const identity = key(row);
    symbols++;
    if (!keys.delete(identity)) lostKeys.push(JSON.parse(identity));
  }
  const nextTargets = new Map();
  for (const row of resolved(next)) {
    const identity = linkKey(row);
    const targets = nextTargets.get(identity) ?? [];
    targets.push(targetKey(row));
    nextTargets.set(identity, targets);
  }
  const changed = [];
  let definite = 0;
  for (const row of resolved(base)) {
    const site = linkKey(row);
    const targets = nextTargets.get(site) ?? [];
    const from = targetKey(row);
    const index = targets.indexOf(from);
    definite++;
    if (index < 0)
      changed.push({
        site: JSON.parse(site),
        from: JSON.parse(from),
        to: targets.map((target) => JSON.parse(target)),
      });
    else targets.splice(index, 1);
  }
  const beforeReceivers = receivers(base);
  const afterReceivers = receivers(next);
  const changedReceivers = [];
  for (const site of new Set([
    ...beforeReceivers.keys(),
    ...afterReceivers.keys(),
  ])) {
    const previous = beforeReceivers.get(site) ?? [];
    const current = afterReceivers.get(site) ?? [];
    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      changedReceivers.push({ site: JSON.parse(site), previous, current });
    }
  }
  return {
    symbols,
    lostKeys,
    addedSymbols: keys.size,
    definite,
    changed,
    receivers: [...beforeReceivers.values()].reduce(
      (total, decisions) => total + decisions.length,
      0,
    ),
    changedReceivers,
  };
}

function draw(repo, db) {
  const sample = [];
  const seen = new Set();
  const rows =
    db.prepare(`SELECT l.file,l.kind,l.body,t.ecosystem,t.unit,t.symbol,t.version,t.evidence FROM graph_links l
    JOIN graph_library_targets t ON t.link=l.id WHERE l.module='rust' AND l.resolution='library' AND t.symbol IS NOT NULL`);
  for (const row of rows.iterate()) {
    const { range, targetName } = JSON.parse(row.body);
    const identity = [
      repo.id,
      row.file,
      range.start,
      range.end,
      row.unit,
      row.symbol,
    ];
    const site = JSON.stringify(identity);
    if (seen.has(site)) continue;
    seen.add(site);
    sample.push({
      ...row,
      body: undefined,
      range,
      targetName,
      rank: sha([seed, ...identity]),
    });
  }
  return sample
    .sort((a, b) => compare(a.rank, b.rank))
    .slice(0, 5)
    .map((item) => {
      const source = readFileSync(join(root(repo), item.file), "utf8");
      const lines = source.slice(0, item.range.start).split("\n");
      const end = source.indexOf("\n", item.range.start);
      return {
        ...item,
        repo: repo.id,
        pin: repo.commit,
        line: lines.length,
        source: (
          lines.at(-1) +
          source.slice(item.range.start, end < 0 ? source.length : end)
        ).trim(),
      };
    });
}

const comparisons = [];
const sample = [];
for (const repo of candidate) {
  const previous = main.get(repo.id);
  if (repo.outcome !== "finished") continue;
  const next = open(repo);
  try {
    if (previous?.outcome === "finished") {
      if (repo.commit !== previous.commit)
        throw Error(`Different pins for ${repo.id}`);
      const base = open(previous);
      try {
        comparisons.push({ repo: repo.id, ...preservation(base, next) });
      } finally {
        base.close();
      }
    }
    if (auditRepos.has(repo.id)) sample.push(...draw(repo, next));
  } finally {
    next.close();
  }
}
console.log(
  JSON.stringify(
    {
      seed,
      comparisons,
      sample: sample.sort((a, b) => compare(a.rank, b.rank)),
    },
    null,
    2,
  ),
);
