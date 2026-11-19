#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-24: wait for a running process to exit, then run the standard sweep on
# the Rust pins with one build into its own scratch folder (one job slot).
# Usage (from the checkout): [MANIFEST=…] sweep-after.sh PID|- BUILD NAME [PARALLEL]
set -uo pipefail
pid="$1"; build="$2"; name="$3"; parallel="${4:-1}"
[ "$pid" = - ] || tail --pid="$pid" -f /dev/null
node scripts/sweep/run.mjs --manifest "${MANIFEST:-evidence/c-24/rust-pins.json}" \
  --local-build "$PYM_SCRATCH/builds/$build" --scratch "$PYM_SCRATCH/sw/$name" \
  --output "$PYM_SCRATCH/sw/$name.json" --parallel "$parallel" --wall-minutes 120 \
  > "$PYM_SCRATCH/sw-$name.log" 2>&1
echo "$name done $?" >> "$PYM_SCRATCH/sw-done.log"
