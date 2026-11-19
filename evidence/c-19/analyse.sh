#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: everything after the runs: resolver checks, joins, variants, report,
# aggregates, the unconditional-disagreement list and the hand-check.
# Usage: analyse.sh WORK OUT_DIR
set -uo pipefail
work="$1"; outdir="$2"
here="$(dirname "$0")"
mkdir -p "$outdir"
node "$here/rustpath-check.mjs" "$(rustc --print sysroot)" > "$outdir/rustpath-check.txt"; echo "resolver checks exit $?"
bash "$here/join-all.sh" "$work" | tr '\n' ' '; echo
bash "$here/variants.sh" "$work" "$outdir" > /dev/null
node "$here/report.mjs" "$work" "$outdir" > /dev/null
node "$here/aggregate.mjs" "$work" > "$outdir/aggregate.json"
node "$here/unconditional.mjs" "$work" > "$outdir/unconditional.txt"
node "$here/handcheck.mjs" "$work" ripgrep axum helix tauri > "$outdir/handcheck.md"; echo "handcheck exit $?"
