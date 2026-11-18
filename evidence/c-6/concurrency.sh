#!/usr/bin/env bash
# C-6 reads and second writers during a cold Vector index: main, then this
# branch, serially. Run from the branch mirror's tree root with main built at
# <main-tree>. Output: $PYM_SCRATCH/out/concurrency.jsonl, one line per run.
#   bash evidence/c-6/concurrency.sh <main-tree>
set -euo pipefail
main=$(realpath "$1")
o="$PYM_SCRATCH/out/concurrency.jsonl"; mkdir -p "$(dirname "$o")"
# A fresh work copy per run; the scratch folder is removed by --clean.
for build in main branch; do
  dist=$(realpath dist); [ $build = main ] && dist="$main/dist"
  w="$PYM_SCRATCH/work/vector-concurrency-$build-$(date +%s%N)"; mkdir -p "$(dirname "$w")"
  cp -a --reflink=auto ~/pymtheg-dev/corpora/vector "$w"; chmod -R u+w "$w"
  node evidence/c-6/concurrency.mjs "$dist" "$w" rust "$build" >> "$o"
  tail -1 "$o" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const by={};for(const p of r.probes){const b=(by[p.mode]??={tries:0,failed:0,slowestMs:0});b.tries++;if(!p.ok)b.failed++;b.slowestMs=Math.max(b.slowestMs,p.ms)}console.log(r.label,"wallMs",r.wallMs,"writes",r.writes,JSON.stringify(by))'
done
