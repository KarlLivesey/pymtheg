#!/bin/sh
# SPDX-License-Identifier: MIT
# C-35: before → after cold indexes with the store on disk, two jobs per pin
# (main and the change) at a time, each with its own store directory.
#   scripts/store-cost/disk-batch.sh <main dist> <after dist> <scratch> <out dir> <pin>...
set -eu
# The user's Pymtheg configuration and cache go to fresh folders in the
# scratch, never the account's real ones (scripts/isolated-home.mjs).
export PYMTHEG_CONFIG_HOME="${PYMTHEG_CONFIG_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-config-XXXXXX")}"
export PYMTHEG_CACHE_HOME="${PYMTHEG_CACHE_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-cache-XXXXXX")}"
main=$1 after=$2 scratch=$3 out=$4
shift 4
here=$(dirname "$0")
for pin in "$@"; do
  "$here/run.sh" "$main" "$scratch/pins/$pin" "$scratch/disk/main" "$out/before" "$pin-disk" > "$out/$pin-before.log" 2>&1 &
  "$here/run.sh" "$after" "$scratch/pins/$pin" "$scratch/disk/after" "$out/after" "$pin-disk" > "$out/$pin-after.log" 2>&1 &
  wait
  if cmp -s "$out/before/$pin-disk.rows" "$out/after/$pin-disk.rows"; then
    echo "$pin same-rows"
  else
    echo "$pin DIFFERENT"
  fi
done
