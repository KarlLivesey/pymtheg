#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-24: cold index cost in one session on the same storage: for each pin,
# main, the branch, then main again (main twice shows the noise), each a
# cold index of the same checkout copy under its own project id.
# Usage (from $PYM_SCRATCH): cost-runs.sh MAIN_BUILD BRANCH_BUILD PIN...
# Prints pin, build, user+system CPU seconds, wall seconds and peak RSS KiB.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
main="$1"; branch="$2"; shift 2
mkdir -p co out
for pin in "$@"; do
  co="co/$pin-cost"
  [ -d "$co" ] || cp -a "src/$pin" "$co"
  n=0
  for build in "$main" "$branch" "$main"; do
    n=$((n + 1))
    out="out/cost-$pin-$n"
    node "$here/index-run.mjs" "$build" "$co" "c24-cost-$pin-$n" "$out" > /dev/null
    user=$(sed -n 's/.*User time (seconds): //p' "$out.time.txt")
    sys=$(sed -n 's/.*System time (seconds): //p' "$out.time.txt")
    wall=$(sed -n 's/.*Elapsed (wall clock) time (h:mm:ss or m:ss): //p' "$out.time.txt")
    rss=$(sed -n 's/.*Maximum resident set size (kbytes): //p' "$out.time.txt")
    echo "$pin $(basename "$build") cpu=$(awk "BEGIN{print $user + $sys}") wall=$wall rss_kib=$rss"
  done
done
