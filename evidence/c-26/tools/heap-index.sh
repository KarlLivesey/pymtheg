#!/usr/bin/env bash
# heap-index.sh BUILD NAME [NODE_OPTIONS] : a cold `graph index` of a fresh
# copy of the microsoft/TypeScript checkout with BUILD's CLI and the given
# Node options, its progress lines stamped (stamp.mjs). A fatal error writes
# a Node diagnostic report (JavaScript stack included) to
# $PYM_SCRATCH/out/NAME-report/. Outputs $PYM_SCRATCH/out/NAME.{json,log,time,done}.
set -u
tree="$(cd "$(dirname "$0")/../../.." && pwd)"
work="$PYM_SCRATCH/heap/$2"
mkdir -p "$PYM_SCRATCH/heap" "$PYM_SCRATCH/out/$2-report"
cp -a --reflink=auto "$PYM_SCRATCH/src/typescript" "$work"
cd "$work" || exit 1
node "$1/dist/cli/main.js" init . --name typescript --format json > /dev/null 2>&1
export NODE_OPTIONS="--report-on-fatalerror --report-directory=$PYM_SCRATCH/out/$2-report ${3:-}"
/usr/bin/time -f "%M %e" -o "$PYM_SCRATCH/out/$2.time" node "$1/dist/cli/main.js" graph index --root . --json 2>&1 > "$PYM_SCRATCH/out/$2.json" | node "$tree/evidence/c-26/tools/stamp.mjs" > "$PYM_SCRATCH/out/$2.log"
echo done > "$PYM_SCRATCH/out/$2.done"
