// SPDX-License-Identifier: MIT
// C-43: where the links source-only leaves open go, one pin. The route's own
// cached rust-analyzer index is joined again with the product join
// (explain mode: each link's outcome), and each open link is put in the
// first bucket that applies:
//   no answer      no occurrence of a single symbol at the link's own name site
//                  (file not indexed, no name site, no occurrence, several symbols,
//                  a link kind the join does not take)
//   gate           kind/namespace (wrong kind; a `use` answered with a module),
//                  known error classes (extern crate or crate root, a symbol
//                  defined twice, a proc-macro crate's non-macro item), trait-method
//                  declaration, cfg condition other than test on the link, the
//                  cfg-variant guard, a source-only library target kept, an answer
//                  outside the source-only candidate set
//   no identity    the answer names something the store cannot name: a library
//                  item (identity by written path only, D20), a generated item
//                  (no declaration site in the checkout), a declaration with no
//                  graph symbol (struct fields and the like), a local binding
//   credited       the route made it definite
// Library answers are also counted as they would fare under the cfg-link gate.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const beyondTest = (gates) => (gates ?? []).some((g) => g !== "test");

/** Bucket name for a join outcome, before the analysis gates. */
export function joinBucket(why) {
  if (why === undefined) return "no answer: file not joined (failed parse)";
  if (why === "answer") return null;
  if (why === "filter:kind-incompatible" || why === "filter:import-names-module") return "gate: kind/namespace";
  if (why === "filter:extern-crate" || why === "filter:collision" || why === "filter:proc-macro-crate-item") return "gate: known error classes";
  if (why === "none:trait-declaration") return "gate: trait-method declaration";
  if (why === "unapplied:library") return "no identity: library item";
  if (why === "unapplied:generated") return "no identity: generated item";
  if (why === "none:no-graph-symbol") return "no identity: declaration without a graph symbol";
  if (why === "none:local") return "no identity: local binding";
  return `no answer: ${why.replace(/^none:/, "")}`;
}

/**
 * @param load     imports a dist module
 * @param offPath  the source-only store; onPath the route's store (same project id)
 */
export async function funnel(load, offPath, onPath, projectId, scipPath, facts) {
  const { readScip } = await load("graph/languages/rust/scip.js");
  const { joinScip } = await load("graph/languages/rust/toolchain-join.js");
  const { fileFacts } = await load("graph/identity.js");
  const { SqliteGraphStore } = await load("graph/index.js");
  const off = new SqliteGraphStore(offPath, projectId, { readOnly: true });
  let files;
  try {
    files = off.files().filter((f) => f.module === "rust" && f.path.endsWith(".rs") && f.result.status !== "failed");
  } finally {
    off.close();
  }
  const facts2 = files.map((f) => ({ f, facts: fileFacts(projectId, f) }));
  const joined = joinScip(
    readScip(readFileSync(scipPath)),
    facts2.map(({ f, facts }) => ({ path: f.path, text: f.text, result: f.result, symbolIds: facts.symbols.map((s) => s.id) })),
    facts,
    true,
  );
  const read = (path) => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const links = new Map();
      for (const row of db.prepare("SELECT id, resolution, target, body FROM graph_links WHERE module='rust'").iterate()) {
        const body = JSON.parse(row.body);
        links.set(row.id, { resolution: row.resolution, target: row.target, data: body.data ?? {} });
      }
      const candidates = new Map();
      for (const row of db.prepare("SELECT c.link, c.symbol FROM graph_candidates c JOIN graph_links g ON g.id=c.link WHERE g.module='rust'").iterate()) {
        if (!candidates.has(row.link)) candidates.set(row.link, []);
        candidates.get(row.link).push(row.symbol);
      }
      const symbols = new Map();
      for (const row of db.prepare("SELECT id, kind, body FROM graph_symbols WHERE json_extract(body,'$.module')='rust'").iterate()) {
        const body = JSON.parse(row.body);
        symbols.set(row.id, { key: `${row.kind}\0${body.identity}`, gated: beyondTest(body.data?.conditions) });
      }
      return { links, candidates, symbols };
    } finally {
      db.close();
    }
  };
  const before = read(offPath);
  const after = read(onPath);
  const gatedIdentities = new Set([...before.symbols.values()].filter((s) => s.gated).map((s) => s.key));
  const variant = (id) => {
    const s = before.symbols.get(id);
    return !s || s.gated || gatedIdentities.has(s.key);
  };
  const level2 = (link, library) => link.resolution === "resolved" || library;
  // Library targets with a symbol (Level 2 libraries) from the off store.
  const db = new DatabaseSync(offPath, { readOnly: true });
  const libraryL2 = new Set();
  try {
    for (const row of db.prepare("SELECT link FROM graph_library_targets WHERE role='target' AND symbol IS NOT NULL").iterate()) libraryL2.add(row.link);
  } finally {
    db.close();
  }
  const buckets = {};
  const add = (k) => (buckets[k] = (buckets[k] ?? 0) + 1);
  let open = 0;
  let libraryPassingCfg = 0;
  for (const { f, facts } of facts2) {
    const reasons = joined.reasons?.get(f.path) ?? [];
    const answers = joined.answers.get(f.path);
    facts.links.forEach((parsed, index) => {
      const link = before.links.get(parsed.id);
      if (!link || level2(link, libraryL2.has(parsed.id))) return;
      open++;
      const why = reasons[index];
      const bucket = joinBucket(why);
      if (bucket) {
        add(bucket);
        if (why === "unapplied:library" && !beyondTest(link.data.conditions)) libraryPassingCfg++;
        return;
      }
      const now = after.links.get(parsed.id);
      if (now?.data?.toolchain?.origin === "toolchain" && now.data.toolchain.from !== "definite") return add("credited");
      const target = answers?.get(index);
      if (beyondTest(link.data.conditions)) return add("gate: cfg condition other than test");
      if (variant(target)) return add("gate: cfg-variant guard");
      if (link.resolution === "library") return add("gate: source-only library target kept");
      if (link.resolution === "ambiguous" && !(before.candidates.get(parsed.id) ?? []).includes(target)) return add("gate: answer outside the candidate set");
      add("other");
    });
  }
  // Links in files the join never saw (failed parses) are open too.
  return { open, buckets, libraryPassingCfg };
}

/** C-19's own figures for the pin (evidence/c-19/joins). */
export function c19(name) {
  try {
    const r = JSON.parse(gunzipSync(readFileSync(new URL(`../c-19/joins/${name}.join.json.gz`, import.meta.url))));
    return { links: r.links, level2: r.level2.links, gainCheckout: r.strict.gainCheckout, gainLibrary: r.strict.gainLibrary,
      gatedPercent: r.strict.gated, gatedLinks: r.strict.gatedLinks, percentCheckoutOnly: r.strict.percentCheckoutOnly,
      trait: r.strict.gainTraitDeclaration, underCfg: r.strict.gainUnderNonTestCfg, generated: r.strict.generatedNotCredited };
  } catch {
    return null;
  }
}
