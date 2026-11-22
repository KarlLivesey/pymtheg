#!/usr/bin/env bash
# random.sh BUILD REPO SEED COUNT : seeded random edits (scripts/reindex/
# random-edits.mjs --weighted --command): each edit re-indexed through the
# command and compared row for row with a cold index of the same tree, then
# a no-edit index that must verify without writing. Output
# $PYM_SCRATCH/out/random-<name>-<seed>.json.
set -u
name="${2//\//_}"
mkdir -p "$PYM_SCRATCH/stores-random" "$PYM_SCRATCH/out"
node scripts/reindex/random-edits.mjs "$PYM_SCRATCH/$1/dist" "$PYM_SCRATCH" "$2" "$3" "$4" \
  "$PYM_SCRATCH/out/random-$name-$3.json" --weighted --command \
  --store-dir "$PYM_SCRATCH/stores-random" > "$PYM_SCRATCH/out/random-$name-$3.log" 2>&1
tail -n 2 "$PYM_SCRATCH/out/random-$name-$3.log" | cut -c1-300
