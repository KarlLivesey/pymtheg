#!/usr/bin/env bash
# cold.sh AFTER [MAIN_DIST [PIN...]] : cold index of each pin with main,
# AFTER and main again (scripts/reindex/cold-cost.mjs, one at a time, rows of
# each compared with main's first, TypeScript `loadedBy` and version 45 → 44
# normalised). MAIN_DIST defaults to $PYM_SCRATCH/main/dist; the pins default
# to hono, trpc, vite and excalidraw. Output $PYM_SCRATCH/out/cold-AFTER.json.
set -u
mkdir -p "$PYM_SCRATCH/stores" "$PYM_SCRATCH/out"
after="$1"
main="${2:-$PYM_SCRATCH/main/dist}"
shift
[ $# -gt 0 ] && shift
pins=("$@")
if [ ${#pins[@]} -eq 0 ]; then
  pins=(honojs_hono trpc_trpc vitejs_vite excalidraw_excalidraw)
fi
paths=()
for pin in "${pins[@]}"; do paths+=("$PYM_SCRATCH/pins/$pin"); done
node scripts/reindex/cold-cost.mjs "$PYM_SCRATCH/stores" "$PYM_SCRATCH/out/cold-$after.json" 1 \
  "main-1=$main" "after=$PYM_SCRATCH/$after/dist" "main-2=$main" \
  --ts-loaded-by -- "${paths[@]}"
