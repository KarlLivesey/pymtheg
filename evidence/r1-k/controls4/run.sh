#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# R1-K round 4 compiler controls: the per-site name rule (dev server;
# evidence only). Prints what each program prints, or its first error line.
set -u
cd "$(dirname "$0")"
out="${PYM_SCRATCH:-/tmp}/r1k-controls4"; mkdir -p "$out"
rustc --version
for f in *.rs; do
  if rustc --edition 2021 -A warnings -o "$out/${f%.rs}" "$f" 2>"$out/${f%.rs}.err"; then
    printf '%-40s prints: %s\n' "$f" "$("$out/${f%.rs}" 2>&1 | tr '\n' ' ')"
  else
    printf '%-40s does not compile: %s\n' "$f" "$(grep -m1 '^error' "$out/${f%.rs}.err")"
  fi
done
rustc --edition 2021 --crate-type lib --crate-name m -A warnings -o "$out/libm.rlib" cross/m/src/lib.rs
if rustc --edition 2021 -A warnings --extern m="$out/libm.rlib" -o "$out/n5" cross/n5_macro_use_extern_crate.rs 2>"$out/n5.err"; then
  printf '%-40s prints: %s\n' "n5_macro_use_extern_crate.rs" "$("$out/n5" 2>&1 | tr '\n' ' ')"
else printf '%-40s does not compile: %s\n' "n5_macro_use_extern_crate.rs" "$(grep -m1 '^error' "$out/n5.err")"; fi
