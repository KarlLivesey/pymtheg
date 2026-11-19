// SPDX-License-Identifier: MIT
// C-19: the hand-check table. For each named pin, the 30 sampled
// disagreements on links Pymtheg calls definite (join.mjs: every hard
// disagreement first, then same-name re-export cases, each in fixed-seed
// order). A hard disagreement takes its verdict from handcheck-verdicts.json
// (checked by hand against the pinned source); a re-export case is checked
// in the unit's downloaded source (reexport.mjs). Exits 1 if a sampled hard
// disagreement has no hand verdict.
// Usage: node handcheck.mjs WORK PIN... > handcheck.md
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reexportChecker } from "./reexport.mjs";

const [work, ...pins] = process.argv.slice(2);
const verdicts = JSON.parse(readFileSync(new URL("./handcheck-verdicts.json", import.meta.url), "utf8"));
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 150);
let missing = 0;
const totals = new Map();
const out = ["# C-19 hand-check of disagreements", ""];
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  const check = reexportChecker(join(work, `cargo-default-${pin}`));
  out.push(`## ${pin}`, "", `${r.disagreementCount} disagreements on definite links in all; 30 sampled.`, "");
  out.push("| # | Site | Written | Pymtheg | Toolchain | Right | Cause |", "| ---: | --- | --- | --- | --- | --- | --- |");
  r.disagreementSample.forEach((d, i) => {
    let right;
    let cause;
    if (d.verdict.startsWith("unit-differs")) {
      const found = check(d.pymtheg);
      right = found.startsWith("re-export") ? "both" : found.startsWith("only a glob") ? "both (glob re-export)" : "unchecked";
      cause = `re-export: ${found}`;
    } else {
      const v = verdicts[`${pin}|${d.site}|${d.written}`] ?? verdicts[`${pin}|*|${d.written}`];
      if (!v) {
        missing++;
        right = "UNCHECKED";
        cause = "";
      } else {
        right = v.right;
        cause = `${v.cause}: ${v.note}`;
      }
    }
    totals.set(right, (totals.get(right) ?? 0) + 1);
    out.push(`| ${i + 1} | ${esc(d.site)} | \`${esc(d.written)}\` | ${esc(d.pymtheg)} | ${esc(d.toolchain.replace(/\[rust-analyzer [^\]]*\]/, ""))} | ${right} | ${esc(cause)} |`);
  });
  out.push("");
}
out.push("## Totals", "", ...[...totals].map(([k, v]) => `- ${k}: ${v}`), "");

// The first 10 conservative gains per pin (fixed seed): links Pymtheg leaves
// unresolved that the toolchain answers, outside trait declarations and
// non-test cfg conditions. Read against the source line; see the change note.
out.push("## Gained links (first 10 per pin, fixed seed)", "");
out.push("| Pin | Site | Written | Pymtheg reason | Toolchain answer |", "| --- | --- | --- | --- | --- |");
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  for (const g of r.gainSample.slice(0, 10)) out.push(`| ${pin} | ${esc(g.site)} | \`${esc(g.written)}\` | ${esc(g.pymtheg)} | ${esc(g.toolchain)} |`);
}
out.push("");
console.log(out.join("\n"));
if (missing) {
  console.error(`${missing} sampled hard disagreements have no hand verdict`);
  process.exit(1);
}
