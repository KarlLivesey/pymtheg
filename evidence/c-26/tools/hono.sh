#!/usr/bin/env bash
# hono.sh MAIN_BUILD : the identity check on honojs/hono alone. Copies this
# tree's build to $PYM_SCRATCH/cand-hono, sweeps hono with MAIN_BUILD and
# with it (both at once), then runs identity.sh on the two runs.
set -u
tree="$PWD"
mkdir -p "$PYM_SCRATCH/cand-hono" "$PYM_SCRATCH/scripts-copy" "$PYM_SCRATCH/out"
cp -a dist node_modules package.json package-lock.json grammars "$PYM_SCRATCH/cand-hono/"
cp -a scripts/. "$PYM_SCRATCH/scripts-copy/"
node -e 'const fs = require("fs"); const pins = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); fs.writeFileSync(process.argv[2], JSON.stringify(pins.filter((p) => p.id === "honojs/hono"), null, 2));' evidence/c-26/pins-seven.json "$PYM_SCRATCH/pins-hono.json"
node "$PYM_SCRATCH/scripts-copy/sweep/run.mjs" --manifest "$PYM_SCRATCH/pins-hono.json" --local-build "$1" --output "$PYM_SCRATCH/sweep-hono-main.json" --parallel 1 > "$PYM_SCRATCH/out/hono-main.log" 2>&1 &
node "$PYM_SCRATCH/scripts-copy/sweep/run.mjs" --manifest "$PYM_SCRATCH/pins-hono.json" --local-build "$PYM_SCRATCH/cand-hono" --output "$PYM_SCRATCH/sweep-hono-cand.json" --parallel 1 > "$PYM_SCRATCH/out/hono-cand.log" 2>&1 &
wait
tail -n 1 "$PYM_SCRATCH/out/hono-main.log" "$PYM_SCRATCH/out/hono-cand.log"
bash evidence/c-26/tools/identity.sh sweep-hono-main.json sweep-hono-cand.json
