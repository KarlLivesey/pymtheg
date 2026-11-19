#!/usr/bin/env bash
# C-15 cost observation: cold `graph index` of fresh clones of two pinned
# checkouts, main and this branch alternated (main twice), one session, on
# memory-backed scratch (exit 2, an incomplete index, is expected).
# Prints repo, build, wall s, user s, peak RSS KiB.
#   bash cost.sh WORK MAIN_BUILD BRANCH_BUILD CHECKOUT_A CHECKOUT_B
set -euo pipefail
work=$1 main=$2 branch=$3
shift 3
mkdir -p "$work"
n=0
for checkout in "$@"; do
  for build in main branch main; do
    n=$((n + 1))
    dir="$work/run-$n"
    git -c advice.detachedHead=false clone -q --no-hardlinks "$checkout" "$dir"
    root=$([ "$build" = main ] && echo "$main" || echo "$branch")
    (cd "$dir" && node "$root/dist/cli/main.js" init . --name cost --format json > /dev/null)
    (cd "$dir" && /usr/bin/time -o "$dir.time" -f "%e %U %M" node "$root/dist/cli/main.js" graph index --root . --json > /dev/null 2>&1 || true)
    stats=$(tail -1 "$dir.time")
    echo "$(basename "$(dirname "$(dirname "$(dirname "$checkout")")")") $build $stats"
  done
done
