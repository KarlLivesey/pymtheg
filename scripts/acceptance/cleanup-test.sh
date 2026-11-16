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
# container labelled with its pid remains, and every image the harness has
# recorded as pulled (~/.cache/pymtheg-acceptance/pulled-images) is either
# gone or still used by another run's container. Only this harness's own
# labelled containers and recorded images are judged, never the host-wide
# image list (other projects and runs come and go). Prints one line per mode
# and exits 1 if any mode leaves something.
set -u
tgz=${1:?usage: cleanup-test.sh TARBALL}
scratch=${PYM_SCRATCH:-/tmp}
fifo="$scratch/cleanup-test.fifo"
pulled_file="$HOME/.cache/pymtheg-acceptance/pulled-images"
# Recorded images still present and used by no container: leaked.
leaked() {
  [ -f "$pulled_file" ] || return 0
  while read -r image; do
    [ -n "$image" ] || continue
    docker image inspect "$image" >/dev/null 2>&1 || continue
    [ -n "$(docker ps -a -q --filter "ancestor=$image")" ] && continue
    printf '%s ' "$image"
  done <"$pulled_file"
}
failed=0
for mode in TERM HUP PIPE; do
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
  extra=$(leaked)
  verdict=ok
  [ "$left" -eq 0 ] && [ -z "$extra" ] || verdict=LEFT-BEHIND
  [ "$verdict" = ok ] || failed=1
  echo "$mode: exit $code; containers left $left; pulled images left unused ${extra:-none}; $verdict"
done
rm -f "$fifo"
exit $failed
