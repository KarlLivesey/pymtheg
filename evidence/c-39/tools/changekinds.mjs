// SPDX-License-Identifier: MIT
// C-39: classify every definite link whose target changed.
// Usage: node changekinds.mjs CHANGED.jsonl
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const parse = (t) => { const [eco, unit, ...rest] = t.split(":"); return { eco, unit, symbol: rest.join(":") }; };
const out = {};
const examples = {};
for (const r of rows) {
  let k;
  if (!r.now) k = "site removed";
  else if (r.now.resolution === "ambiguous") k = "now a candidate set";
  else if (r.now.resolution !== "library" && r.now.resolution !== "resolved") k = `now ${r.now.resolution} (${r.now.reason})`;
  else if (r.resolution === "library" && r.now.resolution === "library") {
    const a = parse(r.target), b = parse(r.now.target);
    k = a.unit !== b.unit ? "library: declaring package named instead of the importing package" : "library: same package, declaration name instead of binding spelling";
  } else k = `${r.resolution} -> ${r.now.resolution}`;
  out[k] = (out[k] ?? 0) + 1;
  (examples[k] ??= []).length < 3 && examples[k].push(`${r.pin} ${r.file}:${r.start} ${r.name}: ${r.target} => ${r.now?.target}`);
}
console.log(JSON.stringify({ counts: out, examples }, null, 1));
