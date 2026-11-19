#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: fetch every finished Rust pin, then index each with this build
# (source-only, default settings). Skips pins already fetched or indexed
# (status ok or incomplete); a pin whose earlier attempt failed is indexed
# again into WORK/pym/NAME-2 (nothing is deleted).
# Usage: queue-pym.sh BUILD WORK
set -uo pipefail
build="$1"; work="$2"
here="$(dirname "$0")"
node "$here/pins.mjs" > "$work/pins.txt"
while read -r name url sha; do
  [ -d "$work/src/$name" ] || bash "$here/fetch.sh" "$work" "$name" "$url" "$sha"
done < "$work/pins.txt"
touch "$work/fetched.done"
status() { node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)}catch{console.log("none")}' "$1"; }
while read -r name url sha; do
  dest="$name"
  case "$(status "$work/pym/$name.index.json")" in ok|incomplete) continue ;; esac
  if [ -e "$work/pym/$name" ]; then
    dest="$name-2"
    case "$(status "$work/pym/$dest.index.json")" in ok|incomplete) continue ;; esac
    [ -e "$work/pym/$dest" ] && { echo "$name: both attempts present, skipped"; continue; }
  fi
  echo "== $name"
  bash "$here/pym-index.sh" "$build" "$work" "$name" "$dest"
done < "$work/pins.txt"
