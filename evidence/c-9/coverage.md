# Rust Level 2 coverage

Both builds finished the same 18 Rust pins. These figures count Rust links in
those pins across all scopes. The coverage-plan overlay also includes Rust
links in repositories whose primary language is Go or TypeScript.

- **All sites** went from **33.53% to 32.13%**. Main credited 309,617 of 923,374 links. The candidate credited 304,296 of 947,018.
- **Sites shared with main** went from **33.53% to 32.52%**. The candidate credited 300,279 of the same 923,374 links.
- **Stored library symbols** supplied 78,048 links, or 8.24 percentage points of the all-sites score and 25.65% of the credited links. Another 224 stored targets name a whole crate and earn Level 1 credit.

Main reconstructed 83,369 named library uses. On the shared sites, the
candidate stored 74,031 named library uses with graph evidence. The new
attribute and derive references add 23,644 sites, of which 4,017 name
library symbols. The candidate's library numerator comes entirely from stored
targets. [Withheld paths by reason](withheld.md)

Scope and edge proofs account for differences from the first PR head. In
RustCrypto/hashes, limiting the workspace patch to `sha1` and `whirlpool`
helped raise stored library symbols from 205 to 1,014 and all-sites Level 2
from 26.17% to 32.44%. On Serde, the explicit module import rule recovers
468 named links. Serde goes from 36.47% on main to 17.15% on the first PR
head and 19.00% with the review changes. Unknown associated owners and
unverified placements still account for many withheld Serde links.
[First PR head measurements](https://github.com/KarlLivesey/pymtheg/blob/fbb4a27837322b5bcb83b22bc2a659147f1471b9/evidence/c-9/coverage.md)

| Pin | Main links | Main Level 2 | Candidate links | Candidate Level 2 | Candidate on main sites | Stored library symbols |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | 39,086 | 41.68% | 39,819 | 53.97% | 53.35% | 7,770 |
| DioxusLabs/dioxus | 145,714 | 37.30% | 149,592 | 33.98% | 34.33% | 13,616 |
| RustCrypto/hashes | 12,870 | 40.69% | 12,911 | 32.44% | 32.54% | 1,014 |
| actix/actix-web | 85,053 | 31.02% | 86,640 | 29.26% | 29.42% | 7,061 |
| alacritty/alacritty | 30,052 | 39.39% | 30,965 | 35.62% | 36.31% | 2,454 |
| cberner/redb | 73,191 | 29.04% | 73,731 | 30.96% | 31.08% | 4,497 |
| clap-rs/clap | 50,949 | 26.96% | 52,417 | 30.08% | 30.22% | 4,633 |
| crossbeam-rs/crossbeam | 33,904 | 31.10% | 34,081 | 34.30% | 34.39% | 4,016 |
| fjall-rs/fjall | 13,235 | 36.03% | 13,361 | 36.80% | 36.60% | 1,956 |
| helix-editor/helix | 86,088 | 33.18% | 90,583 | 33.59% | 34.79% | 7,658 |
| ratatui/ratatui | 57,390 | 31.34% | 60,424 | 28.68% | 29.84% | 1,725 |
| rust-embedded/cortex-m | 5,200 | 54.10% | 5,531 | 48.89% | 51.83% | 553 |
| rust-lang/mdBook | 12,374 | 37.60% | 12,557 | 39.71% | 39.84% | 2,130 |
| rustls/rustls | 69,251 | 26.91% | 69,929 | 22.42% | 22.55% | 1,789 |
| serde-rs/serde | 29,641 | 36.47% | 30,714 | 19.00% | 19.63% | 717 |
| tauri-apps/tauri | 85,873 | 36.36% | 88,051 | 35.75% | 36.20% | 9,717 |
| tokio-rs/axum | 39,918 | 35.20% | 41,067 | 27.14% | 27.55% | 2,476 |
| tree-sitter/tree-sitter | 53,585 | 30.74% | 54,645 | 30.40% | 30.64% | 4,266 |

## Preservation

The comparison checked 97,654 symbol keys, all 226,248 definite Rust
checkout links, and all 223,849 Rust receiver-call decisions across the 18
pins. Every symbol key and definite target matched, there were zero new
symbols, and the receiver decisions and candidate memberships matched.
Comparison used the pinned file, source span and link kind, followed by
the target's file, symbol key, scoped identity and ordinal.
[Comparison script](compare.mjs)

## Reference sample sites settled

These 22 of 88 `rust-std-path` sites in the SW-3 draw now have a stored
library symbol. The representation row records the stored library links.
The candidate stores 21,050 macro references by path, including derive and
attribute paths. Checkout macro expansion remains open in the plan.

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
| ratatui/ratatui | `ratatui-termion/src/lib.rs:276` | `termion::terminal_size` |
| helix-editor/helix | `helix-vcs/src/diff.rs:136` | `ropey::Rope` |
| tauri-apps/tauri | `crates/tauri/src/ipc/authority.rs:1541` | `serde_json::json!` |
| actix/actix-web | `actix-http/src/requests/request.rs:150` | `http::Version` |
