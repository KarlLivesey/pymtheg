#!/usr/bin/env bash
# Compiler controls for the R1-K fixtures (dev server; evidence only, never in
# the default index path). Each file mirrors a case in
# test/graph-rust-r1k-macros.test.mjs. Prints what each program prints:
# a 2 means the macro-introduced helper() was the one called.
set -u
cd "$(dirname "$0")"
out="${PYM_SCRATCH:-/tmp}/r1k-controls"
mkdir -p "$out"
rustc --version
for f in *.rs; do
  if rustc --edition 2021 -A warnings -o "$out/${f%.rs}" "$f" 2>"$out/${f%.rs}.err"; then
    printf '%s compiles; prints: %s; exit %s\n' "$f" "$("$out/${f%.rs}" 2>&1 | tr '\n' ' ')" "$?"
  else
    printf '%s does not compile: %s\n' "$f" "$(head -1 "$out/${f%.rs}.err")"
  fi
done
