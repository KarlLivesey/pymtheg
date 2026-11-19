// SPDX-License-Identifier: MIT
// C-19: for every link where Pymtheg's library unit and the toolchain's
// declaring crate differ (same name, or a renamed re-export), check that
// Pymtheg's unit re-exports it (see reexport.mjs). Counts and the cases
// not found.
// Usage: node reexport-check.mjs JOIN.json CARGO_HOME
import { readFileSync } from "node:fs";
import { reexportChecker } from "./reexport.mjs";

const [joinFile, cargoHome] = process.argv.slice(2);
const r = JSON.parse(readFileSync(joinFile, "utf8"));
const check = reexportChecker(cargoHome);
const counts = new Map();
const notFound = [];
for (const d of r.disagreementAll.filter((x) => x.verdict.startsWith("unit-differs") || x.verdict === "disagree-library-unit" || x.verdict === "disagree-library-symbol")) {
  const verdict = check(d.pymtheg);
  if (verdict === "NOT found") notFound.push(d);
  counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
}
console.log(JSON.stringify({ pin: r.pin, counts: Object.fromEntries(counts), notFound: notFound.slice(0, 20).map((d) => `${d.site} ${d.written} P: ${d.pymtheg} T: ${d.toolchain.slice(0, 120)}`) }));
