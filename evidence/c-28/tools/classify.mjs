// SPDX-License-Identifier: MIT
// Export every TypeScript no-symbol link of each finished pin with its
// diagnosis facts, and count them by class.
// Usage: node classify.mjs RESULTS.json OUT.jsonl SWEEP_SCRATCH
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [results, out, scratch] = process.argv.slice(2);
const { repos } = JSON.parse(readFileSync(results, "utf8"));

writeFileSync(out, "");
const bundle = (file, d) =>
  /(^|\/)(dist|build|public\/libs|static|vendor)\//.test(file) ||
  /\.min\.js$/.test(file) ||
  /[-.][A-Za-z0-9_]{8,}\.js$/.test(file) ||
  d?.longLine;
export function classOf(file, d) {
  if (!d) return "no-diag";
  if (d.form === "computed" || d.form === "computed-element")
    return `computed-callee:${d.signature ?? "none"}`;
  if (d.form === "name") {
    if (d.resolved?.n) return `name-resolves:${d.resolved.where}`;
    return `undeclared-name${d.global ? ":runtime-global" : ""}`;
  }
  if (d.form === "member") {
    const r = d.receiver;
    if (r === "error" || r === "any" || r === "unknown" || r === "never")
      return `receiver-${r}`;
    if (d.property && d.property !== "none")
      return `property-on-type:${d.property.where || "nodecl"}:${d.property.n > 1 ? "many" : d.property.n}`;
    if (d.indexInfos) return `missing-property:index-signature`;
    return `missing-property:${r}${d.js ? ":js" : ""}`;
  }
  return `other:${d.node}`;
}
for (const repo of repos) {
  if (repo.outcome !== "finished") continue;
  const path = join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, file, kind, json_extract(body,'$.targetName') AS name,
       json_extract(body,'$.range.start') AS start, json_extract(body,'$.range.end') AS end,
       json_extract(body,'$.data.diag') AS diag
       FROM graph_links WHERE module='typescript' AND json_extract(body,'$.data.reason')='no-symbol'`,
    )
    .all();
  const lines = [];
  for (const row of rows) {
    const d = row.diag ? JSON.parse(row.diag) : undefined;
    lines.push(
      JSON.stringify({
        pin: repo.id,
        id: row.id,
        file: row.file,
        kind: row.kind,
        name: row.name,
        start: row.start,
        end: row.end,
        cls: classOf(row.file, d),
        bundle: !!bundle(row.file, d),
        diag: d,
      }),
    );
  }
  appendFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""));
  db.close();
  console.error(repo.id, rows.length);
}
