#!/usr/bin/env bash
# long.sh CAND : starts, in the background, the timed cold index
# (timed-index.sh) and a sweep run of microsoft/TypeScript with a 180-minute
# wall (sweep-ts-long.json), both with $PYM_SCRATCH/CAND.
set -u
tree="$PWD"
nohup bash "$tree/evidence/c-26/tools/timed-index.sh" "$PYM_SCRATCH/$1" < /dev/null > /dev/null 2>&1 &
bash "$tree/evidence/c-26/tools/bg.sh" sweep-ts-long node "$PYM_SCRATCH/scripts-copy/sweep/run.mjs" --manifest "$PYM_SCRATCH/pins-typescript.json" --local-build "$PYM_SCRATCH/$1" --output "$PYM_SCRATCH/sweep-ts-long.json" --parallel 1 --wall-minutes 180
