#!/usr/bin/env bash
# Which base reproduces main's plan block? Run from the mirror tree.
set -u
S="$PYM_SCRATCH"
node -e '
const fs=require("fs"),z=require("zlib");
const r=(p)=>JSON.parse((p.endsWith(".gz")?z.gunzipSync(fs.readFileSync(p)):fs.readFileSync(p)).toString());
const sw3=r("evidence/sw-3/breakdown.json.gz"), c4=r("evidence/c-4/coverage-plan-input.json.gz");
const m=new Map(sw3.repos.map(x=>[x.id,x])); for(const x of c4.repos) m.set(x.id,x);
const repos=[...m.keys()].sort().map(k=>m.get(k));
fs.writeFileSync(process.argv[1], JSON.stringify({...c4, repos}));
fs.writeFileSync(process.argv[2], JSON.stringify({...sw3, repos}));
console.log("c4 fields:", Object.keys(c4).join(","), "| sw3 fields:", Object.keys(sw3).join(","));
' "$S/base-c4fields.json" "$S/base-sw3fields.json"
for b in c4fields sw3fields; do
  cp docs/coverage-plan.md "$S/plan-$b.md"
  node scripts/sweep/coverage.mjs --results evidence/c-7/review-2/coverage-plan-input.json.gz --base "$S/base-$b.json" --plan "$S/plan-$b.md" > /dev/null
  if diff -q docs/coverage-plan.md "$S/plan-$b.md" > /dev/null; then echo "$b: reproduces main"; else echo "$b: differs"; fi
done
