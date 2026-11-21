#!/usr/bin/env bash
# bg.sh NAME COMMAND... : runs COMMAND detached in $PYM_SCRATCH with GNU
# time; output to $PYM_SCRATCH/out/NAME.log, "peak-RSS-KiB wall-s" to
# NAME.time, and NAME.done when it ends.
set -u
name="$1"
shift
cd "$PYM_SCRATCH" || exit 1
nohup bash -c '/usr/bin/time -f "%M %e" -o "out/$0.time" "$@" > "out/$0.log" 2>&1; echo done > "out/$0.done"' "$name" "$@" < /dev/null > /dev/null 2>&1 &
echo "started $name"
