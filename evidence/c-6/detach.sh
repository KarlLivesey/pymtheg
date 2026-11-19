#!/usr/bin/env bash
# Start a command detached from the SSH session on the dev server, logging to
# $PYM_SCRATCH/<log>. usage: bash evidence/c-6/detach.sh <log> <command...>
log="$PYM_SCRATCH/$1"; shift
setsid nohup "$@" > "$log" 2>&1 < /dev/null &
echo "started $! -> $log"
