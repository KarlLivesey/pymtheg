#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-24: ask Cargo itself where the Tokio facade's macro crate comes from in
# each item-2 fixture variant, with no Cargo.lock. Prints the resolved source
# of `tokio` and `tokio-macros` from `cargo metadata` (which writes a fresh
# lockfile in a scratch copy, never in the checkout).
# Usage (from the checkout, on the dev server): cargo-check.sh SCRATCH
set -euo pipefail
scratch="$1"
fixtures="$(pwd)/test/fixtures/graph-rust-macro-identity"
export CARGO_HOME="$scratch/cargo-home"
show() {
  local name="$1" dir="$2"
  (cd "$dir" && cargo metadata --format-version 1 2>/dev/null) |
    node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const m = JSON.parse(s);
        for (const p of m.packages.filter((p) => ["tokio", "tokio-macros"].includes(p.name)))
          console.log(process.argv[1].padEnd(14), p.name.padEnd(13), p.version.padEnd(8), p.source ?? "path " + p.manifest_path.replace(/.*\/variants\//, ""));
      });' "$name"
}
variant() {
  local name="$1" from="$2"
  local dir="$scratch/variants/$name"
  mkdir -p "$dir"
  cp -a "$fixtures/$from/." "$dir/"
  rm -f "$dir/Cargo.lock"
  echo "$dir"
}
show unlocked "$(variant unlocked tokio-registry)"
show patched "$(variant patched tokio-patched)"
dir="$(variant config-paths tokio-patched)"
# The same override through `.cargo/config.toml` instead of the manifest.
sed -i '/^\[patch/,$d' "$dir/Cargo.toml"
mkdir -p "$dir/.cargo"
printf '[patch.crates-io]\ntokio-macros = { path = "macros" }\n' > "$dir/.cargo/config.toml"
show config-patch "$dir"
