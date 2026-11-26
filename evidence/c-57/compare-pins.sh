#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-57: for each pin, a cold index with main's build and with this branch's
# (same project id), compared link by link (link-diff.mjs). The two stores
# are deleted after each pin.
# Usage: compare-pins.sh MAIN_DIST BRANCH_DIST OUT_DIR PIN_DIR...
set -uo pipefail
main="$1"; branch="$2"; out="$3"; shift 3
mkdir -p "$out"
for pin in "$@"; do
  name="$(basename "$pin")"
  node scripts/reindex/cold-once.mjs "$main" "$pin" "$PYM_SCRATCH/cmp-main.sqlite" "$name" > /dev/null 2> "$out/$name.main.err"
  node scripts/reindex/cold-once.mjs "$branch" "$pin" "$PYM_SCRATCH/cmp-branch.sqlite" "$name" > /dev/null 2> "$out/$name.branch.err"
  node evidence/c-57/link-diff.mjs "$PYM_SCRATCH/cmp-main.sqlite" "$PYM_SCRATCH/cmp-branch.sqlite" "$out/$name.json" | tail -1
  rm -f "$PYM_SCRATCH"/cmp-main.sqlite* "$PYM_SCRATCH"/cmp-branch.sqlite*
done
echo done
