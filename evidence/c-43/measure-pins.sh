#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-43: measure the Rust toolchain route on each pin, one at a time.
# rust-analyzer is named through a wrapper (graph.toolchain.rust accepts an
# absolute path) that runs `rust-analyzer scip` under GNU time, so its own
# wall time, CPU and peak memory are recorded apart from the index; the
# review's `rust-analyzer diagnostics` pass is timed the same way.
# Usage: measure-pins.sh DIST PINS_DIR OUT_DIR NAME...
set -uo pipefail
dist="$1"; pins="$2"; out="$3"; shift 3
mkdir -p "$out"
real="$(command -v rust-analyzer)"
for name in "$@"; do
  wrap="$PYM_SCRATCH/wrap-$name"
  mkdir -p "$wrap"
  log="$wrap/time.txt"
  printf '%s\n' '#!/bin/sh' \
    "if [ \"\$1\" = scip ]; then exec /usr/bin/time -v -o '$log' '$real' \"\$@\"; fi" \
    "if [ \"\$1\" = diagnostics ]; then exec /usr/bin/time -v -o '$log.diagnostics' '$real' \"\$@\"; fi" \
    "exec '$real' \"\$@\"" > "$wrap/rust-analyzer"
  chmod +x "$wrap/rust-analyzer"
  node --max-old-space-size=65536 evidence/c-43/measure-route.mjs "$dist" "$pins/$name" "$out/$name.json" \
    "$wrap/rust-analyzer" "$log" "$PYM_SCRATCH/work-$name" 2> "$out/$name.stderr.txt" | tail -1
  [ -f "$log.diagnostics" ] && cp "$log.diagnostics" "$out/$name.diagnostics-time.txt"
  rm -rf "$PYM_SCRATCH/work-$name"
done
