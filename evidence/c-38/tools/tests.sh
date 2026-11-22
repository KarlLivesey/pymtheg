#!/usr/bin/env bash
# tests.sh [FILE...] : builds, then runs the given test files (default: the
# TypeScript graph tests and the re-index tests); failures shown.
set -u
npx tsc -p . || exit 1
mkdir -p "$PYM_SCRATCH/out"
if [ "$#" -eq 0 ]; then set -- test/graph-typescript*.test.mjs test/graph-reindex*.test.mjs; fi
node --test "$@" > "$PYM_SCRATCH/out/tests.log" 2>&1
grep -E "^ℹ (tests|pass|fail)" "$PYM_SCRATCH/out/tests.log"
grep -E "^✖" "$PYM_SCRATCH/out/tests.log" | sort -u | head -40
grep -E -A14 "^  (AssertionError|Error|TypeError)" "$PYM_SCRATCH/out/tests.log" | head -120
