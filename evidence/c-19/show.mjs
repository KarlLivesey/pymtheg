// SPDX-License-Identifier: MIT
// C-19: print parts of a join result. Usage: node show.mjs RESULT.json [section] [filter]
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const section = process.argv[3];
const filter = new RegExp(process.argv[4] ?? ".");
const cut = (s) => String(s).replace(/\s+/g, " ").slice(0, 300);
if (!section) {
  const { disagreementAll, disagreementSample, verdictSamples, toolchainNoAnswerSamples, byKind, ...brief } = r;
  console.log(JSON.stringify(brief, null, 1));
} else {
  const v = r[section];
  if (Array.isArray(v)) for (const x of v) { const line = JSON.stringify(x); if (filter.test(line)) console.log(cut(line)); }
  else for (const [k, x] of Object.entries(v)) if (filter.test(k)) { console.log("## " + k + (Array.isArray(x) ? "" : " " + x)); if (Array.isArray(x)) x.forEach((y) => console.log("  " + cut(y))); }
}
