#!/usr/bin/env bash
# C-6 Embassy and swc with PR 13 (Rust workers): a cold index with PR 13 merged
# into main (<base-tree>) and with PR 13 merged into this branch (<c6-tree>),
# each under the sweep's 60-minute allowance. Output:
# $PYM_SCRATCH/out/large.jsonl (measure.mjs lines, or a timeout record).
#   bash evidence/c-6/large.sh <base-tree> <c6-tree>
set -uo pipefail
base=$(realpath "$1"); c6=$(realpath "$2")
o="$PYM_SCRATCH/out/large.jsonl"; mkdir -p "$(dirname "$o")"
for corpus in embassy-rs/embassy swc-project/swc; do
  for build in c6 base; do
    tree=$c6; [ $build = base ] && tree=$base
    # A fresh work copy per run; the scratch folder is removed by --clean.
    w="$PYM_SCRATCH/work/large-$build-$(date +%s%N)"; mkdir -p "$(dirname "$w")"
    cp -a --reflink=auto "$PYM_SCRATCH/src/$corpus" "$w"; chmod -R u+w "$w"; rm -f "$w/.done"
    start=$(date +%s)
    timeout -k 10 3600 /usr/bin/time -f '%M' -o "$PYM_SCRATCH/large.time" \
      node evidence/c-6/measure.mjs "$tree/dist" "$w" "$corpus" asis > "$PYM_SCRATCH/large.line"
    code=$?
    if [ $code -eq 0 ]; then
      node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));r.build=process.argv[2];r.processPeakRssMB=Math.round(Number(fs.readFileSync(process.argv[3],"utf8").trim().split("\n").pop())/1024);console.log(JSON.stringify(r))' "$PYM_SCRATCH/large.line" "$build" "$PYM_SCRATCH/large.time" >> "$o"
    else
      files=$(node evidence/c-6/digest.mjs "$w/.pymtheg/rebuildable/graph.sqlite" 2>/dev/null | node -e 'try{const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(d.graph_files)}catch{console.log("unreadable")}')
      echo "{\"label\":\"$corpus\",\"build\":\"$build\",\"exit\":$code,\"wallS\":$(( $(date +%s) - start )),\"storedFiles\":\"$files\"}" >> "$o"
    fi
    tail -1 "$o" | cut -c1-400
  done
done
