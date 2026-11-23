// SPDX-License-Identifier: MIT
// C-39: attribute newly Level 2 links to items. A link whose candidate data
// carries `unreadChecked` was kept by item 4; one whose main reason was
// `incomplete-config` is item 2; others are listed by main reason.
// Usage: node attribute.mjs SCRATCH CAND.json NEW.jsonl
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, candPath, newPath] = process.argv.slice(2);
const runs = new Map(JSON.parse(readFileSync(candPath, "utf8")).repos.map((r) => [r.id, r]));
const rows = readFileSync(newPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const out = {};
for (const [pin, list] of Map.groupBy(rows, (r) => r.pin)) {
  const db = new DatabaseSync(join(scratch, runs.get(pin).attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const get = db.prepare(`SELECT json_extract(body,'$.data.unreadChecked') AS checked FROM graph_links
    WHERE file=? AND kind=? AND json_extract(body,'$.range.start')=? AND json_extract(body,'$.targetName')=?`);
  for (const r of list) {
    const checked = get.get(r.file, r.kind, r.start, r.name)?.checked;
    const item = checked ? "item 4 (kept beside an unread file)" : r.before.reason === "incomplete-config" ? "item 2 (config read)" : `other (main: ${r.before.reason ?? r.before.resolution})`;
    const key = `${item} | ${pin}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  db.close();
}
for (const [k, v] of Object.entries(out).sort()) console.log(v + "\t" + k);
