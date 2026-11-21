// SPDX-License-Identifier: MIT
// Markdown tables from the C-28 diagnosis summary. Usage: node tables.mjs summary.json
import { readFileSync } from "node:fs";
const summary = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fmt = (n) => (n ? n.toLocaleString("en-GB") : "—");
const short = (p) => p.split("/")[1];
for (const [mode, pins] of Object.entries(summary.modes)) {
  const names = Object.keys(pins).filter((p) => pins[p].outcome === "finished").sort();
  const keys = new Map();
  for (const p of names)
    for (const [k, v] of Object.entries(pins[p].classes))
      if (!k.startsWith("bundle\t")) keys.set(k, (keys.get(k) ?? 0) + v);
  console.log(`\n### ${mode}\n`);
  console.log(`| Class | Detail | Total | ${names.map(short).join(" | ")} |`);
  console.log(`| --- | --- | ---: | ${names.map(() => "---:").join(" | ")} |`);
  const order = [...keys].sort((a, b) => {
    const [ca] = a[0].split("\t"), [cb] = b[0].split("\t");
    const ta = [...keys].filter(([k]) => k.startsWith(ca + "\t")).reduce((s, [, v]) => s + v, 0);
    const tb = [...keys].filter(([k]) => k.startsWith(cb + "\t")).reduce((s, [, v]) => s + v, 0);
    return tb - ta || ca.localeCompare(cb) || b[1] - a[1];
  });
  for (const [k, total] of order) {
    const [c, s] = k.split("\t");
    console.log(`| ${c} | ${s} | ${fmt(total)} | ${names.map((p) => fmt(pins[p].classes[k])).join(" | ")} |`);
  }
  const all = names.reduce((s, p) => s + pins[p].noSymbol, 0);
  const bundle = names.reduce((s, p) => s + pins[p].bundle, 0);
  console.log(`| **All no-symbol** | | **${fmt(all)}** | ${names.map((p) => fmt(pins[p].noSymbol)).join(" | ")} |`);
  console.log(`| of which in bundled or minified files | | ${fmt(bundle)} | ${names.map((p) => fmt(pins[p].bundle)).join(" | ")} |`);
  console.log(`\n| Pin | TypeScript links | Level 2 | Level 2 % | no-symbol | no-symbol % of links |`);
  console.log(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  let L = 0, V = 0, N = 0;
  for (const p of names) {
    const r = pins[p];
    L += r.links; V += r.level2; N += r.noSymbol;
    console.log(`| ${p} | ${fmt(r.links)} | ${fmt(r.level2)} | ${(100 * r.level2 / r.links).toFixed(2)}% | ${fmt(r.noSymbol)} | ${(100 * r.noSymbol / r.links).toFixed(2)}% |`);
  }
  console.log(`| **${names.length} pins** | ${fmt(L)} | ${fmt(V)} | ${(100 * V / L).toFixed(2)}% | ${fmt(N)} | ${(100 * N / L).toFixed(2)}% |`);
}
