#!/usr/bin/env bash
# cold.sh MAIN_DIST BUILD PIN_DIR... : cold index of each pin with main, this
# change ($PYM_SCRATCH/BUILD) and main again, one at a time
# (scripts/reindex/cold-cost.mjs). Rows differ by design (the new member
# symbols and links); the runs record CPU, wall time and peak memory.
# Output $PYM_SCRATCH/out/cold-BUILD.json.
set -u
main="$1"
build="$2"
shift 2
mkdir -p "$PYM_SCRATCH/stores" "$PYM_SCRATCH/out"
node scripts/reindex/cold-cost.mjs "$PYM_SCRATCH/stores" "$PYM_SCRATCH/out/cold-$build.json" 1 \
  "main-1=$main" "after=$PYM_SCRATCH/$build/dist" "main-2=$main" -- "$@"
