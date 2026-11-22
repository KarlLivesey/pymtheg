#!/usr/bin/env bash
# checks4.sh BUILD LABEL EDIT : scripts/reindex/edit-equals-cold.mjs on the
# four pins at once (one edit kind), with $PYM_SCRATCH/BUILD's dist.
set -u
for id in honojs/hono trpc/trpc vitejs/vite excalidraw/excalidraw; do
  node scripts/reindex/edit-equals-cold.mjs "$PYM_SCRATCH/$1/dist" "$PYM_SCRATCH" "$id" "$3" "$2" | cut -c1-320 &
done
wait
