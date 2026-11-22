#!/usr/bin/env bash
# setup.sh : install and build this tree on the dev server, fetch the
# microsoft/TypeScript pin, and copy its non-returning file to a one-file
# checkout under $PYM_SCRATCH/hang.
set -u
npm ci --ignore-scripts --no-audit --no-fund > /dev/null 2>&1
npx tsc -p .
mkdir -p "$PYM_SCRATCH/out" "$PYM_SCRATCH/hang"
bash evidence/c-13/tools/fetch.sh typescript https://github.com/microsoft/TypeScript.git 21ba970871efd2766ee46813d0bb67253e7878fa
cp "$PYM_SCRATCH/src/typescript/tsc/testdata/tests/cases/compiler/unreachableFlowAfterThrowingForHead1.ts" "$PYM_SCRATCH/hang/h.ts"
git -C "$PYM_SCRATCH/hang" init -q
git -C "$PYM_SCRATCH/hang" add .
echo ready
