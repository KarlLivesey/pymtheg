#!/usr/bin/env bash
# setup.sh REPO... : fetches the pins (scripts/reindex/fetch.mjs) into
# $PYM_SCRATCH/pins and installs their dependencies as the sweep's
# installed mode does (scripts/reindex/install.mjs), for random.sh.
set -u
node scripts/reindex/fetch.mjs "$PYM_SCRATCH" "$@"
for id in "$@"; do
  name="${id//\//_}"
  if [ ! -d "$PYM_SCRATCH/pins/$name/node_modules" ]; then
    node scripts/reindex/install.mjs "$PYM_SCRATCH/pins/$name" "$PYM_SCRATCH" 2>&1 | tail -n 2
  fi
done
