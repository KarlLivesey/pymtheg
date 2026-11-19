# C-12 review corrections

The scope proof follows absolute invocations and paths rooted at `$crate`.
The call and argument scanners keep their existing site inventory.
`cargo check --offline` confirmed that `::core::include!` supplies the local
`Option` and that a wrapped `::std::thread_local!` supplies the local
`LAZY`. The graph withholds both targets. The unrelated standard
`Option` still resolves beside the thread-local declaration.
[Compiler fixture](../../test/fixtures/graph-rust-macro-scope/src/lib.rs)

The external compiler control used cached `tonic` 0.14.9 and
`derive_builder` 0.20.2. Tonic loads a generated `Option` from the output
directory. The derive emits the `ConfigBuilder` used inside the function.
Both controls compiled offline. SQLx was unavailable offline, so the
graph fixture tests the written `sqlx::migrate!()` input and the local
compiler fixture uses an empty-input loader stand-in.
[External compiler fixture](../../test/fixtures/graph-rust-macro-scope/external/src/lib.rs) · [Graph tests](../../test/graph-rust-macro-scope.test.mjs)

The five additional generator-package exclusions were checked against all
428 captured Cargo manifests on the 18 pins. None names any of the
packages, including underscore spellings. The exclusion is evaluated
only after Cargo proves the package identity, so the pin sweep applies
to the final exclusion list as well.

The coverage plan copies main's Go and TypeScript sections verbatim.
The 195,042-byte archive and the regeneration test cover the Rust section.
[Regeneration command](../../sweep/README.md#reproduce-the-committed-rust-plan)

## Pinned scores

The candidate cold-indexed all 18 pins. The main counts carry forward
the previous 18-pin measurement because main's Rust parser and resolver
match that baseline. Three pins were also cold-indexed again on current
main `981b20d`. The comparison preserved every one of their 67,433
definite decisions and 34,238 receiver decisions. Both comparisons found
zero added or removed Rust sites and zero changed symbol keys.
[Comparison script](compare.mjs)

| Pin | Rust sites | Main | Proofs | Proofs + assumptions | Assumed links |
| --- | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | 39,819 | 64.74% | 65.42% | 65.43% | 1 |
| DioxusLabs/dioxus | 149,592 | 42.18% | 42.18% | 44.15% | 2,939 |
| RustCrypto/hashes | 12,911 | 45.28% | 45.28% | 46.04% | 98 |
| actix/actix-web | 86,640 | 36.26% | 36.30% | 39.23% | 2,540 |
| alacritty/alacritty | 30,965 | 44.73% | 44.95% | 45.47% | 163 |
| cberner/redb | 73,731 | 40.99% | 41.18% | 41.32% | 102 |
| clap-rs/clap | 52,417 | 35.68% | 35.74% | 35.82% | 40 |
| crossbeam-rs/crossbeam | 34,081 | 50.93% | 51.18% | 51.18% | 0 |
| fjall-rs/fjall | 13,361 | 44.32% | 44.32% | 45.04% | 97 |
| helix-editor/helix | 90,583 | 41.08% | 41.10% | 43.35% | 2,040 |
| ratatui/ratatui | 60,424 | 36.25% | 36.26% | 39.18% | 1,768 |
| rust-embedded/cortex-m | 5,531 | 54.62% | 54.75% | 54.89% | 8 |
| rust-lang/mdBook | 12,557 | 49.15% | 49.80% | 52.95% | 396 |
| rustls/rustls | 69,929 | 27.13% | 27.16% | 27.58% | 299 |
| serde-rs/serde | 30,714 | 26.96% | 26.96% | 26.96% | 0 |
| tauri-apps/tauri | 88,051 | 43.53% | 43.55% | 47.17% | 3,192 |
| tokio-rs/axum | 41,067 | 35.19% | 35.20% | 37.72% | 1,035 |
| tree-sitter/tree-sitter | 54,645 | 36.32% | 36.33% | 40.37% | 2,205 |
| **Total** | **947,018** | **40.17%** | **40.25%** | **42.04%** | **16,923** |

All-sites and like-for-like use the same denominator and numerators
of 380,384, 381,170, and 398,093. Relative to the archived `ca9d20d` sweep
cited by `c64c1cf`, 61 assumed checkout links and 12 assumed library links
became unresolved. One new proof on cortex-m offsets one withdrawal in
the total.

The new link is `atomic::compiler_fence` in `panic-itm`. The import binds
`atomic` to `core::sync::atomic`. The three `iprintln!` arms call
`$crate::itm` functions and formatting macros, with no caller-scope item
named `atomic`. [Pinned call and import](https://github.com/rust-embedded/cortex-m/blob/b79801ce4884fe46105b562f701a7d2fd5c586c7/panic-itm/src/lib.rs#L39-L58) · [Pinned macro](https://github.com/rust-embedded/cortex-m/blob/b79801ce4884fe46105b562f701a7d2fd5c586c7/cortex-m/src/macros.rs#L14-L24) · [Library declaration](https://doc.rust-lang.org/core/sync/atomic/fn.compiler_fence.html)

## Withdrawn assumptions

The replay checked the original targets for all 16,996 marked links
against the final captured facts. It reproduced the withdrawals with
both restrictions, then disabled each restriction separately while
keeping the absolute-path proof fix and the generator exclusions. Each
withdrawn target returned under exactly one of those counterfactuals.

| Pin | No item-name identifier in function-like input | Derived item-name components |
| --- | ---: | ---: |
| DioxusLabs/dioxus | 0 | 2 |
| actix/actix-web | 0 | 2 |
| fjall-rs/fjall | 4 | 0 |
| helix-editor/helix | 0 | 1 |
| ratatui/ratatui | 1 | 0 |
| rust-lang/mdBook | 0 | 3 |
| tauri-apps/tauri | 0 | 54 |
| tree-sitter/tree-sitter | 0 | 6 |
| **Total** | **5** | **68** |

The additional generator packages account for zero withdrawals on these
pins. The final graph retains 16,923 assumed links.

## Assumption audit

The fixed seed `c12-rust-macro-scope-2026-11-19` drew ten surviving assumed
links from each of the six selected pins. All 60 ranks and targets
matched the prior audited draw. The pinned source and macro references
for each site remain listed in that audit.
[Source and macro audit](source-audit.md)

## Validation

The dev-server build, type check, format check, and both offline Cargo
controls passed. The focused Rust macro, MCP, and sweep run passed all
404 tests. The regenerated plan passed all 21 sweep tests. The full
suite passed all 3,090 tests after the MCP legend update.

## Shared macro definitions across Cargo targets

Both new fixtures passed offline `cargo check`. In each, the shared
module's `Option` is the prelude type in one target and the helper's
generated type in the other. Both graph tests reproduce the unmarked
prelude target with the old first-owner lookup. The corrected graph
withholds both links and resolves `Option` in both single-owner twins.
[Library and binary](../../test/fixtures/graph-rust-macro-scope/lib-and-bin/src/shared.rs) · [Integration tests](../../test/fixtures/graph-rust-macro-scope/integration-tests/tests/common/mod.rs)

The ownership scan used the resolver's module placements and captured
macro profiles. It found both fixture wrappers and found no affected
definitions on the 18 pinned repositories. Helix, Ratatui and Serde were
cold-indexed again. The other 15 pins reused their reviewed stores. The
exact comparison with `12ad591` found no decision, site or symbol-key
changes. The three fresh stores preserved all 67,433 definite decisions
and 34,238 receiver decisions from main `981b20d`, with identical sites
and symbol keys. Main's Rust source matches the measured baseline.
[Comparison script](compare.mjs)

All-site and like-for-like Rust Level 2 both use 947,018 sites. Main is
380,384 (40.17%), proofs reach 381,170 (40.25%), and including 16,923
assumed links reaches 398,093 (42.04%). The existing input still
regenerates the committed Rust plan.

The dev-server build, type check, format check, 379 Rust macro tests and
21 sweep tests passed.
