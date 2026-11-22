#!/usr/bin/env bash
# cold.sh AFTER : cold index of each of the four pins with main, AFTER and
# main again (scripts/reindex/cold-cost.mjs, one at a time, rows of each
# compared with main's first, TypeScript `loadedBy` and version 45 → 44
# normalised). Output $PYM_SCRATCH/out/cold-AFTER.json.
set -u
mkdir -p "$PYM_SCRATCH/stores" "$PYM_SCRATCH/out"
node scripts/reindex/cold-cost.mjs "$PYM_SCRATCH/stores" "$PYM_SCRATCH/out/cold-$1.json" 1 \
  "main-1=$PYM_SCRATCH/main/dist" "after=$PYM_SCRATCH/$1/dist" "main-2=$PYM_SCRATCH/main/dist" \
  --ts-loaded-by -- \
  "$PYM_SCRATCH/pins/honojs_hono" "$PYM_SCRATCH/pins/trpc_trpc" \
  "$PYM_SCRATCH/pins/vitejs_vite" "$PYM_SCRATCH/pins/excalidraw_excalidraw"
