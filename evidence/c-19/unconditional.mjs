// SPDX-License-Identifier: MIT
// C-19: across all pins, the hard disagreements (on links Pymtheg calls
// definite) split by whether Pymtheg records a cfg condition other than
// `test` on the link, and every unconditional one listed for a hand check.
// Usage: node unconditional.mjs WORK
import { readFileSync } from "node:fs";
import { join } from "node:path";

const work = process.argv[2];
const pins = readFileSync(join(work, "pins.txt"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
let conditional = 0;
let all = 0;
const list = [];
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  const hardTotal = Object.entries(r.agreement).filter(([k]) => !k.includes("structural") && k.split(" | ")[2].startsWith("disagree")).reduce((a, [, n]) => a + n, 0);
  const hardCond = Object.entries(r.verdictsUnderNonTestCfg).filter(([k]) => !k.includes("structural") && k.split(" | ")[1].startsWith("disagree")).reduce((a, [, n]) => a + n, 0);
  all += hardTotal;
  conditional += hardCond;
  for (const d of r.disagreementAll) if (d.verdict.startsWith("disagree") && !d.conditional) list.push({ pin, ...d });
}
console.log(JSON.stringify({ hard: all, underNonTestCfg: conditional, unconditional: all - conditional }));
for (const d of list) console.log(`${d.pin} | ${d.verdict} | ${d.site} | ${d.written} | P: ${d.pymtheg.slice(0, 120)} | T: ${d.toolchain.replace(/\[rust-analyzer[^\]]*\]/, "").slice(0, 140)}`);
