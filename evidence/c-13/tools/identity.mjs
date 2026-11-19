// SPDX-License-Identifier: MIT
// identity.mjs BASE_DB CAND_DB [FROM=TO ...] : compares every stored row of
// two graph stores of the same checkout. Rows: files, parse-failure markers,
// contexts, symbols, links, candidates and library targets. Project-derived
// IDs (symbol and link IDs differ between stores) are replaced by stable
// keys: a symbol by [module, file, kind, identity, ordinal], a link by
// [module, file, kind, range, targetName, n]. Each FROM=TO replaces a string
// in the candidate's rows (the module version) before comparing. Prints one
// JSON line: per table, rows on each side and rows that differ.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const [baseDb, candDb, ...replacements] = process.argv.slice(2);
const pairs = replacements.map((r) => r.split("="));

function rows(path, replace) {
  const db = new DatabaseSync(path, { readOnly: true });
  const fix = (text) => {
    let out = text;
    if (replace) for (const [from, to] of pairs) out = out.split(from).join(to);
    return out;
  };
  const ids = new Map();
  const symbolBodies = [];
  for (const { body } of db.prepare("SELECT body FROM graph_symbols").iterate()) {
    const s = JSON.parse(fix(body));
    ids.set(s.id, `S:${JSON.stringify([s.module, s.file, s.kind, s.identity, s.ordinal])}`);
    symbolBodies.push(s);
  }
  const linkBodies = [];
  const sites = new Set();
  for (const { body } of db.prepare("SELECT body FROM graph_links").iterate()) {
    const l = JSON.parse(fix(body));
    let site = `L:${JSON.stringify([l.module, l.file, l.kind, l.range.start, l.range.end, l.targetName])}`;
    while (sites.has(site)) site += "+";
    sites.add(site);
    ids.set(l.id, site);
    linkBodies.push(l);
  }
  const keyed = (value) =>
    JSON.stringify(value, (_, v) => (typeof v === "string" && ids.has(v) ? ids.get(v) : v));
  const tables = {};
  const put = (table, key, value) => {
    (tables[table] ??= new Map()).set(key, value);
  };
  for (const { path, status, body } of db.prepare("SELECT path, status, body FROM graph_files").iterate())
    put("files", path, keyed([status, JSON.parse(fix(body))]));
  for (const row of db.prepare("SELECT path, hash, module, version FROM graph_parse_failures").iterate())
    put("parseFailures", row.path, fix(JSON.stringify(row)));
  for (const { path, body } of db.prepare("SELECT path, body FROM graph_contexts").iterate())
    put("contexts", path, fix(body));
  for (const s of symbolBodies) put("symbols", ids.get(s.id), keyed(s));
  for (const l of linkBodies) put("links", ids.get(l.id), keyed(l));
  const candidates = new Map();
  for (const { link, symbol, kind } of db.prepare("SELECT link, symbol, kind FROM graph_candidates").iterate()) {
    const key = ids.get(link) ?? link;
    (candidates.get(key) ?? candidates.set(key, []).get(key)).push(`${ids.get(symbol) ?? symbol}|${kind}`);
  }
  for (const [key, list] of candidates) put("candidates", key, JSON.stringify(list.sort()));
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='graph_library_targets'").get()) {
    const libraries = new Map();
    for (const r of db.prepare("SELECT * FROM graph_library_targets").iterate()) {
      const key = ids.get(r.link) ?? r.link;
      const { link, ...rest } = r;
      (libraries.get(key) ?? libraries.set(key, []).get(key)).push(fix(keyed(rest)));
    }
    for (const [key, list] of libraries) put("libraryTargets", key, JSON.stringify(list.sort()));
  }
  db.close();
  return tables;
}
const before = rows(baseDb, false);
const after = rows(candDb, true);
const report = {};
const examples = [];
for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
  const b = before[table] ?? new Map();
  const a = after[table] ?? new Map();
  let differ = 0;
  const digest = (map) => {
    const h = createHash("sha256");
    for (const key of [...map.keys()].sort()) h.update(key + "\t" + map.get(key) + "\n");
    return h.digest("hex").slice(0, 16);
  };
  for (const key of new Set([...b.keys(), ...a.keys()]))
    if (b.get(key) !== a.get(key)) {
      differ++;
      if (examples.length < 5) examples.push({ table, key, before: b.get(key)?.slice(0, 400), after: a.get(key)?.slice(0, 400) });
    }
  report[table] = { before: b.size, after: a.size, differ, digestBefore: digest(b), digestAfter: digest(a) };
}
console.log(JSON.stringify({ report, examples }));
