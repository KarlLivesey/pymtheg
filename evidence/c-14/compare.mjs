// SPDX-License-Identifier: MIT
// C-14 evidence: compares every Go link and symbol of two sweep runs (a build
// of main and this branch) site by site. A site is (file, kind, start, end,
// target name); a site may hold several stored rows (distinct `implements`
// links), each counted, and identified by its relation: the checkout target,
// the candidate set's members, or the library targets. Per repository: checkout-definite links kept, lost or
// retargeted; sites added or removed; symbols missing; library links by
// evidence kind; unresolved links with the library-member reason; and the
// sites main's coverage reconstruction credited at level 2 (a selector or
// qualified type through an explicitly named import, or an unnamed
// standard-library import, of a package outside the checkout) with their
// outcome now. Draws a fixed-seed sample of library links with a symbol
// from five repositories for hand-checking.
// Usage: node compare.mjs --base-scratch DIR --base run.json --candidate-scratch DIR
//   --candidate run.json [--sample 40] [--seed c-14] [--sample-repos a,b,...]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "base-scratch": { type: "string" },
    "candidate-scratch": { type: "string" },
    base: { type: "string" },
    candidate: { type: "string" },
    sample: { type: "string", default: "40" },
    seed: { type: "string", default: "c-14" },
    "sample-repos": { type: "string", default: "" },
  },
});
const runs = (scratch, path) =>
  new Map(
    JSON.parse(readFileSync(join(scratch, path), "utf8")).repos.map(
      (record) => [record.id, { ...record, scratch }],
    ),
  );
const base = runs(values["base-scratch"], values.base);
const candidate = runs(values["candidate-scratch"], values.candidate);
const sampleRepos = new Set(values["sample-repos"].split(",").filter(Boolean));
// The reconstruction's standard roots (scripts/sweep/coverage-rules.mjs).
const standardGo = new Set(
  "archive bufio bytes cmp compress container context crypto database debug embed encoding errors expvar flag fmt go hash html image index io iter log maps math mime net os path plugin reflect regexp runtime slices sort strconv strings sync syscall testing text time unicode unique unsafe weak".split(
    " ",
  ),
);

function load(record) {
  const db = new DatabaseSync(
    join(record.scratch, record.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const symbols = new Map();
  const keys = new Set();
  for (const row of db
    .prepare("SELECT id, file, kind, json_extract(body,'$.identity') AS identity, json_extract(body,'$.module') AS module FROM graph_symbols")
    .iterate()) {
    symbols.set(row.id, `${row.file}:${row.kind}:${row.identity}`);
    if (row.module === "go") keys.add(`${row.file}\u0000${row.kind}\u0000${row.identity}`);
  }
  const schema = db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()?.value;
  const library =
    schema === "4"
      ? db.prepare("SELECT ecosystem, unit, symbol, version, evidence FROM graph_library_targets WHERE link=? AND role='target'")
      : null;
  const candidates = db.prepare("SELECT symbol FROM graph_candidates WHERE link=? ORDER BY symbol");
  const libraryCandidates =
    schema === "4"
      ? db.prepare("SELECT unit, symbol FROM graph_library_targets WHERE link=? AND role='candidate' ORDER BY unit, symbol")
      : null;
  const links = new Map();
  const imports = new Map();
  let rows = 0;
  for (const row of db
    .prepare("SELECT id, file, kind, target, resolution, body FROM graph_links WHERE module='go'")
    .iterate()) {
    const body = JSON.parse(row.body);
    const key = `${row.file}\u0000${row.kind}\u0000${body.range.start}\u0000${body.range.end}\u0000${body.targetName}`;
    const link = {
      file: row.file,
      kind: row.kind,
      start: body.range.start,
      name: body.targetName,
      data: body.data ?? {},
      resolution: row.resolution,
      target: row.target ? symbols.get(row.target) : null,
      ...(row.resolution === "library" ? { library: library.get(row.id) } : {}),
    };
    const members =
      row.resolution === "ambiguous"
        ? [
            ...candidates.all(row.id).map((item) => symbols.get(item.symbol)),
            ...(libraryCandidates?.all(row.id) ?? []).map((item) => `lib:${item.unit}:${item.symbol}`),
          ]
        : [];
    link.relation = link.target
      ? `target:${link.target}`
      : link.library
        ? `library:${link.library.unit}:${link.library.symbol ?? ""}`
        : members.length
          ? `set:${members.join(",")}`
          : "none";
    rows++;
    const list = links.get(key) ?? [];
    list.push(link);
    links.set(key, list);
    if (row.kind === "imports") {
      const list = imports.get(row.file) ?? [];
      list.push(link);
      imports.set(row.file, list);
    }
  }
  db.close();
  return { links, keys, imports, rows };
}

/** What main's reconstruction credits at level 2: the qualifier's import path, or null. */
function reconstructed(link, imports) {
  if (link.resolution !== "unresolved" || link.data.cause) return null;
  let qualifier;
  let name;
  if (link.data.t?.q) {
    qualifier = link.data.t.q;
    name = link.data.t.n;
  } else {
    const expr = link.data.expr?.k === "inst" ? link.data.expr.x : link.data.expr;
    if (expr?.k !== "sel" || expr.x?.k !== "name") return null;
    qualifier = expr.x.n;
    name = expr.n;
  }
  if (!/^[A-Za-z_]\w*$/.test(name ?? "")) return null;
  const bound = new Map();
  for (const item of imports ?? []) {
    const path = item.data.path ?? item.name;
    const alias = item.data.alias ?? path.split("/").at(-1);
    if (!/^\w+$/.test(alias) || alias === "_" || (/^v\d+$/.test(alias) && !item.data.alias)) continue;
    bound.set(alias, bound.has(alias) && bound.get(alias).path !== path ? null : { path, item });
  }
  const binding = bound.get(qualifier);
  if (!binding || binding.item.resolution !== "unresolved") return null;
  const explicit = (imports ?? []).some((item) => item.data.alias === qualifier);
  return explicit || standardGo.has(binding.path.split("/")[0]) ? binding.path : null;
}

const lineOf = (record, file, offset) => {
  const text = readFileSync(join(record.scratch, record.attempt, "checkout", file), "utf8");
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, source: text.split("\n")[line - 1].trim() };
};

const out = { repos: [], totals: {}, changed: [], missingSymbols: [], withheld: {}, withheldExamples: [], sample: [] };
const add = (bucket, key, n = 1) => (bucket[key] = (bucket[key] ?? 0) + n);
const pool = [];
for (const [id, cand] of [...candidate].sort()) {
  const was = base.get(id);
  if (!was || was.outcome !== "finished" || cand.outcome !== "finished") continue;
  const before = load(was);
  const after = load(cand);
  const missingSymbols = [...before.keys].filter((key) => !after.keys.has(key));
  for (const key of missingSymbols.slice(0, 20)) {
    const [file, kind, identity] = key.split("\u0000");
    out.missingSymbols.push({ id, file, kind, identity });
  }
  const row = {
    id,
    linksBefore: 0,
    linksAfter: 0,
    sitesBefore: 0,
    sitesAfter: 0,
    librarySetsAfter: 0,
    definiteBefore: 0,
    definiteAfter: 0,
    libraryAfter: 0,
    librarySymbolAfter: 0,
    lost: 0,
    retargeted: 0,
    candidateSetChanged: 0,
    removedSites: 0,
    addedSites: 0,
    reconstructedBefore: 0,
    reconstructedKept: 0,
    reconstructedWithheld: 0,
    memberReason: 0,
    byEvidence: {},
    symbolsBefore: before.keys.size,
    symbolsMissing: missingSymbols.length,
  };
  row.linksBefore = before.rows;
  row.linksAfter = after.rows;
  row.sitesBefore = before.links.size;
  row.sitesAfter = after.links.size;
  for (const [key, news] of after.links) {
    const olds = before.links.get(key) ?? [];
    if (!before.links.has(key)) row.addedSites++;
    const remaining = news.map((link) => link.relation);
    for (const old of olds) {
      const index = remaining.indexOf(old.relation);
      if (index >= 0) {
        remaining.splice(index, 1);
        continue;
      }
      const now = news.find((link) => !olds.some((other) => other.relation === link.relation));
      if (old.target) {
        if (now?.target) row.retargeted++;
        else row.lost++;
        out.changed.push({ id, file: old.file, kind: old.kind, name: old.name, ...lineOf(cand, old.file, old.start), before: old.relation, after: now?.relation ?? "row removed" });
      } else if (old.resolution === "ambiguous") {
        row.candidateSetChanged++;
        out.changed.push({ id, file: old.file, kind: old.kind, name: old.name, ...lineOf(cand, old.file, old.start), before: old.relation, after: now?.relation ?? "row removed" });
      }
    }
    for (const link of news) {
      if (link.target) row.definiteAfter++;
      if (link.data.uncertainty === "library-member-unproven") row.memberReason++;
      if (link.resolution === "ambiguous" && link.relation.includes("lib:")) row.librarySetsAfter++;
      if (link.library) {
        row.libraryAfter++;
        if (link.library.symbol) row.librarySymbolAfter++;
        const group = link.library.evidence === "declared-builtin" ? "builtin" : link.library.evidence;
        add(row.byEvidence, `${group}:${link.library.ecosystem}`);
        if (link.library.symbol && (!sampleRepos.size || sampleRepos.has(id))) pool.push({ id, record: cand, link });
      }
    }
    for (const old of olds) {
      const path = reconstructed(old, before.imports.get(old.file));
      if (!path) continue;
      row.reconstructedBefore++;
      if (news.some((link) => link.target || link.library?.symbol)) row.reconstructedKept++;
      else {
        row.reconstructedWithheld++;
        const link = news[0];
        const reason = `${link.resolution}:${link.data.uncertainty ?? link.data.reason ?? link.data.open?.reason ?? "-"}:${path.split("/")[0].includes(".") ? "dependency" : "std"}`;
        add(out.withheld, reason);
        if (out.withheldExamples.length < 60)
          out.withheldExamples.push({ id, file: link.file, kind: link.kind, name: link.name, path, ...lineOf(cand, link.file, link.start), now: link.relation });
      }
    }
  }
  for (const [key, olds] of before.links) {
    for (const old of olds) if (old.target) row.definiteBefore++;
    if (!after.links.has(key)) {
      row.removedSites++;
      for (const old of olds)
        if (old.target) out.changed.push({ id, file: old.file, kind: old.kind, name: old.name, before: old.relation, after: "site removed" });
    }
  }
  out.repos.push(row);
  for (const [k, v] of Object.entries(row)) if (typeof v === "number") add(out.totals, k, v);
  for (const [k, v] of Object.entries(row.byEvidence)) add((out.totals.byEvidence ??= {}), k, v);
}
const hash = (item) =>
  createHash("sha256").update(`${values.seed}\u0000${item.id}\u0000${item.link.file}\u0000${item.link.start}\u0000${item.link.kind}`).digest("hex");
pool.sort((a, b) => (hash(a) < hash(b) ? -1 : 1));
out.poolSize = pool.length;
for (const item of pool.slice(0, Number(values.sample))) {
  const { line, source } = lineOf(item.record, item.link.file, item.link.start);
  out.sample.push({ repo: item.id, file: item.link.file, line, kind: item.link.kind, name: item.link.name, library: item.link.library, source });
}
console.log(JSON.stringify(out, null, 1));
