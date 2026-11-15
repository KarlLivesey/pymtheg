#!/bin/sh
# Stops a real acceptance run midway three ways and checks that it leaves
# nothing behind. Run on the dev server from the repository root:
#
#   pymtheg-dev --name r1f-xxxx -- sh scripts/acceptance/cleanup-test.sh TARBALL
#
#   TERM  kill -TERM while a scenario container is running
#   HUP   kill -HUP  while a scenario container is running
#   PIPE  the reader of its output goes away (what a dropped `pymtheg-dev`
#         ssh session does: no tty, so no signal, only a broken pipe)
#
# Pass: for each mode the run exits with its signal code (143, 129, 141), no
# container labelled with its pid remains, and no image it pulled remains
# (the image list afterwards equals the list before). Prints one line per mode
# and exits 1 if any mode leaves something.
set -u
tgz=${1:?usage: cleanup-test.sh TARBALL}
scratch=${PYM_SCRATCH:-/tmp}
fifo="$scratch/cleanup-test.fifo"
images() { docker images --format '{{.Repository}}:{{.Tag}}' | sort; }
failed=0
for mode in TERM HUP PIPE; do
  before=$(images)
  rm -f "$fifo"
  mkfifo "$fifo"
  node scripts/acceptance/run.mjs --tarball "$tgz" --scenarios a-node-only --out "$scratch/cleanup-$mode" >"$fifo" 2>&1 &
  pid=$!
  ours() { docker ps -a -q --filter "label=pymtheg-acc.pid=$pid"; }
  if [ "$mode" = PIPE ]; then
    # Read nothing; close the pipe as soon as the run has a container.
    (until [ -n "$(ours)" ]; do sleep 1; done) <"$fifo" >/dev/null &
  else
    cat "$fifo" >/dev/null &
  fi
  reader=$!
  until [ -n "$(ours)" ] || ! kill -0 "$pid" 2>/dev/null; do sleep 1; done
  # Midway: the scenario is installing or running.
  sleep 15
  [ "$mode" = PIPE ] || kill "-$mode" "$pid"
  wait "$pid"
  code=$?
  kill "$reader" 2>/dev/null
  wait "$reader" 2>/dev/null
  left=$(ours | wc -l)
  after=$(images)
  extra=$(printf '%s\n' "$after" | grep -vxF "$before" | tr '\n' ' ')
  verdict=ok
  [ "$left" -eq 0 ] && [ -z "$extra" ] || verdict=LEFT-BEHIND
  [ "$verdict" = ok ] || failed=1
  echo "$mode: exit $code; containers left $left; images added ${extra:-none}; $verdict"
done
rm -f "$fifo"
exit $failed
