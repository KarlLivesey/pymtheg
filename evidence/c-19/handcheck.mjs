// SPDX-License-Identifier: MIT
// C-19: the hand-check table of the strict join. For each named pin, the 30
// sampled comparisons on links Pymtheg calls definite that are not verified
// as the same declaration (join.mjs, fixed seed by site and written name):
// hard differences first, then unverified library identities, then "same
// crate family and final name" only. Each row takes its verdict from
// handcheck-verdicts.json: by site, or by shape (a Pymtheg target and a
// toolchain target checked once in the crate source). Exits 1 if a sampled
// row has no verdict. Also lists the first 10 gated gains per pin.
// Usage: node handcheck.mjs WORK PIN... > handcheck.md
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [work, ...pins] = process.argv.slice(2);
const verdicts = JSON.parse(readFileSync(new URL("./handcheck-verdicts.json", import.meta.url), "utf8"));
const shapes = verdicts.shapes.map((s) => ({ ...s, p: new RegExp(s.pymtheg), t: new RegExp(s.toolchain) }));
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim().slice(0, 150);
const tcText = (d) => d.toolchain.replace(/ \[rust-analyzer[^\]]*\]/, "").replace(/ ::.*/, "");
let missing = 0;
const totals = new Map();
const out = ["# C-19 hand-check (strict join)", ""];
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  const n = r.disagreementSample.length;
  out.push(`## ${pin}`, "", `${r.disagreementCount} comparisons not verified as the same declaration; ${n} sampled.`, "");
  out.push("| # | Verdict class | Site | Written | Pymtheg | Toolchain | Right | Cause |", "| ---: | --- | --- | --- | --- | --- | --- | --- |");
  r.disagreementSample.forEach((d, i) => {
    let v = verdicts.sites[`${pin}|${d.site}|${d.written}`];
    if (!v) v = shapes.find((s) => s.p.test(d.pymtheg) && s.t.test(tcText(d)));
    if (!v) missing++;
    const right = v ? v.right : "UNCHECKED";
    totals.set(right, (totals.get(right) ?? 0) + 1);
    out.push(`| ${i + 1} | ${d.verdict} | ${esc(d.site)} | \`${esc(d.written)}\` | ${esc(d.pymtheg.replace(/ ::.*/, ""))} | ${esc(tcText(d))} | ${right} | ${v ? esc(`${v.cause}: ${v.note}`) : ""} |`);
  });
  out.push("");
}
out.push("## Totals", "", ...[...totals].map(([k, v]) => `- ${k}: ${v}`), "");
out.push("## Gained links (first 10 gated gains per pin, fixed seed)", "");
out.push("| Pin | Site | Written | Pymtheg reason | Toolchain answer |", "| --- | --- | --- | --- | --- |");
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  for (const g of r.gainSample.slice(0, 10)) out.push(`| ${pin} | ${esc(g.site)} | \`${esc(g.written)}\` | ${esc(g.pymtheg)} | ${esc(g.toolchain)} |`);
}
out.push("");
console.log(out.join("\n").replace(/\n+$/, ""));
if (missing) {
  console.error(`${missing} sampled rows have no hand verdict`);
  process.exit(1);
}
