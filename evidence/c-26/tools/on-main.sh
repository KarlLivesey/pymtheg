#!/usr/bin/env bash
# on-main.sh PATTERN : runs this tree's large-checkout tests matching
# PATTERN against main's build in $PYM_SCRATCH/main.
set -u
cp test/graph-typescript-large.test.mjs "$PYM_SCRATCH/main/test/c26-large.test.mjs"
cd "$PYM_SCRATCH/main" || exit 1
node --test --test-name-pattern="$1" test/c26-large.test.mjs 2>&1 | grep -E "^✔|^✖|actual:|expected:" | head -8
