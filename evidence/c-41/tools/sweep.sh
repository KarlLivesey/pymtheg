#!/usr/bin/env bash
# sweep.sh BUILD : the installed TypeScript sweep (SW-5 runner and policy)
# of the 19 pins in evidence/c-41/pins-installed.json with
# $PYM_SCRATCH/BUILD, three workers, the two largest pins alone. Shared
# scratch $PYM_SCRATCH/sw (records are keyed by build digest). Output
# $PYM_SCRATCH/sweep-BUILD.json.
set -u
node scripts/sweep/run.mjs --manifest evidence/c-41/pins-installed.json \
  --installed --local-build "$PYM_SCRATCH/$1" --scratch "$PYM_SCRATCH/sw" \
  --output "$PYM_SCRATCH/sweep-$1.json" --parallel 3 \
  --serial-pin pingdotgg/t3code --serial-pin vercel/turborepo
