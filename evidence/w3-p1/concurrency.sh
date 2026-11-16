#!/usr/bin/env bash
# Run concurrency.mjs on a writable Vector copy for main and several batch
# limits, serially. Run from the mirrored tree root on the dev server.
set -euo pipefail
tree=$(pwd); O=${PYM_SCRATCH:?}/w3p1; mkdir -p "$O"; cd "$PYM_SCRATCH"
[ -d vector ] || { cp -r ~/pymtheg-dev/corpora/vector vector 2>/dev/null || true; chmod -R u+w vector; }
[ -f "$tree/w3p1-main.tmp/dist/graph/index.js" ] || (cd "$tree/w3p1-main.tmp" && ln -sfn ../node_modules node_modules && ln -sfn ../grammars grammars && npx tsc)
: > "$O/concurrency.jsonl"
[ -n "${SKIP_MAIN:-}" ] || node "$tree/evidence/w3-p1/concurrency.mjs" "$tree/w3p1-main.tmp/dist" "$PYM_SCRATCH/vector" rust main >> "$O/concurrency.jsonl"
for n in ${LIMITS:-16 64}; do
  node "$tree/evidence/w3-p1/concurrency.mjs" "$tree/dist" "$PYM_SCRATCH/vector" rust "branch-N$n" "$n" >> "$O/concurrency.jsonl"
done
rm -rf "$PYM_SCRATCH/vector/.pymtheg"
echo done
