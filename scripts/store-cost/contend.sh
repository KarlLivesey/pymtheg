#!/bin/sh
# SPDX-License-Identifier: MIT
# C-37: a cold index (measure.mjs) with a second writer beside it
# (waiter.mjs, the same build), store on disk; the store is removed after.
#   scripts/store-cost/contend.sh <dist> <pin dir> <store dir> <out dir> <label> [--turnstile] [variant]
set -u
# The user's Pymtheg configuration and cache go to fresh folders in the
# scratch, never the account's real ones (scripts/isolated-home.mjs).
export PYMTHEG_CONFIG_HOME="${PYMTHEG_CONFIG_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-config-XXXXXX")}"
export PYMTHEG_CACHE_HOME="${PYMTHEG_CACHE_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-cache-XXXXXX")}"
dist=$1 pin=$2 stores=$3 outdir=$4 label=$5 gate=${6:-} variant=${7:-production}
here=$(dirname "$0")
mkdir -p "$stores" "$outdir"
store="$stores/$label.sqlite"
for suffix in "" -wal -shm -turnstile; do
  if [ -e "$store$suffix" ]; then rm "$store$suffix"; fi
done
node "$here/measure.mjs" "$dist" "$pin" "$store" "$outdir/$label.json" --variant "$variant" > "$outdir/$label.log" 2>&1 &
index=$!
node "$here/waiter.mjs" "$store" "$index" "$outdir/$label.waits.json" $gate > "$outdir/$label.waiter.log" 2>&1 &
waiter=$!
wait "$index"
echo "index exit $?" >> "$outdir/$label.log"
wait "$waiter"
node "$here/rows.mjs" "$store" > "$outdir/$label.rows" 2>/dev/null
for suffix in "" -wal -shm -turnstile; do
  if [ -e "$store$suffix" ]; then rm "$store$suffix"; fi
done
