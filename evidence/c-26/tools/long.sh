#!/usr/bin/env bash
# long.sh CAND [TAG] : starts, in the background, a sweep run of
# microsoft/TypeScript with $PYM_SCRATCH/CAND and a 180-minute wall, in its
# own scratch folder ($PYM_SCRATCH/long, or long-TAG, so no earlier record is
# reused); output <that folder>/sweep-ts-long.json, run name sweep-ts-long
# (or sweep-ts-long-TAG) for bg.sh.
set -u
tree="$PWD"
suffix="${2:+-$2}"
dir="$PYM_SCRATCH/long$suffix"
mkdir -p "$dir"
bash "$tree/evidence/c-26/tools/bg.sh" "sweep-ts-long$suffix" node "$PYM_SCRATCH/scripts-copy/sweep/run.mjs" --scratch "$dir" --manifest "$PYM_SCRATCH/pins-typescript.json" --local-build "$PYM_SCRATCH/$1" --output "$dir/sweep-ts-long.json" --parallel 1 --wall-minutes 180
