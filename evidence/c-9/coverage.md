# Rust Level 2 coverage

Both builds finished the same 18 Rust pins. These figures count Rust links in
those pins across all scopes. The coverage-plan overlay also includes Rust
links in repositories whose primary language is Go or TypeScript.

- **All sites** went from **33.53% to 31.47%**. Main credited 309,617 of 923,374 links. The candidate credited 298,065 of 947,018.
- **Sites already present on main** went from **33.53% to 31.86%**. The candidate credited 294,155 of the same 923,374 links.
- **Stored library symbols** supplied 71,817 links, or 7.58 percentage points of the all-sites score and 24.09% of the credited links. Another 163 stored targets name a whole crate and earn Level 1 credit.

Main reconstructed 83,369 named library uses from stored path spellings and
imports. On the shared sites the candidate required the Rust resolver to
prove the binding and stored 67,907 named library uses. An opaque scope, a
competing import, a Cargo edge with uncertain provenance, or an associated
member with an unknown owner can hold back a target. The new attribute and
derive references add 23,644 sites, of which 3,910 name library symbols.
The candidate's library numerator comes entirely from stored targets.

| Pin | Main links | Main Level 2 | Candidate links | Candidate Level 2 | Candidate on main sites | Stored library symbols |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | 39,086 | 41.68% | 39,819 | 54.42% | 53.81% | 7,949 |
| DioxusLabs/dioxus | 145,714 | 37.30% | 149,592 | 34.27% | 34.62% | 14,045 |
| RustCrypto/hashes | 12,870 | 40.69% | 12,911 | 26.17% | 26.25% | 205 |
| actix/actix-web | 85,053 | 31.02% | 86,640 | 27.39% | 27.59% | 5,441 |
| alacritty/alacritty | 30,052 | 39.39% | 30,965 | 33.10% | 33.73% | 1,674 |
| cberner/redb | 73,191 | 29.04% | 73,731 | 30.71% | 30.83% | 4,313 |
| clap-rs/clap | 50,949 | 26.96% | 52,417 | 30.27% | 30.42% | 4,736 |
| crossbeam-rs/crossbeam | 33,904 | 31.10% | 34,081 | 34.50% | 34.59% | 4,085 |
| fjall-rs/fjall | 13,235 | 36.03% | 13,361 | 38.34% | 38.15% | 2,161 |
| helix-editor/helix | 86,088 | 33.18% | 90,583 | 33.40% | 34.59% | 7,489 |
| ratatui/ratatui | 57,390 | 31.34% | 60,424 | 28.97% | 30.14% | 1,897 |
| rust-embedded/cortex-m | 5,200 | 54.10% | 5,531 | 49.34% | 52.31% | 578 |
| rust-lang/mdBook | 12,374 | 37.60% | 12,557 | 39.87% | 40.01% | 2,151 |
| rustls/rustls | 69,251 | 26.91% | 69,929 | 21.76% | 21.89% | 1,327 |
| serde-rs/serde | 29,641 | 36.47% | 30,714 | 17.15% | 17.71% | 147 |
| tauri-apps/tauri | 85,873 | 36.36% | 88,051 | 33.37% | 33.80% | 7,617 |
| tokio-rs/axum | 39,918 | 35.20% | 41,067 | 26.76% | 27.16% | 2,320 |
| tree-sitter/tree-sitter | 53,585 | 30.74% | 54,645 | 29.33% | 29.55% | 3,682 |

## Preservation

The comparison checked 96,806 symbol keys and all 226,248 definite
Rust checkout links across the 18 pins. It found zero changed keys, zero new
symbols, zero lost definite links and zero changed targets. Comparison used
the pinned file, source span and link kind, followed by the target's file,
symbol key, scoped identity and ordinal. [Comparison script](compare.mjs)

## Reference sample sites settled

These 19 of 88 `rust-std-path` sites in the SW-3 draw now have a stored
library symbol. The representation row records the stored library links.
The macro item records 20,025 external macro links by path. Checkout macro
expansion and generated names remain open on that item.

| Pin | Source | Stored target |
| --- | --- | --- |
| tree-sitter/tree-sitter | `crates/generate/src/build_tables.rs:289` | `std::option::Option::Some` |
| tree-sitter/tree-sitter | `crates/cli/src/util.rs:181` | `std::ops::Drop` |
| rust-lang/mdBook | `crates/mdbook-html/src/html/print.rs:90` | `std::option::Option::Some` |
| BurntSushi/ripgrep | `crates/matcher/src/lib.rs:1172` | `std::result::Result` |
| BurntSushi/ripgrep | `crates/core/flags/defs.rs:5836` | `std::assert!` |
| helix-editor/helix | `helix-term/src/ui/lsp/hover.rs:124` | `std::option::Option::None` |
| helix-editor/helix | `helix-event/src/cancel.rs:223` | `std::assert!` |
| actix/actix-web | `actix-http/src/responses/builder.rs:70` | `std::option::Option::Some` |
| BurntSushi/ripgrep | `crates/matcher/tests/util.rs:33` | `std::result::Result::Ok` |
| clap-rs/clap | `clap_builder/src/error/format.rs:298` | `std::option::Option::Some` |
| tree-sitter/tree-sitter | `crates/xtask/src/build_wasm.rs:521` | `std::option::Option::Some` |
| helix-editor/helix | `helix-core/src/command_line.rs:884` | `std::result::Result::Ok` |
| tree-sitter/tree-sitter | `crates/cli/src/tests/node_test.rs:860` | `std::assert_eq!` |
| cberner/redb | `tests/integration_tests.rs:2883` | `std::mem::drop` |
| rust-lang/mdBook | `src/cmd/watch/native.rs:132` | `std::vec::Vec` |
| BurntSushi/ripgrep | `crates/core/flags/defs.rs:396` | `std::assert_eq!` |
| tauri-apps/tauri | `crates/tauri/src/ipc/command.rs:300` | `std::result::Result::Ok` |
| helix-editor/helix | `helix-term/src/ui/completion.rs:529` | `std::option::Option::None` |
| helix-editor/helix | `helix-vcs/src/diff.rs:136` | `ropey::Rope` |
