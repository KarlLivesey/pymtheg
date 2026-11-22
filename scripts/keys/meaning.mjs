// SPDX-License-Identifier: MIT
// C-49: stored graph rows with every symbol key replaced by the symbol's id
// (which hashes kind, identity and ordinal, never a key), so two stores can
// be compared for meaning rather than for key spelling. Used to show that a
// change of key form changes no stored fact, and, in an edit replay, which
// rewritten rows changed only their keys.
//   node scripts/keys/meaning.mjs <a.sqlite> <b.sqlite>     (compare meaning)
//   node scripts/keys/meaning.mjs --forms <graph.sqlite>    (key form counts)
import { DatabaseSync } from "node:sqlite";
import { storeRows } from "../reindex/dump.mjs";

/** (file, key) → symbol id, from the stored symbols. */
function symbolIds(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const ids = new Map();
    for (const row of db.prepare("SELECT body FROM graph_symbols").all()) {
      const symbol = JSON.parse(row.body);
      ids.set(`${symbol.file}\0${symbol.key}`, symbol.id);
    }
    return ids;
  } finally {
    db.close();
  }
}

/** Every key in a stored value replaced by its symbol's id. */
function normalize(value, file, ids) {
  if (Array.isArray(value))
    return value.map((item) => normalize(item, file, ids));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [name, item] of Object.entries(value)) {
    if (name === "key" && typeof item === "string") {
      const owner = typeof value.file === "string" ? value.file : file;
      const id = ids.get(`${owner}\0${item}`);
      out[name] = id ? `=${id}` : item;
    } else if (name === "sourceKey" && typeof item === "string") {
      const id = ids.get(`${file}\0${item}`);
      out[name] = id ? `=${id}` : item;
    } else out[name] = normalize(item, file, ids);
  }
  // A link's targets are a set, stored sorted by file and key: a new key
  // spelling may store the same set in another order.
  if (Array.isArray(out.targets))
    out.targets = out.targets
      .map((target) => JSON.stringify(target))
      .sort()
      .map((target) => JSON.parse(target));
  return out;
}

/** storeRows with keys normalized and the module version left out. */
export function meaningRows(path) {
  const ids = symbolIds(path);
  const rows = storeRows(path);
  const out = {};
  for (const [table, lines] of Object.entries(rows)) {
    out[table] = lines
      .map((line) => {
        if (table === "project") return line;
        const row = JSON.parse(line);
        const file = row.file ?? row.path;
        if (typeof row.body === "string") {
          const body = JSON.parse(row.body);
          if (table === "graph_files" || table === "graph_parse_failures")
            delete body.version;
          if (body.result?.data?.analyzer) delete body.result.data.analyzer;
          row.body = JSON.stringify(normalize(body, file, ids));
        }
        if (table === "graph_parse_failures") delete row.version;
        return JSON.stringify(row);
      })
      .sort();
  }
  return out;
}

/** Rows of `after` not in `before`, per table (rows written by a change). */
export function written(before, after) {
  const out = {};
  for (const table of Object.keys(after)) {
    const old = new Set(before[table] ?? []);
    out[table] = after[table].filter((row) => !old.has(row)).length;
  }
  return out;
}

/** Key form counts: symbols, contains/other link targets and sources. */
export function keyForms(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const form = (key) =>
    /@\d+$/.test(key) ? "offset" : key === "module" ? "module" : "name";
  const count = (map, name) => map.set(name, (map.get(name) ?? 0) + 1);
  try {
    const symbols = new Map();
    const groups = new Map();
    let ordinalMismatches = 0;
    let duplicateKeys = 0;
    const keys = new Set();
    for (const row of db
      .prepare(
        "SELECT body FROM graph_symbols WHERE json_extract(body,'$.module')='typescript'",
      )
      .all()) {
      const symbol = JSON.parse(row.body);
      count(
        symbols,
        `${form(symbol.key)} ${symbol.key.replace(/[@:].*$/, "")}`,
      );
      count(
        groups,
        JSON.stringify([symbol.file, symbol.kind, symbol.identity]),
      );
      const unique = `${symbol.file}\0${symbol.key}`;
      if (keys.has(unique)) duplicateKeys++;
      keys.add(unique);
      // A name key's `~n` must be the stored ordinal.
      if (form(symbol.key) === "name") {
        const expected = `${symbol.kind}:${symbol.identity}${symbol.ordinal ? `~${symbol.ordinal}` : ""}`;
        if (symbol.key !== expected) ordinalMismatches++;
      }
    }
    const sizes = new Map();
    for (const size of groups.values())
      count(sizes, size > 1 ? "shared" : "alone");
    let shared = 0;
    for (const size of groups.values()) if (size > 1) shared += size;
    const targets = new Map();
    const sources = new Map();
    let linksWithKeys = 0;
    for (const row of db
      .prepare("SELECT body FROM graph_links WHERE module='typescript'")
      .all()) {
      const link = JSON.parse(row.body);
      if (link.sourceKey) count(sources, form(link.sourceKey));
      const list = link.data?.targets ?? [];
      if (list.length) linksWithKeys++;
      for (const target of list)
        count(targets, `${link.kind} ${form(target.key)}`);
    }
    const sorted = (map) => Object.fromEntries([...map].sort());
    return {
      symbols: sorted(symbols),
      symbolsInSharedGroups: shared,
      ordinalMismatches,
      duplicateKeys,
      groups: sorted(sizes),
      linkSources: sorted(sources),
      linksWithTargetKeys: linksWithKeys,
      targetKeys: sorted(targets),
    };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === "--forms") {
    console.log(JSON.stringify(keyForms(args[1]), null, 1));
  } else {
    const [left, right] = args;
    const a = meaningRows(left);
    const b = meaningRows(right);
    const differences = {};
    for (const table of Object.keys(a)) {
      const onlyA = written(b, a)[table];
      const onlyB = written(a, b)[table];
      if (onlyA || onlyB) differences[table] = { onlyA, onlyB };
    }
    const rows = Object.fromEntries(
      Object.entries(a).map(([table, lines]) => [table, lines.length]),
    );
    console.log(JSON.stringify({ rows, differences }, null, 1));
    process.exitCode = Object.keys(differences).length ? 1 : 0;
  }
}
