#!/usr/bin/env bash
# C-8 evidence: shallow clones of pinned corpus repositories (sweep/repos.json)
# into DEST/<owner>__<name>, for timing and link comparisons.
# Usage: clone-pins.sh DEST ID...
set -u
dest="$1"; shift
for id in "$@"; do
  line=$(python3 -c 'import json,sys;[print(r["url"], r["commit"]) for r in json.load(open("sweep/repos.json")) if r["id"]==sys.argv[1]]' "$id")
  url="${line% *}"; commit="${line#* }"
  dir="$dest/${id/\//__}"
  [ -d "$dir/.git" ] && continue
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" fetch -q --depth 1 --no-tags "$url" "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  echo "$id $(git -C "$dir" rev-parse HEAD)"
done
