#!/usr/bin/env bash
# build.sh NAME : builds this tree and copies the build to $PYM_SCRATCH/NAME.
set -u
npx tsc -p . || exit 1
mkdir -p "$PYM_SCRATCH/$1"
cp -a dist node_modules package.json grammars "$PYM_SCRATCH/$1/"
echo "built $1"
