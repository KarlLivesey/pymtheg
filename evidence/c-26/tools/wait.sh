#!/usr/bin/env bash
# wait.sh FILE [SECONDS] : waits until FILE exists and is not empty, at most
# SECONDS (default 540), then prints its last 20 lines (cut to 300 columns).
set -u
file="$1"
limit="${2:-540}"
waited=0
while [ ! -s "$file" ] && [ "$waited" -lt "$limit" ]; do
  sleep 10
  waited=$((waited + 10))
done
if [ -s "$file" ]; then tail -n 20 "$file" | cut -c1-300; else echo "not yet: $file"; fi
