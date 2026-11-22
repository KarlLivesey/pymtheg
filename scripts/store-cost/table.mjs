// SPDX-License-Identifier: MIT
// C-35: the change note's tables from measure.mjs results.
//   node scripts/store-cost/table.mjs <before dir> <after dir> <before disk dir> <after disk dir> <pin>...
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [before, after, beforeDisk, afterDisk, ...pins] = process.argv.slice(2);
const read = (dir, name) => {
  const path = join(dir, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
const s = (ms) => (ms / 1000).toFixed(1);
const mib = (bytes) => (Number(bytes) / 1048576).toFixed(1);
const statement = (r, prefix) =>
  r.statements
    .filter((x) => x.sql.startsWith(prefix))
    .reduce(
      (sum, x) => ({
        wallMs: sum.wallMs + x.wallMs,
        calls: sum.calls + x.calls,
      }),
      { wallMs: 0, calls: 0 },
    );
const sql = (r) => r.statements.reduce((sum, x) => sum + x.wallMs, 0);
const bytesOf = (r, test) =>
  r.objects.filter(test).reduce((sum, o) => sum + Number(o.bytes), 0);

console.log("Where a cold index's time goes on main (store in memory):\n");
console.log(
  "| Pin | Wall s | SQL s | Link inserts s (rows inserted / stored) | Symbol inserts s (inserted / stored) | Link deletes by file s | Target updates s | Library inserts s | Commits s |",
);
console.log("|---|--:|--:|--:|--:|--:|--:|--:|--:|");
for (const pin of pins) {
  const r = read(before, `${pin}-shm`);
  if (!r) continue;
  const links = statement(r, "INSERT INTO graph_links ");
  const symbols = statement(r, "INSERT INTO graph_symbols ");
  console.log(
    `| ${pin} | ${s(r.wallMs)} | ${s(sql(r))} (${((100 * sql(r)) / r.wallMs).toFixed(0)}%) | ${s(links.wallMs)} (${links.calls} / ${r.tables.graph_links}) | ${s(symbols.wallMs)} (${symbols.calls} / ${r.tables.graph_symbols}) | ${s(statement(r, "DELETE FROM graph_links WHERE file=").wallMs)} | ${s(statement(r, "UPDATE graph_links SET target=").wallMs)} | ${s(statement(r, "INSERT INTO graph_library_targets").wallMs)} | ${s(statement(r, "COMMIT").wallMs)} |`,
  );
}
console.log("\nWhere the bytes are (MiB, final cold store):\n");
console.log(
  "| Pin | Database | Links table | Link indexes | Files table | of which source text | of which parse result | Symbols and their indexes | Library targets and indexes | Other |",
);
console.log("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
for (const pin of pins) {
  const r = read(before, `${pin}-shm`);
  if (!r) continue;
  const on = (table) => (o) => o.name === table || o.tbl === table;
  const links = bytesOf(r, (o) => o.name === "graph_links");
  const linkIndexes = bytesOf(r, (o) => o.tbl === "graph_links" && o.type === "index");
  const files = bytesOf(r, on("graph_files"));
  const symbols = bytesOf(r, on("graph_symbols"));
  const library = bytesOf(r, on("graph_library_targets"));
  const total = r.databaseBytes;
  console.log(
    `| ${pin} | ${mib(total)} | ${mib(links)} | ${mib(linkIndexes)} | ${mib(files)} | ${mib(r.fileBody.text)} | ${mib(r.fileBody.result)} | ${mib(symbols)} | ${mib(library)} | ${mib(total - links - linkIndexes - files - symbols - library)} |`,
  );
}
console.log("\nBefore → after (cold index, observations):\n");
console.log(
  "| Pin | Storage | Wall s | CPU s | SQL s | Peak MiB | Database MiB |",
);
console.log("|---|---|--:|--:|--:|--:|--:|");
for (const pin of pins)
  for (const [storage, b, a] of [
    ["memory", read(before, `${pin}-shm`), read(after, `${pin}-shm`)],
    ["disk", read(beforeDisk, `${pin}-disk`), read(afterDisk, `${pin}-disk`)],
  ]) {
    if (!b || !a) continue;
    console.log(
      `| ${pin} | ${storage} | ${s(b.wallMs)} → ${s(a.wallMs)} | ${s(b.cpuMs)} → ${s(a.cpuMs)} | ${s(sql(b))} → ${s(sql(a))} | ${(b.maxRssKiB / 1024).toFixed(0)} → ${(a.maxRssKiB / 1024).toFixed(0)} | ${mib(b.databaseBytes)} → ${mib(a.databaseBytes)} |`,
    );
  }
