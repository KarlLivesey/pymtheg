#!/usr/bin/env bash
# run.sh : the installed sweep of microsoft/TypeScript alone (SW-5 runner
# and policy, scripts/sweep/run.mjs --installed) with a build of this tree.
# Main since PR 51 (`9b4cff4`) lets the pin finish at Node's default heap;
# before it, the pin reached the wall limit (SW-6). The budget is 90 minutes
# instead of 60 so that one slow attempt still finishes. Output
# $PYM_SCRATCH/sweep-sw7.json, attempts under $PYM_SCRATCH/sw.
set -u
npx tsc -p . || exit 1
mkdir -p "$PYM_SCRATCH/build"
cp -a dist node_modules package.json grammars "$PYM_SCRATCH/build/"
node scripts/sweep/run.mjs --manifest evidence/sw-7/pin.json \
  --installed --local-build "$PYM_SCRATCH/build" --scratch "$PYM_SCRATCH/sw" \
  --output "$PYM_SCRATCH/sweep-sw7.json" --wall-minutes 90
