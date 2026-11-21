#!/usr/bin/env bash
# attempt.sh RUN ID : the last progress and error lines of a sweep attempt's
# cold and warm index (RUN is $PYM_SCRATCH/RUN.json).
set -u
cd "$PYM_SCRATCH" || exit 1
attempt=$(node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).repos.find((x) => x.id === process.argv[2]); console.log(r.attempt)' "$1.json" "$2")
for stage in cold warm; do
  [ -f "$attempt/$stage.err" ] || continue
  echo "== $stage"
  grep -v "^ *[0-9]*: 0x" "$attempt/$stage.err" | grep -v "^$" | tail -n 8 | cut -c1-220
done
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).repos.find((x) => x.id === process.argv[2]); console.log(JSON.stringify({ outcome: r.outcome, wall: r.wallSeconds, peak: r.peakRssKiB }))' "$1.json" "$2"
