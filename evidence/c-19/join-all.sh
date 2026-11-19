#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: join every pin's default toolchain index to its Pymtheg graph, with
# the pin's crate cache and the toolchain's rust-src for identity checks.
# Usage: join-all.sh WORK [PIN...]
set -uo pipefail
work="$1"; shift
here="$(dirname "$0")"
sysroot="$(rustc --print sysroot)"
pins="$*"
[ -n "$pins" ] || pins="$(cut -d' ' -f1 "$work/pins.txt")"
for name in $pins; do
  [ -f "$work/out/$name.default.scip" ] || { echo "$name: no toolchain index"; continue; }
  graph="$work/pym/$name"
  [ -f "$work/pym/$name-2.index.json" ] && graph="$work/pym/$name-2" # an earlier attempt failed
  [ -f "$graph/.pymtheg/rebuildable/graph.sqlite" ] || { echo "$name: no graph"; continue; }
  node --max-old-space-size=16000 "$here/join.mjs" --graph "$graph/.pymtheg/rebuildable/graph.sqlite" \
    --scip "$work/out/$name.default.scip" --root "$work/src/$name" --name "$name" \
    --cargo-home "$work/cargo-default-$name" --sysroot "$sysroot" \
    --out "$work/out/$name.default.join.json" > /dev/null && echo "$name joined"
done
