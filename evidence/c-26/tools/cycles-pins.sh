#!/usr/bin/env bash
# cycles-pins.sh ID... : flow-cycles.mjs on each pinned checkout under
# $PYM_SCRATCH/src.
set -u
tree="$PWD"
for id in "$@"; do
  echo "-- $id"
  node --max-old-space-size=8000 "$tree/evidence/c-26/tools/flow-cycles.mjs" "$tree" "$PYM_SCRATCH/src/$id"
done
