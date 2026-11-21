// SPDX-License-Identifier: MIT
// Fixed-seed draw of N rows per class group across all pins, with source context.
// Usage: node draw.mjs ROWS.jsonl RESULTS.json SCRATCH N SEED GROUPS(comma-separated class prefixes)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const [rowsPath, results, scratch, n, seed, groups] = process.argv.slice(2);
const attempts = new Map(
  JSON.parse(readFileSync(results, "utf8")).repos.map((r) => [r.id, r.attempt]),
);
const rows = readFileSync(rowsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rank = (r) => createHash("sha256").update(`${seed}\0${r.pin}\0${r.id}`).digest("hex");
const texts = new Map();
const out = [];
for (const group of groups.split(",")) {
  const list = rows.filter((r) => r.cls.startsWith(group)).map((r) => ({ ...r, rank: rank(r) }));
  list.sort((a, b) => (a.rank < b.rank ? -1 : 1));
  for (const r of list.slice(0, Number(n))) {
    const path = join(scratch, attempts.get(r.pin), "checkout", r.file);
    let text = texts.get(path);
    if (text === undefined) texts.set(path, (text = readFileSync(path, "utf8")));
    const line = text.slice(0, r.start).split("\n").length;
    const lineText = text.split("\n")[line - 1] ?? "";
    const col = r.start - text.lastIndexOf("\n", r.start - 1) - 1;
    out.push({
      group, rank: r.rank.slice(0, 16), pin: r.pin, file: r.file, line, kind: r.kind, name: r.name,
      cls: r.cls, origin: r.diag?.origin, bundle: r.bundle,
      source: lineText.slice(Math.max(0, col - 100), col + 100).trim(),
    });
  }
}
for (const o of out) console.log(JSON.stringify(o));
