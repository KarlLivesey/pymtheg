#!/usr/bin/env bash
# sweeps.sh : copies this tree's build to $PYM_SCRATCH/cand and starts, in
# the background, three sweep runs (scripts/sweep/run.mjs --local-build):
# microsoft/TypeScript with the candidate, and the seven identity pins with
# main ($PYM_SCRATCH/main) and with the candidate.
set -u
tree="$PWD"
mkdir -p "$PYM_SCRATCH/cand" "$PYM_SCRATCH/scripts-copy"
cp -a dist node_modules package.json package-lock.json grammars "$PYM_SCRATCH/cand/"
cp -a scripts/. "$PYM_SCRATCH/scripts-copy/"
cp -a evidence/c-26/pins-seven.json evidence/c-26/pins-typescript.json "$PYM_SCRATCH/"
run() { bash "$tree/evidence/c-26/tools/bg.sh" "$1" node "$PYM_SCRATCH/scripts-copy/sweep/run.mjs" --manifest "$PYM_SCRATCH/$2" --local-build "$PYM_SCRATCH/$3" --output "$PYM_SCRATCH/$1.json" --parallel "$4"; }
run sweep-ts-cand pins-typescript.json cand 1
run sweep-seven-main pins-seven.json main 2
run sweep-seven-cand pins-seven.json cand 2
