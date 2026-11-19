#!/usr/bin/env bash
# steps-all.sh BUILD : the TypeScript module's taint walk counts (most steps
# in one walk, walks, walks stopped) on each identity pin, via analyze.mjs.
set -u
t="$(dirname "$0")"
for id in excalidraw vitest trpc astro hono rtk vite; do
  ( node --max-old-space-size=8000 "$t/analyze.mjs" "$1" "$PYM_SCRATCH/src/$id" > "$PYM_SCRATCH/out/steps-$id.log" 2>&1
    echo "$id $(grep '^taint' "$PYM_SCRATCH/out/steps-$id.log") $(grep '^links taint' "$PYM_SCRATCH/out/steps-$id.log")" ) &
  [ "$id" = astro ] && wait
done
wait
