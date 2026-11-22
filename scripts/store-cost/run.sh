#!/bin/sh
# SPDX-License-Identifier: MIT
# C-35: one store-cost measurement on the dev server. The store goes in
# <store dir> (memory-backed or on disk) and is removed afterwards; the
# result and the CPU profile go in <out dir>.
#   scripts/store-cost/run.sh <dist> <pin dir> <store dir> <out dir> <label> [variant]
set -eu
dist=$1 pin=$2 stores=$3 outdir=$4 label=$5 variant=${6:-production}
mkdir -p "$stores" "$outdir/profiles-$label"
store="$stores/$label.sqlite"
for suffix in "" -wal -shm; do
  if [ -e "$store$suffix" ]; then rm "$store$suffix"; fi
done
node --cpu-prof --cpu-prof-dir="$outdir/profiles-$label" \
  "$(dirname "$0")/measure.mjs" "$dist" "$pin" "$store" "$outdir/$label.json" --variant "$variant"
node "$(dirname "$0")/rows.mjs" "$store" > "$outdir/$label.rows"
for suffix in "" -wal -shm; do
  if [ -e "$store$suffix" ]; then rm "$store$suffix"; fi
done
