#!/usr/bin/env bash
# checks.sh : build and type check, format check, every TypeScript graph
# test file and the sweep tests, with the counts.
set -u
npm ci --silent > /dev/null 2>&1
npx tsc -p . && echo "tsc ok"
npm run --silent format:check 2>&1 | tail -n 1
node --test test/graph-typescript*.test.mjs 2>&1 | grep -E "^✖|^ℹ (tests|pass|fail)"
node --test scripts/sweep/*.test.mjs 2>&1 | grep -E "^✖|^ℹ (tests|pass|fail)"
