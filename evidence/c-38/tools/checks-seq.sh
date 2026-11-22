#!/usr/bin/env bash
# checks-seq.sh BUILD LABEL EDIT... : scripts/reindex/edit-equals-cold.mjs on
# the four pins for each edit kind, one at a time.
set -u
build="$1"
label="$2"
shift 2
for edit in "$@"; do
  for id in honojs/hono trpc/trpc vitejs/vite excalidraw/excalidraw; do
    node scripts/reindex/edit-equals-cold.mjs "$PYM_SCRATCH/$build/dist" "$PYM_SCRATCH" "$id" "$edit" "$label-$edit" | cut -c1-320
  done
done
