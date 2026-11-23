// SPDX-License-Identifier: MIT
// SW-7: the installed TypeScript headline with microsoft/TypeScript as a
// 20th pin, link-weighted (today's rule, D19) and as the mean of per-pin
// percentages, each without and with D20's library module links, and the
// proven and assumption-marked parts.
// Also: the same with microsoft/TypeScript's test corpus left out.
// Usage: node evidence/sw-7/headline.mjs PINS19.json TSPIN.json OUT.md
import { readFileSync, writeFileSync } from "node:fs";

const [pinsPath, tsPath, out] = process.argv.slice(2);
const nineteen = JSON.parse(readFileSync(pinsPath, "utf8")).pins.filter((p) => !p.outcome);
const tsRun = JSON.parse(readFileSync(tsPath, "utf8"));
const ts = tsRun.pins.filter((p) => !p.outcome);
// The same pin without its test corpus (tsc/testdata: test inputs, fixtures
// and expected-output baselines), from the per-area figures.
const areas = tsRun.details[ts[0].id]?.areas ?? {};
const corpus = Object.entries(areas).filter(([name]) => name.startsWith("tsc/testdata"));
const less = (field) => corpus.reduce((t, [, a]) => t + a[field], 0);
const tsWithoutCorpus = ts.map((p) => ({
  ...p,
  id: p.id + " without tsc/testdata",
  links: p.links - less("links"),
  level2: p.level2 - less("level2"),
  assumed: p.assumed - less("assumed"),
  moduleLinks: p.moduleLinks - less("moduleLinks"),
}));
const pct = (n, d) => (100 * n / d).toFixed(2) + "%";
const fmt = (n) => n.toLocaleString("en");
function measures(pins) {
  const sum = (f) => pins.reduce((t, p) => t + f(p), 0);
  const links = sum((p) => p.links);
  const level2 = sum((p) => p.level2);
  const assumed = sum((p) => p.assumed);
  const modules = sum((p) => p.moduleLinks);
  const mean = (f) => pins.reduce((t, p) => t + f(p), 0) / pins.length;
  return {
    pins: pins.length,
    links,
    weighted: pct(level2, links),
    weightedModules: pct(level2 + modules, links),
    weightedProven: pct(level2 - assumed, links),
    mean: mean((p) => 100 * p.level2 / p.links).toFixed(2) + "%",
    meanModules: mean((p) => 100 * (p.level2 + p.moduleLinks) / p.links).toFixed(2) + "%",
    meanProven: mean((p) => 100 * (p.level2 - p.assumed) / p.links).toFixed(2) + "%",
  };
}
const rows = [
  ["19 pins (SW-6's)", measures(nineteen)],
  ["microsoft/TypeScript alone", measures(ts)],
  ["20 pins", measures([...nineteen, ...ts])],
  ["microsoft/TypeScript without tsc/testdata", measures(tsWithoutCorpus)],
  ["20 pins, microsoft/TypeScript without tsc/testdata", measures([...nineteen, ...tsWithoutCorpus])],
];
const lines = [
  "| Pins | Links | Link-weighted Level 2 | with library module links | proven only | Mean of per-pin Level 2 | with library module links | proven only |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...rows.map(([name, m]) =>
    `| ${name} | ${fmt(m.links)} | ${m.weighted} | ${m.weightedModules} | ${m.weightedProven} | ${m.mean} | ${m.meanModules} | ${m.meanProven} |`,
  ),
];
writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
