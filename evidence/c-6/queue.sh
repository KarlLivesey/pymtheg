#!/usr/bin/env bash
# Runs the C-6 server measurements one after another once the running
# compare.sh has finished: concurrency, then Embassy and swc.
set -uo pipefail
while pgrep -f "evidence/c-6/compare[.]sh" >/dev/null; do sleep 30; done
bash evidence/c-6/concurrency.sh "$PYM_SCRATCH/main-tree"
bash evidence/c-6/large.sh ~/pymtheg-dev/runs/c6pb/tree ~/pymtheg-dev/runs/c6p/tree
echo queue done
