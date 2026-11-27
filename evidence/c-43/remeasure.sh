#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-43: fetch the 18 pins measured since the fifth review into scratch, fill
# a crate cache for them (fetch-crates.sh) and measure each pin with the
# route (measure-pins.sh). Run from a built tree on the dev server.
# Usage: remeasure.sh OUT_DIR
set -uo pipefail
out="$1"
ids=(helix-editor/helix actix/actix-web cberner/redb rustls/rustls clap-rs/clap
  ratatui/ratatui tree-sitter/tree-sitter tokio-rs/axum BurntSushi/ripgrep
  crossbeam-rs/crossbeam serde-rs/serde rust-lang/mdBook fjall-rs/fjall
  RustCrypto/hashes rust-embedded/cortex-m DioxusLabs/dioxus
  tauri-apps/tauri alacritty/alacritty)
names=()
for id in "${ids[@]}"; do names+=("${id//\//_}"); done
export CARGO_HOME="$PYM_SCRATCH/cargo-home"
export PYMTHEG_CONFIG_HOME="$PYM_SCRATCH/cfg" PYMTHEG_CACHE_HOME="$PYM_SCRATCH/cache"
node scripts/reindex/fetch.mjs "$PYM_SCRATCH" "${ids[@]}"
bash evidence/c-43/fetch-crates.sh "$PYM_SCRATCH/pins" "${names[@]}"
bash evidence/c-43/measure-pins.sh dist "$PYM_SCRATCH/pins" "$out" "${names[@]}"
echo done
