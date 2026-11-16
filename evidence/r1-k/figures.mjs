// R1-K: print every figure the change note and PR description quote, derived
// from the committed summaries and comparison outputs in this directory.
// Usage: node evidence/r1-k/figures.mjs
import { readFileSync } from "node:fs";
const here = (f) => new URL("./" + f, import.meta.url);
const sum = (l) => JSON.parse(readFileSync(here(`${l}-summary.json`), "utf8"));
const cmp = (c) => readFileSync(here(`${c}-compare.txt`), "utf8");
for (const c of ["ripgrep", "vector"]) {
  const b = sum(`${c}-before`),
    a = sum(`${c}-after`),
    t = cmp(c);
  console.log(`\n== ${c}`);
  console.log("files", b.files, "| before seconds", b.seconds, "| after seconds", a.seconds);
  console.log("before links", b.links, b.outcome);
  console.log("after  links", a.links, a.outcome);
  for (const line of t.split("\n"))
    if (
      /of which new macro-argument|derived macro-body calls|unresolved -> definite \d|opaque-item-may-shadow-name$|later-probe-step$/.test(
        line,
      )
    )
      console.log(" ", line.trim());
  const classes = (s) => {
    const m = {};
    for (const [k, v] of Object.entries(s.unresolvedByClass)) {
      const cls = k.split("|")[1];
      m[cls] = (m[cls] ?? 0) + v;
    }
    return m;
  };
  console.log("before classes (all kinds)", classes(b));
  const ws = (s, test) =>
    Object.entries(s.unresolvedByClassAndReason)
      .filter(([k]) => k.startsWith("workspace") && test(k.split("|").slice(1).join("|")))
      .reduce((n, [, v]) => n + v, 0);
  const inference = (r) => /receiver-type|later-probe|trait-dispatch|inherent-applic/.test(r);
  for (const [label, s] of [["before", b], ["after", a]])
    console.log(
      `${label}: workspace receiver/inference`,
      ws(s, inference),
      "| workspace receiver-type-unverified",
      ws(s, (r) => /receiver-type-unverified/.test(r)),
      "| workspace opaque-item",
      ws(s, (r) => /opaque-item-may-shadow-name/.test(r)),
      "| workspace failed-file",
      ws(s, (r) => /failed-file-unseen-declarations/.test(r)),
    );
}
