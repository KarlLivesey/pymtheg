// SPDX-License-Identifier: MIT
// C-35: a compact copy of measure.mjs results for the evidence folder:
// totals, the 15 costliest statements, every table and index size, the
// stages above 0.5 s and the row digests. Prints one JSON document.
//   node scripts/store-cost/compact.mjs <label>=<result.json>...
import "../isolated-home.mjs";
import { existsSync, readFileSync } from "node:fs";

const out = {};
for (const argument of process.argv.slice(2)) {
  const at = argument.indexOf("=");
  const label = argument.slice(0, at);
  const path = argument.slice(at + 1);
  const r = JSON.parse(readFileSync(path, "utf8"));
  const rows = path.replace(/\.json$/, ".rows");
  out[label] = {
    variant: r.variant,
    wallMs: r.wallMs,
    cpuMs: r.cpuMs,
    sqlMs: r.statements.reduce((sum, s) => sum + s.wallMs, 0),
    maxRssKiB: r.maxRssKiB,
    closeMs: r.closeMs,
    writeBatchRows: r.writeBatchRows,
    longestHoldMs: r.longestHoldMs,
    holds: r.holds,
    longHolds: r.longHolds,
    maxWalBytes: r.maxWalBytes,
    commits: r.commitTimes?.length,
    io: r.io,
    databaseBytes: r.databaseBytes,
    report: r.report,
    fileBody: r.fileBody,
    tables: r.tables,
    objects: r.objects.map(({ name, type, tbl, pages, payload, bytes }) => ({
      name,
      type,
      tbl,
      pages,
      payload,
      bytes,
    })),
    statements: r.statements.slice(0, 15).map((s) => ({
      sql: s.sql,
      calls: s.calls,
      wallMs: s.wallMs,
      changes: s.changes,
      bytes: s.bytes,
    })),
    stages: Object.fromEntries(
      Object.entries(r.stages).filter(([, t]) => t.cpuMs > 500),
    ),
    rows: existsSync(rows) ? JSON.parse(readFileSync(rows, "utf8")) : null,
  };
}
console.log(JSON.stringify(out, null, 1));
