#!/usr/bin/env bash
# C-14 evidence: for each sampled library link (sample.tsv: repo, file, line,
# qualifier, unit, symbol, version), prints from the pinned checkout of the
# candidate run: the file's import line that binds the qualifier, any local
# or package-level declaration of the qualifier in the file, the go.mod
# require line for a dependency, and `go doc` for a standard-library symbol.
# Usage: verify-sample.sh SCRATCH RUN.json sample.tsv
set -u
scratch="$1"; run="$2"; sample="$3"
while IFS=$'\t' read -r repo file line qualifier unit symbol version; do
  attempt=$(python3 -c 'import json,sys;print([r["attempt"] for r in json.load(open(sys.argv[1]))["repos"] if r["id"]==sys.argv[2]][0])' "$scratch/$run" "$repo")
  root="$scratch/$attempt/checkout"
  echo "== $repo $file:$line -> $unit $symbol $version"
  sed -n "${line}p" "$root/$file" | sed 's/^[[:space:]]*/   source: /'
  if [ -n "$qualifier" ]; then
    grep -n -E "^[[:space:]]*(import[[:space:]]+)?($qualifier[[:space:]]+)?\"$unit\"" "$root/$file" | sed 's/^/   import: /'
    grep -n -E "(^|[^.[:alnum:]_])$qualifier[[:space:]]*(:=|,[^=]*:=)|^(var|func|const|type)[[:space:]]+$qualifier\b" "$root/$file" | head -3 | sed 's/^/   shadow?: /'
  fi
  case "$unit" in
    *.*/*|*.*)
      mod=$(dirname "$root/$file")
      while [ ! -f "$mod/go.mod" ] && [ "$mod" != "$root" ]; do mod=$(dirname "$mod"); done
      grep -n -F "$(echo "$unit" | cut -d/ -f1-3)" "$mod/go.mod" | head -2 | sed "s|^|   ${mod#$root/}/go.mod: |"
      ;;
    builtin) (cd /tmp && go doc builtin."$symbol" 2>&1 | grep -m1 "^func" | sed 's/^/   go doc: /') ;;
    *) (cd /tmp && go doc "$unit.$symbol" 2>&1 | grep -m1 -E "^(func|type|var|const|	)" | sed 's/^/   go doc: /') ;;
  esac
done < "$sample"
