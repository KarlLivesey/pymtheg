#!/usr/bin/env bash
# sweeps.sh MAIN TAG : copies this tree's build to $PYM_SCRATCH/cand-TAG and
# starts, in the background, three sweep runs (scripts/sweep/run.mjs
# --local-build): microsoft/TypeScript with the candidate, and the seven
# identity pins with main ($PYM_SCRATCH/MAIN) and with the candidate. Run
# outputs are $PYM_SCRATCH/<run>-TAG.json.
set -u
tree="$PWD"
main="$1"
tag="$2"
cand="cand-$tag"
mkdir -p "$PYM_SCRATCH/$cand" "$PYM_SCRATCH/scripts-copy"
cp -a dist node_modules package.json package-lock.json grammars "$PYM_SCRATCH/$cand/"
cp -a scripts/. "$PYM_SCRATCH/scripts-copy/"
cp -a evidence/c-26/pins-seven.json evidence/c-26/pins-typescript.json "$PYM_SCRATCH/"
run() { bash "$tree/evidence/c-26/tools/bg.sh" "$1-$tag" node "$PYM_SCRATCH/scripts-copy/sweep/run.mjs" --manifest "$PYM_SCRATCH/$2" --local-build "$PYM_SCRATCH/$3" --output "$PYM_SCRATCH/$1-$tag.json" --parallel "$4"; }
run sweep-ts-cand pins-typescript.json "$cand" 1
run sweep-seven-main pins-seven.json "$main" 2
run sweep-seven-cand pins-seven.json "$cand" 2
