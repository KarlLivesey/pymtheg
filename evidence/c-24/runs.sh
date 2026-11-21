#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-24: N cold runs of one pin with one build, in one reused checkout copy.
# Usage (from $PYM_SCRATCH): [VARY=1] runs.sh BUILD PIN LABEL FIRST LAST [SLOT]
# Writes out/PIN-LABEL-<n>.{dump.gz,time.txt,index.json} for n in FIRST..LAST.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
build="$1"; pin="$2"; label="$3"; first="$4"; last="$5"; slot="${6:-$label}"
co="co/$pin-$slot"
mkdir -p co out
[ -d "$co" ] || cp -a "src/$pin" "$co"
# With VARY=1 every run has its own graph project id, as two fresh
# `pymtheg init` runs do; otherwise all runs share one.
for n in $(seq "$first" "$last"); do
  node "$here/index-run.mjs" "$build" "$co" "c24-$pin${VARY:+-$label-$n}" "out/$pin-$label-$n"
done
