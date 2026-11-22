#!/bin/sh
# SPDX-License-Identifier: MIT
# C-37: cold index pairs (main and the change at the same time, own store
# directories) for each pin, on disk and in memory-backed storage, then a
# row comparison of each pair.
#   scripts/store-cost/pairs.sh <main dist> <after dist> <scratch> <out dir> <memory dir> <pin>...
set -eu
main=$1 after=$2 scratch=$3 out=$4 memory=$5
shift 5
here=$(dirname "$0")
mkdir -p "$out/disk/before" "$out/disk/after" "$out/memory/before" "$out/memory/after"
for pin in "$@"; do
  for place in disk memory; do
    if [ "$place" = disk ]; then root="$scratch/disk/c37"; else root="$memory"; fi
    "$here/run.sh" "$main" "$scratch/pins/$pin" "$root/main-$pin" "$out/$place/before" "$pin" > "$out/$place/$pin-before.log" 2>&1 &
    "$here/run.sh" "$after" "$scratch/pins/$pin" "$root/after-$pin" "$out/$place/after" "$pin" > "$out/$place/$pin-after.log" 2>&1 &
  done
  wait
  for place in disk memory; do
    if cmp -s "$out/$place/before/$pin.rows" "$out/$place/after/$pin.rows"; then
      echo "$pin $place same-rows"
    else
      echo "$pin $place DIFFERENT"
    fi
  done
done
