#!/bin/sh
# SPDX-License-Identifier: MIT
# C-40: one cold index through the CLI path (index-once.mjs, a fresh store)
# at Node's default heap, with peak RSS, wall time and exit status from
# /usr/bin/time. The store goes in <store dir> and is removed afterwards.
#   scripts/memory/peak.sh <dist> <pin dir> <store dir> <out prefix>
set -u
# The user's Pymtheg configuration and cache go to fresh folders in the
# scratch, never the account's real ones (scripts/isolated-home.mjs).
export PYMTHEG_CONFIG_HOME="${PYMTHEG_CONFIG_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-config-XXXXXX")}"
export PYMTHEG_CACHE_HOME="${PYMTHEG_CACHE_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-cache-XXXXXX")}"
dist=$1 pin=$2 stores=$3 out=$4
here=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$stores" "$(dirname "$out")"
store="$stores/$(basename "$out").sqlite"
for suffix in "" -wal -shm; do
  if [ -e "$store$suffix" ]; then rm "$store$suffix"; fi
done
/usr/bin/time -v node "$here/reindex/cold-once.mjs" "$dist" "$pin" "$store" c40 "$out.json" > "$out.log" 2>&1
echo "exit $?" >> "$out.log"
node "$here/store-cost/rows.mjs" "$store" > "$out.rows" 2>/dev/null
for suffix in "" -wal -shm; do
  if [ -e "$store$suffix" ]; then rm "$store$suffix"; fi
done
grep -E "^exit|Maximum resident|Elapsed \(wall" "$out.log"
