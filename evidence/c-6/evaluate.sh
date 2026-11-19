#!/usr/bin/env bash
# C-6 option evaluation on main's build (dist in this mirror, built from main
# before any C-6 change): one cold index per variant, serially, on the
# scratch disk. Output: $PYM_SCRATCH/out/evaluate.jsonl
#   bash evidence/c-6/evaluate.sh <corpus> <variant>...
set -euo pipefail
bash evidence/c-6/split.sh dist "$PYM_SCRATCH/out/evaluate.jsonl" "$@"
