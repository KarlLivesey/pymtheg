#!/usr/bin/env bash
# Pristine shallow checkouts of the C-6 corpus repositories at their sweep
# commits (sweep/repos.json), under $PYM_SCRATCH/src/<id>. Run from the tree root.
set -euo pipefail
for id in restic/restic cli/cli honojs/hono excalidraw/excalidraw \
  helix-editor/helix ratatui/ratatui embassy-rs/embassy swc-project/swc; do
  line=$(node -e 'const r=require("./sweep/repos.json").find(x=>x.id===process.argv[1]);console.log(r.url+" "+r.commit)' "$id")
  bash evidence/c-2/tools/fetch.sh "$id" $line
done
