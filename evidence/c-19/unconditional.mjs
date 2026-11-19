// SPDX-License-Identifier: MIT
// C-19: across all pins, the strict-join disagreements on links Pymtheg calls
// definite (target differs, verified different, or unverified), split by
// whether Pymtheg records a cfg condition other than `test`, and every
// unconditional difference listed for a hand check (hard differences,
// trait method against its impl, and unverified paths with another name).
// Usage: node unconditional.mjs WORK
import { readFileSync } from "node:fs";
import { join } from "node:path";

const work = process.argv[2];
const pins = readFileSync(join(work, "pins.txt"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
const counts = {};
const list = [];
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  for (const d of r.disagreementAll) {
    const k = `${d.verdict} | ${d.conditional ? "under non-test cfg" : "unconditional"}`;
    counts[k] = (counts[k] ?? 0) + 1;
    if (!d.conditional && (d.verdict.startsWith("disagree") || d.verdict === "trait-method-vs-its-impl" || d.verdict === "unverified-different-name")) list.push({ pin, ...d });
  }
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(counts).sort())));
for (const d of list)
  console.log(`${d.pin} | ${d.verdict} | ${d.site} | ${d.written} | P: ${d.pymtheg.slice(0, 120)} | T: ${d.toolchain.replace(/\[rust-analyzer[^\]]*\]/, "").slice(0, 140)}${d.verification ? " | " + d.verification : ""}`);
