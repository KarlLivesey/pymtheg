#!/usr/bin/env bash
# cost-all.sh : cold index of astro and vite, main, candidate, main again,
# one after another (cost.sh), on the same storage. Output to stdout.
set -u
t="$(dirname "$0")"
for id in astro vite; do
  bash "$t/cost.sh" "$PYM_SCRATCH/base" main-1 "$id"
  bash "$t/cost.sh" "$PYM_SCRATCH/final" c13 "$id"
  bash "$t/cost.sh" "$PYM_SCRATCH/base" main-2 "$id"
done
