// Identity digest of a graph database: for every table, the row count and a
// sha256 of every row (all columns) in a total order. Two stores with equal
// digests hold equal rows. usage as a script: node digest.mjs <db>
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export function digest(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const out = {};
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    for (const table of tables) {
      const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => `"${row.name}"`);
      const hash = createHash("sha256");
      let rows = 0;
      for (const row of db
        .prepare(`SELECT * FROM ${table} ORDER BY ${columns.join(",")}`)
        .iterate()) {
        hash.update(JSON.stringify(Object.values(row)) + "\n");
        rows++;
      }
      out[table] = `${rows}:${hash.digest("hex").slice(0, 16)}`;
    }
    // Schema objects too: same tables, indexes and triggers.
    const schema = createHash("sha256");
    for (const row of db
      .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name")
      .iterate())
      schema.update(JSON.stringify(Object.values(row)) + "\n");
    out.schema = schema.digest("hex").slice(0, 16);
    return out;
  } finally {
    db.close();
  }
}
if (import.meta.url === `file://${process.argv[1]}`)
  console.log(JSON.stringify(digest(process.argv[2])));
