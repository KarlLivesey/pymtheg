#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Runs scripts/reindex/jobs.txt on the dev server, at most 4 at a time.
#   scripts/reindex/run-jobs.sh <before dist> <after dist> <main dist> <out root>
set -u
export BEFORE="$1" AFTER="$2" MAIN="$3" OUT="$4"
job() {
  set -- $1
  local kind=$1 dist=${!2} id=$3
  if [ "$kind" = measure ]; then
    node scripts/reindex/measure.mjs "$dist" "$PYM_SCRATCH" "$id" "$OUT/$4" \
      --profile body,export > "$OUT/log.$4.${id//\//_}.txt" 2>&1
  else
    node scripts/reindex/random-edits.mjs "$dist" "$PYM_SCRATCH" "$id" "$4" "$5" \
      "$OUT/random.${id//\//_}.json" > "$OUT/log.random.${id//\//_}.txt" 2>&1
  fi
  echo "done: $*"
}
export -f job
mkdir -p "$OUT"
grep -v "^$" "${JOBS:-scripts/reindex/jobs.txt}" | xargs -P "${PARALLEL:-4}" -I{} bash -c 'job "{}"'
