#!/usr/bin/env bash
# timed-index.sh BUILD : a cold `graph index` of a fresh copy of the
# microsoft/TypeScript checkout with BUILD's CLI, its progress lines stamped
# with seconds since start (stamp.mjs), to $PYM_SCRATCH/out/timed-index.log.
set -u
tree="$PWD"
work="$PYM_SCRATCH/timed/typescript"
mkdir -p "$PYM_SCRATCH/timed"
cp -a --reflink=auto "$PYM_SCRATCH/src/typescript" "$work"
cd "$work" || exit 1
node "$1/dist/cli/main.js" init . --name typescript --format json > /dev/null 2>&1
/usr/bin/time -f "%M %e" -o "$PYM_SCRATCH/out/timed-index.time" node "$1/dist/cli/main.js" graph index --root . --json 2>&1 > /dev/null | node "$tree/evidence/c-26/tools/stamp.mjs" > "$PYM_SCRATCH/out/timed-index.log"
echo done > "$PYM_SCRATCH/out/timed-index.done"
