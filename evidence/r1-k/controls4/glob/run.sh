#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# R1-K round 4: can a glob import rebind a standard macro name? (dev server)
set -u
cd "$(dirname "$0")"
out="${PYM_SCRATCH:-/tmp}/r1k-glob"; mkdir -p "$out"
rustc --version
rustc --edition 2021 --crate-type lib --crate-name ext -A warnings -o "$out/libext.rlib" ext/src/lib.rs
for f in *.rs; do
  if rustc --edition 2021 -A warnings --extern ext="$out/libext.rlib" -o "$out/${f%.rs}" "$f" 2>"$out/${f%.rs}.err"; then
    printf '%-32s prints: %s\n' "$f" "$("$out/${f%.rs}" 2>&1 | tr '\n' ' ')"
  else
    printf '%-32s does not compile: %s\n' "$f" "$(grep -m1 '^error' "$out/${f%.rs}.err")"
  fi
done
