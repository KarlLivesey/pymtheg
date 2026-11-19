#!/usr/bin/env bash
# cost-all.sh MAIN_BUILD C13_BUILD SUFFIX : cold index of astro and vite with
# main, the candidate, then main again (cost.sh), one after another on the
# same storage. Output to stdout.
set -u
t="$(dirname "$0")"
main="$1"; c13="$2"; suffix="$3"
for id in astro vite; do
  bash "$t/cost.sh" "$main" "main-1$suffix" "$id"
  bash "$t/cost.sh" "$c13" "c13$suffix" "$id"
  bash "$t/cost.sh" "$main" "main-2$suffix" "$id"
done
