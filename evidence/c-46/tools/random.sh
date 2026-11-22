#!/usr/bin/env bash
# random.sh BUILD REPO SEED COUNT [FILES.json] : seeded random edits
# (scripts/reindex/random-edits.mjs --command) on $PYM_SCRATCH/pins/REPO,
# each re-indexed through the command and compared row for row with a cold
# index of the same tree, then a no-edit index that must verify without
# writing. With FILES.json, half the edits target the listed files (package
# manifests and the source entries C-46 follows). Setup: setup.sh.
# Output $PYM_SCRATCH/out/random-<name>-<seed>.json and .log.
set -u
name="${2//\//_}"
mkdir -p "$PYM_SCRATCH/stores-random" "$PYM_SCRATCH/out"
extra=()
[ $# -ge 5 ] && extra=(--files "$5")
node scripts/reindex/random-edits.mjs "$PYM_SCRATCH/$1/dist" "$PYM_SCRATCH" "$2" "$3" "$4" \
  "$PYM_SCRATCH/out/random-$name-$3.json" --command \
  --store-dir "$PYM_SCRATCH/stores-random" "${extra[@]}" > "$PYM_SCRATCH/out/random-$name-$3.log" 2>&1
tail -n 2 "$PYM_SCRATCH/out/random-$name-$3.log" | cut -c1-300
