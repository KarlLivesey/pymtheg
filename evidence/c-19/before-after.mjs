// SPDX-License-Identifier: MIT
// C-19 round 2: the agreement breakdown per pin from two sets of join results
// on the same indexes (BEFORE: the join of 566eb9d; AFTER: this join, with
// each side's own version and impl-method identity), as a markdown table.
// Usage: node before-after.mjs PINS.txt BEFORE_DIR AFTER_DIR
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [pinsFile, beforeDir, afterDir] = process.argv.slice(2);
const pins = readFileSync(pinsFile, "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
function breakdown(dir, pin) {
  const r = JSON.parse(readFileSync(join(dir, `${pin}.default.join.json`), "utf8"));
  const a = { same: 0, noVersion: 0, differ: 0, heuristic: 0, unverified: 0 };
  for (const [key, n] of Object.entries(r.agreement)) {
    const v = key.split(" | ")[2];
    if (v === "agree-same-declaration" || v === "agree-module-by-name") a.same += n;
    else if (v === "agree-same-declaration-version-not-compared") a.noVersion += n;
    else if (v.startsWith("disagree")) a.differ += n;
    else if (v === "heuristic-same-family-and-name") a.heuristic += n;
    else if (v.startsWith("unverified")) a.unverified += n;
  }
  return a;
}
const pct = (x, y) => (y ? `${Math.round((10000 * x) / y) / 100}%` : "—");
const strict = (a) => pct(a.same + a.noVersion, a.same + a.noVersion + a.differ);
const share = (a) => pct(a.heuristic + a.unverified, a.same + a.noVersion + a.differ + a.heuristic + a.unverified);
const fmt = (a) => `${a.same.toLocaleString("en")} / ${a.noVersion.toLocaleString("en")} / ${a.differ} / ${a.heuristic.toLocaleString("en")} / ${a.unverified.toLocaleString("en")}`;
const lines = [
  "| Pin | Before: same / same, version not compared / different / family+name only / unverified | Before: strict (unverified share) | After: same / same, version not compared / different / family+name only / unverified | After: same declaration verified on both sides (unverified share) |",
  "| --- | --- | ---: | --- | ---: |",
];
const tb = { same: 0, noVersion: 0, differ: 0, heuristic: 0, unverified: 0 };
const ta = { ...tb };
for (const pin of pins) {
  const b = breakdown(beforeDir, pin);
  const a = breakdown(afterDir, pin);
  for (const k of Object.keys(tb)) (tb[k] += b[k]), (ta[k] += a[k]);
  lines.push(`| ${pin} | ${fmt(b)} | ${strict(b)} (${share(b)}) | ${fmt(a)} | ${strict(a)} (${share(a)}) |`);
}
lines.push(`| **18 pins** | ${fmt(tb)} | **${strict(tb)}** (${share(tb)}) | ${fmt(ta)} | **${strict(ta)}** (${share(ta)}) |`);
console.log(lines.join("\n"));
