#!/usr/bin/env bash
# W3-P1 server comparison: for each version (main, branch) and corpus, run
# cold, warm (unchanged), one-file-changed, and revert, serially. Run from the
# mirrored tree root on the dev server. Output: $PYM_SCRATCH/w3p1/<corpus>.jsonl
# Main's build was prepared locally with
#   git archive <main> src scripts tsconfig.json package.json | tar -x -C w3p1-main.tmp
# then on the server: cd w3p1-main.tmp && ln -s ../node_modules ../grammars . && npx tsc
# (main at b9fc09e2; later main commits do not touch src/graph/).
set -euo pipefail
tree=$(pwd); O=${PYM_SCRATCH:?}/w3p1; mkdir -p "$O"
cd "$PYM_SCRATCH"
for c in vector restic; do
  [ -d "$c" ] || { cp -r ~/pymtheg-dev/corpora/$c "$c" 2>/dev/null || true; chmod -R u+w "$c"; }
done
step() { # version dist corpus lang label
  node "$tree/evidence/w3-p1/identity.mjs" "$2" "$PYM_SCRATCH/$3" "$O/$3-$1.db" "$4" "$1-$5" >> "$O/$3.jsonl"
}
for spec in "restic:go:cmd/restic/main.go" "vector:rust:src/sources/nats/config.rs"; do
  IFS=: read c lang file <<<"$spec"
  : > "$O/$c.jsonl"
  cp "$PYM_SCRATCH/$c/$file" "$O/original"
  for v in main branch; do
    dist=$tree/dist; [ $v = main ] && dist=$tree/w3p1-main.tmp/dist
    rm -f "$O/$c-$v.db" "$O/$c-$v.db-journal"
    step $v "$dist" $c $lang cold
    step $v "$dist" $c $lang warm
    printf '\n// w3p1 probe\nfunc w3p1Probe() int { return 1 }\n' > "$O/append.go"
    printf '\npub fn w3p1_probe() -> u32 { 1 }\n' > "$O/append.rs"
    cat "$O/append.${file##*.}" >> "$PYM_SCRATCH/$c/$file"
    step $v "$dist" $c $lang changed
    cp "$O/original" "$PYM_SCRATCH/$c/$file"
    step $v "$dist" $c $lang reverted
  done
done
echo done
