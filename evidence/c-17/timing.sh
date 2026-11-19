#!/usr/bin/env bash
# C-17 (C-14's script): cold index time and peak memory, builds interleaved in one session.
# Usage: timing.sh WORK PROJECT LABEL=BUILD... (each label once per round, ROUNDS rounds)
set -u
work="$1"; project="$2"; rounds="$3"; shift 3
mkdir -p "$work"
for round in $(seq 1 "$rounds"); do
  for pair in "$@"; do
    label="${pair%%=*}"; build="${pair#*=}"
    dir="$work/$label-$round"
    cp -a "$project" "$dir"
    chmod -R u+w "$dir"
    ( cd "$dir" && node "$build/dist/cli/main.js" init . --name t --format json >/dev/null 2>&1 )
    ( cd "$dir" && /usr/bin/time -o "$dir.time" -f "$label round=$round wall=%e user=%U sys=%S maxrss_kib=%M" node "$build/dist/cli/main.js" graph index --root . --json > "$dir.report.json" 2>/dev/null ); cat "$dir.time"
  done
done
