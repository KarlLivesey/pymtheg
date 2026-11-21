#!/usr/bin/env bash
# lastcalls.sh NAME [N] : the last N (default 6) logged checker calls of a
# trace log, cut to 900 columns, and whether the run ran out of heap.
set -u
log="$PYM_SCRATCH/out/$1.log"
grep "^CALL" "$log" | tail -n "${2:-6}" | cut -c1-900
grep -c "^CALL" "$log"
grep -c "FATAL" "$log"
