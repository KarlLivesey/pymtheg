#!/usr/bin/env bash
# setup.sh REPO... : builds this tree, copies the build to $PYM_SCRATCH/main
# (this tree is main when first run), fetches the pins (scripts/reindex/
# fetch.mjs) and installs their dependencies as the sweep's installed mode
# does (scripts/reindex/install.mjs).
set -u
npm ci --silent > /dev/null 2>&1
npx tsc -p . || exit 1
mkdir -p "$PYM_SCRATCH/main" "$PYM_SCRATCH/out"
cp -a dist node_modules package.json grammars "$PYM_SCRATCH/main/"
node scripts/reindex/fetch.mjs "$PYM_SCRATCH" "$@"
for id in "$@"; do
  name="${id//\//_}"
  if [ ! -d "$PYM_SCRATCH/pins/$name/node_modules" ]; then
    node scripts/reindex/install.mjs "$PYM_SCRATCH/pins/$name" "$PYM_SCRATCH" 2>&1 | tail -n 2
  fi
done
