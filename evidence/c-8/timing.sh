#!/usr/bin/env bash
# C-8 evidence: one cold `graph index` per run on a fresh copy, in this order
# for each project: base, base again (the noise), candidate. Wall time and peak
# RSS from GNU time. Observations, not assertions.
# Usage: timing.sh BASE_BUILD CANDIDATE_BUILD WORK PROJECT_DIR...
set -u
base="$1"; candidate="$2"; work="$3"; shift 3
mkdir -p "$work"
for project in "$@"; do
  for run in base:"$base" base-again:"$base" candidate:"$candidate"; do
    label="${run%%:*}"; build="${run#*:}"
    root="$work/$(basename "$project")-$label"
    rm -rf "$root"
    cp -a "$project" "$root"
    rm -rf "$root/.git" "$root/.pymtheg"
    chmod -R u+w "$root"
    (cd "$root" && node "$build/dist/cli/main.js" init . --name timing --format json > /dev/null)
    (cd "$root" && /usr/bin/time -f "%e %M" -o "$root.time" node "$build/dist/cli/main.js" graph index --root . --json > /dev/null 2>&1)
    read -r wall kib < "$root.time"
    echo "$(basename "$project") $label wall=${wall}s peak=$((kib / 1024))MiB load=$(cut -d' ' -f1 /proc/loadavg)"
    rm -rf "$root"
  done
done
