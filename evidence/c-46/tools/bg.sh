#!/usr/bin/env bash
# bg.sh NAME COMMAND... : runs COMMAND detached from the tree, output to
# $PYM_SCRATCH/out/NAME.log, "peak-RSS-KiB wall-s" to NAME.time, and
# NAME.done when it ends.
set -u
name="$1"
shift
mkdir -p "$PYM_SCRATCH/out"
nohup bash -c '/usr/bin/time -f "%M %e" -o "$PYM_SCRATCH/out/$0.time" "$@" > "$PYM_SCRATCH/out/$0.log" 2>&1; echo done > "$PYM_SCRATCH/out/$0.done"' "$name" "$@" < /dev/null > /dev/null 2>&1 &
echo "started $name"
