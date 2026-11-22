#!/usr/bin/env bash
# build-archive.sh DIR : reads a git archive (tar) of a revision on stdin,
# unpacks it into $PYM_SCRATCH/DIR, installs and builds it.
set -u
dir="$PYM_SCRATCH/$1"
mkdir -p "$dir"
tar -x -C "$dir"
cd "$dir" || exit 1
npm ci --ignore-scripts --no-audit --no-fund > /dev/null 2>&1
npx tsc -p .
grep -n "MODULE_VERSION = " src/graph/languages/typescript/index.ts
