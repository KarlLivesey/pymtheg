#!/usr/bin/env bash
# measure.sh BUILD LABEL REPO... : scripts/reindex/measure.mjs for each pin
# with BUILD's dist (all at once): cold index, no-edit run, then the comment,
# body and export edits, each reverted and compared with the cold store. The
# body edit is CPU-profiled. Output under $PYM_SCRATCH/out/LABEL/.
set -u
build="$1"
label="$2"
shift 2
mkdir -p "$PYM_SCRATCH/out/$label"
for id in "$@"; do
  name="${id//\//_}"
  node scripts/reindex/measure.mjs "$build/dist" "$PYM_SCRATCH" "$id" "$PYM_SCRATCH/out/$label/$label-$name" --profile body > "$PYM_SCRATCH/out/$label/$name.log" 2>&1 &
done
wait
for id in "$@"; do
  name="${id//\//_}"
  grep -E "cold:|warm:|comment:|body:|export:|equals cold" "$PYM_SCRATCH/out/$label/$name.log" | cut -c1-220
done
