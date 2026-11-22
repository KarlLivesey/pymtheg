#!/usr/bin/env bash
# test-ts.sh [PATTERN] : type check, build, format check of the TypeScript
# module and the large-checkout tests (only those matching PATTERN if
# given), with failures shown.
set -u
npx tsc -p . 2>&1 | head -20
npx prettier --check src/graph/languages/typescript/*.ts test/graph-typescript-large.test.mjs | tail -n 2
if [ -n "${1:-}" ]; then
  node --test --test-name-pattern="$1" test/graph-typescript-large.test.mjs > "$PYM_SCRATCH/out/test-ts.log" 2>&1
else
  node --test test/graph-typescript-large.test.mjs test/graph-typescript-crash.test.mjs test/graph-stable-failures.test.mjs > "$PYM_SCRATCH/out/test-ts.log" 2>&1
fi
grep -E "^✔|^✖|^ℹ (pass|fail)|AssertionError|actual:|expected:|one link" "$PYM_SCRATCH/out/test-ts.log" | head -60
