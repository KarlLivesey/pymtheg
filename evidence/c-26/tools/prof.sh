#!/usr/bin/env bash
# prof.sh : runs hang-probe.mjs on the non-returning file for 30 s under
# V8's tick profiler (its log is written as it runs, so a killed run still
# has one), then prints the profile's summary and bottom-up view.
set -u
tree="$PWD"
dir="$PYM_SCRATCH/prof"
mkdir -p "$dir"
cd "$dir" || exit 1
timeout 30 node --prof --logfile="$dir/ticks.log" --no-logfile-per-isolate "$tree/evidence/c-26/tools/hang-probe.mjs" "$tree" "$PYM_SCRATCH/hang" > "$dir/probe.out" 2>&1
node --prof-process "$dir/ticks.log" > "$dir/profile.txt" 2> /dev/null
sed -n '1,40p' "$dir/profile.txt"
grep -n "Bottom up" -A 60 "$dir/profile.txt" | cut -c1-160
