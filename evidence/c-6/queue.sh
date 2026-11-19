#!/usr/bin/env bash
# Runs the C-6 concurrency measurement once the running compare.sh has
# finished, so the two Vector indexes do not overlap.
set -uo pipefail
while pgrep -f "evidence/c-6/compare[.]sh" >/dev/null; do sleep 30; done
bash evidence/c-6/concurrency.sh "$PYM_SCRATCH/main-tree"
echo queue done
