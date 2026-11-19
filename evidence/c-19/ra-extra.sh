#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: two further rust-analyzer runs on ripgrep.
#   lsif     `rust-analyzer lsif` (the older JSON-lines format), warm caches
#   offline  `rust-analyzer scip` offline with an EMPTY crate cache: what an
#            offline-by-default route meets on a project never built here
# Usage: ra-extra.sh WORK
set -uo pipefail
work="$1"
src="$work/src/ripgrep"
export CARGO_BUILD_JOBS=8

dest="$work/ra/ripgrep.lsif"
cp -a "$src" "$dest"
cd "$dest"
export CARGO_HOME="$work/cargo-default-ripgrep" CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="$dest/target"
/usr/bin/time -v rust-analyzer lsif . > "$work/out/ripgrep.lsif.json" 2> "$work/out/ripgrep.lsif.stderr.txt"
echo "lsif exit $? bytes $(stat -c %s "$work/out/ripgrep.lsif.json") lines $(wc -l < "$work/out/ripgrep.lsif.json")"
grep -E "Elapsed|Maximum resident" "$work/out/ripgrep.lsif.stderr.txt"

dest="$work/ra/ripgrep.offline"
cp -a "$src" "$dest"
cd "$dest"
export CARGO_HOME="$work/cargo-offline-empty" CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="$dest/target"
mkdir -p "$CARGO_HOME"
/usr/bin/time -v rust-analyzer scip . --output "$work/out/ripgrep.offline.scip" > /dev/null 2> "$work/out/ripgrep.offline.stderr.txt"
echo "offline exit $? bytes $(stat -c %s "$work/out/ripgrep.offline.scip" 2>/dev/null || echo 0)"
grep -E "Elapsed|Maximum resident" "$work/out/ripgrep.offline.stderr.txt"
grep -i -m5 "error\|failed\|offline" "$work/out/ripgrep.offline.stderr.txt" | cut -c1-300
