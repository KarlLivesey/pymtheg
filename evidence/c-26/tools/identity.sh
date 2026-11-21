#!/usr/bin/env bash
# identity.sh BASE_RUN CAND_RUN : row identity (identity-all.mjs, version
# 39 mapped to 38), every link (evidence/c-13/compare.mjs) and the
# dependency-stamp check (evidence/c-13/tools/resolved-rows.mjs) for two
# sweep runs in $PYM_SCRATCH; outputs under $PYM_SCRATCH/out/identity-*.
set -u
tree="$PWD"
cd "$PYM_SCRATCH" || exit 1
node "$tree/evidence/c-26/tools/identity-all.mjs" "$PYM_SCRATCH" "$1" "$2" out/identity-rows.jsonl 2> /dev/null
node -e 'for (const l of require("fs").readFileSync("out/identity-rows.jsonl","utf8").trim().split("\n")) { const r = JSON.parse(l); if (r.skipped) { console.log(r.id, JSON.stringify(r.skipped)); continue; } console.log(r.id, Object.entries(r.report).filter(([, v]) => v.differ).map(([t, v]) => t + " differ=" + v.differ).join(" ") || "all rows identical"); }'
node --max-old-space-size=12000 "$tree/evidence/c-13/compare.mjs" "$PYM_SCRATCH" "$1" "$PYM_SCRATCH" "$2" out/identity-links.json 2>&1 | tail -n 7
node "$tree/evidence/c-13/tools/resolved-rows.mjs" "$PYM_SCRATCH" "$1" "$2" | tee out/identity-resolved.jsonl
