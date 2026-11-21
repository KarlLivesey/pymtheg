#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-22 review re-measurement on the dev server, at most 4 jobs at a time:
# the six-pin edit measurements (2 at a time), cold equals main on restic and
# hono, and trpc installed with hard-link churn during a warm re-index.
#   scripts/reindex/review-batch.sh <after dist> <main dist> <out dir>
set -u
after=$1 main=$2 out=$3
S=$PYM_SCRATCH
mkdir -p "$out"
JOBS=scripts/reindex/jobs-review.txt PARALLEL=2 scripts/reindex/run-jobs.sh none "$after" none "$out" &
for p in restic_restic honojs_hono; do
  node scripts/reindex/same-cold.mjs "$main" "$after" "$S/pins/$p" "$S/same-main/$p" "$out/same-cold-main.$p.json"
done
mkdir -p "$S/inst"
cp -a "$S/pins/trpc_trpc" "$S/inst/trpc-final"
node scripts/reindex/install.mjs "$S/inst/trpc-final" "$S/inst-scratch" > "$out/log.install.trpc.txt" 2>&1
node scripts/reindex/no-edit.mjs "$after" "$S/inst/trpc-final" "$S/noedit/trpc-final" "$out/noedit.trpc-installed.json" 1 > "$out/log.noedit.trpc-installed.txt" 2>&1
P=$(ls -d "$S"/inst/trpc-final/node_modules/.pnpm/expect-type@*/node_modules/expect-type)
scripts/reindex/link-churn.sh "$after" "$S/inst/trpc-final" "$P" "$S/noedit/trpc-final/cold.sqlite" "$out/churn.trpc.json" > "$out/log.churn.txt" 2>&1
wait
echo batch done
