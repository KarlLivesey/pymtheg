// SPDX-License-Identifier: MIT
// Every stored graph row in a canonical order, for comparing an incremental
// store with a cold index of the same tree (C-22). Both stores must share
// the project id (symbol and link ids hash it); everything else is compared
// as stored: files with their results, symbols, links with reasons and
// targets, candidates, library targets, context files and failure markers.
//   node scripts/reindex/dump.mjs <graph.db> <other graph.db>   (compare)
import { DatabaseSync } from "node:sqlite";

const TABLES = {
  graph_files: "path",
  graph_contexts: "path",
  graph_parse_failures: "path",
  graph_symbols: "id",
  graph_links: "id",
  graph_candidates: "link,symbol",
  graph_library_targets: "link,id,role",
};

/** Table name → canonical row strings, sorted. */
export function storeRows(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = {};
    for (const [table, order] of Object.entries(TABLES)) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      rows[table] = exists
        ? db
            .prepare(`SELECT * FROM ${table} ORDER BY ${order}`)
            .all()
            .map((row) => JSON.stringify(row))
        : [];
    }
    rows.project = [
      String(
        db.prepare("SELECT value FROM graph_meta WHERE key='project'").get()
          ?.value,
      ),
    ];
    return rows;
  } finally {
    db.close();
  }
}

/**
 * Differences between two dumps: per table, rows only in `a` and only in `b`
 * (at most `limit` of each shown), and the counts. Empty when identical.
 */
export function compareRows(a, b, limit = 5) {
  const differences = [];
  for (const table of Object.keys(a)) {
    const left = new Set(a[table]);
    const right = new Set(b[table] ?? []);
    const onlyA = a[table].filter((row) => !right.has(row));
    const onlyB = (b[table] ?? []).filter((row) => !left.has(row));
    if (onlyA.length || onlyB.length)
      differences.push({
        table,
        onlyIncremental: onlyA.length,
        onlyCold: onlyB.length,
        examples: {
          incremental: onlyA.slice(0, limit).map((row) => row.slice(0, 600)),
          cold: onlyB.slice(0, limit).map((row) => row.slice(0, 600)),
        },
      });
  }
  return differences;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [left, right] = process.argv.slice(2);
  const differences = compareRows(storeRows(left), storeRows(right));
  console.log(JSON.stringify(differences, null, 1));
  process.exitCode = differences.length ? 1 : 0;
}
