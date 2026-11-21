#!/usr/bin/env bash
# long.sh CAND : starts, in the background, a sweep run of
# microsoft/TypeScript with $PYM_SCRATCH/CAND and a 180-minute wall, in its
# own scratch folder ($PYM_SCRATCH/long, so no earlier record is reused);
# output $PYM_SCRATCH/long/sweep-ts-long.json.
set -u
tree="$PWD"
mkdir -p "$PYM_SCRATCH/long"
bash "$tree/evidence/c-26/tools/bg.sh" sweep-ts-long node "$PYM_SCRATCH/scripts-copy/sweep/run.mjs" --scratch "$PYM_SCRATCH/long" --manifest "$PYM_SCRATCH/pins-typescript.json" --local-build "$PYM_SCRATCH/$1" --output "$PYM_SCRATCH/long/sweep-ts-long.json" --parallel 1 --wall-minutes 180
