#!/usr/bin/env bash
# tracesum.sh NAME... : for each trace log, the count of each marker, the
# last marker lines, and whether it ran out of heap or finished.
set -u
for name in "$@"; do
  log="$PYM_SCRATCH/out/$name.log"
  echo "== $name $(cat "$PYM_SCRATCH/out/$name.time" 2>/dev/null)"
  for marker in TAINT PARTS QUEUE EXTRACT; do
    echo "$marker $(grep -c "^$marker" "$log")"
  done
  grep "^TAINT\|^PARTS\|^QUEUE\|^EXTRACT" "$log" | tail -n 6 | cut -c1-200
  grep -c "FATAL" "$log"
  grep "^{\"files\"\|^without a result\|^compiler failures\|^links taint\|^taint" "$log" | cut -c1-200
done
