#!/usr/bin/env bash
# C-8 evidence: one cold `graph index` per run on a fresh copy, in this order
# for each project. Wall time, peak RSS and user and system CPU time from GNU
# time; user time (the program's own work) is the least distorted by a busy
# shared machine. Observations, not assertions. Every run gets its own new
# folder under WORK; nothing is removed (WORK is scratch).
# Usage: timing.sh BASE_BUILD CANDIDATE_BUILD WORK ROUNDS PROJECT_DIR...
# Each round runs base then candidate; ROUNDS rounds interleave them.
set -u
base="$1"; candidate="$2"; work="$3"; rounds="$4"; shift 4
mkdir -p "$work"
for project in "$@"; do
  for round in $(seq 1 "$rounds"); do
  for run in base-$round:"$base" candidate-$round:"$candidate"; do
    label="${run%%:*}"; build="${run#*:}"
    root="$work/$(basename "$project")-$label"
    cp -a "$project" "$root"
    chmod -R u+w "$root"
    (cd "$root" && node "$build/dist/cli/main.js" init . --name timing --format json > /dev/null)
    (cd "$root" && /usr/bin/time -f "%e %M %U %S" -o "$root.time" node "$build/dist/cli/main.js" graph index --root . --json > /dev/null 2>&1)
    read -r wall kib user system < "$root.time"
    echo "$(basename "$project") $label wall=${wall}s user=${user}s system=${system}s peak=$((kib / 1024))MiB load=$(cut -d' ' -f1 /proc/loadavg)"
  done
  done
done
