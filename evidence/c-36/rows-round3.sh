#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-36 round 3: every stored row of a cold index with main and with this
# branch, on each pin, one pin at a time (cold-cost.mjs --exact; the Rust
# module version in file records mapped from 47 back to 46). Timings from
# these runs are not cost evidence: other jobs share the server.
# Usage: rows-round3.sh MAIN_DIST HEAD_DIST PINS_DIR OUT_DIR NAME...
set -uo pipefail
main="$1"; head="$2"; pins="$3"; out="$4"; shift 4
mkdir -p "$out" "$PYM_SCRATCH/stores"
for name in "$@"; do
  node --max-old-space-size=65536 scripts/reindex/cold-cost.mjs "$PYM_SCRATCH/stores" "$out/$name.json" 1 \
    main="$main" after="$head" --exact --rust-version 47=46 -- "$pins/$name" > "$out/$name.log" 2>&1
  echo "$name: exit $? $(tail -1 "$out/$name.log" | cut -c1-200)"
done
