#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-43: does offline `cargo metadata` succeed on a pin with the user's crate
# cache, and does it with an overlay like the route's?
# Usage: probe-metadata.sh PIN_DIR
set -uo pipefail
pin="$1"
dir="$PYM_SCRATCH/probe-meta"
rm -rf "$dir"; mkdir -p "$dir"
cp -a "$pin/." "$dir/copy/"
cd "$dir/copy"
host="$(rustc -vV | sed -n 's/^host: //p')"
echo "== user cache"
CARGO_NET_OFFLINE=true cargo metadata --format-version 1 --offline --filter-platform "$host" > /dev/null 2> "$dir/err1.txt"; echo "exit $?"; head -3 "$dir/err1.txt"
echo "== user cache, no filter"
CARGO_NET_OFFLINE=true cargo metadata --format-version 1 --offline > /dev/null 2> "$dir/err2.txt"; echo "exit $?"; head -3 "$dir/err2.txt"
echo "== git status of copy"
git status --porcelain | head -5
ls ~/.cargo/registry/index/
ls ~/.cargo/registry/index/*/ | head
rm -rf "$dir"
