#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-22 diagnosis only: while one `graph index` of <root> runs, repeatedly add
# and remove a second hard link to every installed file under <package dir>
# (what another install sharing the same pnpm store does to these inodes:
# their ctime changes, their content does not). Then compare the store with
# <cold.sqlite>. Timing-dependent by design; never a test.
#   scripts/reindex/link-churn.sh <dist> <root> <package dir> <cold.sqlite> <out.json>
set -u
dist=$1 root=$2 package=$3 cold=$4 out=$5
here=$(dirname "$0")
mapfile -t files < <(find "$package" -type f -name '*.d.*ts')
churn() {
  while :; do
    for f in "${files[@]}"; do
      ln "$f" "$f.c22link" 2>/dev/null && rm "$f.c22link"
    done
  done
}
churn &
pid=$!
node "$here/index-once.mjs" "$dist" "$root" "$out.index.json"
kill "$pid"
wait "$pid" 2>/dev/null
for f in "${files[@]}"; do [ -e "$f.c22link" ] && rm "$f.c22link"; done
node "$here/dump.mjs" "$root/.pymtheg/rebuildable/graph.sqlite" "$cold" > "$out"
echo "differences: $(node -e 'const d=require(process.argv[1]);console.log(JSON.stringify(d.map(x=>[x.table,x.onlyIncremental,x.onlyCold])))' "$out")"
