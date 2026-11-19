#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: join every pin's default toolchain index to its Pymtheg graph.
# A pin re-indexed into WORK/pym/NAME-2 (an aborted first run) uses that.
# Usage: join-all.sh WORK
set -uo pipefail
work="$1"
here="$(dirname "$0")"
while read -r name url sha; do
  graph="$work/pym/$name"
  [ -d "$work/pym/$name-2" ] && graph="$work/pym/$name-2"
  [ -f "$work/out/$name.default.scip" ] || { echo "$name: no toolchain index"; continue; }
  node --max-old-space-size=16000 "$here/join.mjs" --graph "$graph/.pymtheg/rebuildable/graph.sqlite" \
    --scip "$work/out/$name.default.scip" --root "$work/src/$name" --name "$name" \
    --out "$work/out/$name.default.join.json" > /dev/null && echo "$name joined"
done < "$work/pins.txt"
