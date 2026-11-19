#!/usr/bin/env bash
# C-6 before/after in one session: for each corpus, a cold index with main,
# then this branch, then main again (main twice shows the noise), on the same
# scratch disk. Run from the branch mirror's tree root with main built at
# <main-tree>. Output: $PYM_SCRATCH/out/compare.jsonl (label = build).
#   bash evidence/c-6/compare.sh <main-tree> <corpus>...
set -euo pipefail
main=$(realpath "$1"); shift
o="$PYM_SCRATCH/out/compare.jsonl"
for corpus in "$@"; do
  for build in main branch main; do
    dist=dist; [ $build = main ] && dist="$main/dist"
    bash evidence/c-6/split.sh "$dist" "$o.part" "$corpus" asis >/dev/null
    tail -1 "$o.part" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));r.build=process.argv[1];console.log(JSON.stringify(r))' "$build" >> "$o"
    tail -1 "$o" | cut -c1-200
  done
done
