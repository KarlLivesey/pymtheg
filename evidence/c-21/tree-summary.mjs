// SPDX-License-Identifier: MIT
// Summarize the tree gate: the final comparison (main's grammar against this
// branch's) and the six single-patch builds (0001-0008 plus one of 0009-0014),
// which tie each newly read file to the patch that reads it on its own.
//   node tree-summary.mjs <final.json> <attr-0009.json>... > tree-gate.md
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [finalPath, ...attrPaths] = process.argv.slice(2);
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const name = (root) => basename(root).replace("__", "/");
const final = load(finalPath);
const byPatch = new Map();
const attr = attrPaths.map((p) => [/attr-(\d{4})/.exec(p)[1], load(p)]);
for (const [patch, report] of attr) {
  for (const r of report.roots) {
    if (r.treeChanged.length || r.newlyFailing.length)
      throw Error(`${patch} ${name(r.root)}: changed or broken trees`);
    for (const f of r.newlyParsing) {
      const key = `${name(r.root)}|${f.file}`;
      byPatch.set(key, [...(byPatch.get(key) ?? []), patch]);
    }
  }
}
const lines = [];
const total = { files: 0, parsedBoth: 0, identical: 0, changed: 0, newly: 0, broken: 0, still: 0 };
lines.push("| Corpus | .rs files | Parsed before | Identical trees | Changed | Newly read | Newly failing | Still failing |");
lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of final.roots) {
  const row = [r.files, r.parsedBoth, r.identical, r.treeChanged.length, r.newlyParsing.length, r.newlyFailing.length, r.failedBoth.length];
  [total.files, total.parsedBoth, total.identical, total.changed, total.newly, total.broken, total.still] =
    [total.files, total.parsedBoth, total.identical, total.changed, total.newly, total.broken, total.still].map((v, i) => v + row[i]);
  lines.push(`| ${name(r.root)} | ${row.join(" | ")} |`);
}
lines.push(`| **Total** | ${Object.values(total).join(" | ")} |`);
lines.push("", "## Newly read files, each with the one patch that reads it alone", "");
lines.push("| Corpus | File | Error on main's grammar | Patch |", "| --- | --- | --- | --- |");
for (const r of final.roots)
  for (const f of r.newlyParsing) {
    const patches = byPatch.get(`${name(r.root)}|${f.file}`) ?? ["none alone"];
    lines.push(`| ${name(r.root)} | \`${f.file}\` | line ${f.oldError.line}:${f.oldError.column} \`${f.oldError.text.replace(/\|/g, "\\|")}\` | ${patches.join(", ")} |`);
  }
lines.push("", "## Files still failing on this branch", "");
lines.push("| Corpus | File | First error |", "| --- | --- | --- |");
for (const r of final.roots)
  for (const f of r.failedBoth)
    lines.push(`| ${name(r.root)} | \`${f.file}\` | line ${f.newError.line}:${f.newError.column} \`${f.newError.text.replace(/\|/g, "\\|")}\` |`);
console.log(lines.join("\n"));
