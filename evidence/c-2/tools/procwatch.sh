#!/usr/bin/env bash
# procwatch.sh WORKDIR OUT : every 2 s, the memory split of the index process running in WORKDIR (observation only)
w="$1"; out="$2"; : > "$out"
for i in $(seq 1 3000); do
  p=; for q in $(pgrep -f "main.js graph index"); do [ "$(readlink /proc/$q/cwd)" = "$w" ] && p=$q; done
  [ -z "$p" ] && { [ "$i" -gt 30 ] && break; sleep 2; continue; }
  echo "$(date +%s) $(awk '/^(VmRSS|RssAnon|RssFile|RssShmem):/{printf "%s=%d ", $1, $2/1024}' /proc/$p/status)" >> "$out"
  sleep 2
done
