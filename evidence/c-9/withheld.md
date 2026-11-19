# Withheld Rust library paths

The replay used all 18 finished candidate graphs and the final resolver.
It compared every replayed library decision with the stored decision.
Both passes include the Cargo, macro spelling, and namespace fixes. They
differ only in whether an explicit module import can survive the opaque
items in its module. See [the replay script](withheld.mjs).

The counts cover stored link sites with a recognizable outside anchor in a
relaxed lookup, including names the edition prelude could supply. These
are plausible library uses. A hidden binding can still select a different
target. Sites without a recognizable anchor are outside this count. The
table counts each site once under its primary reason. If removing a blocker
reveals another, the site moves to that reason. A combined scope refusal
that includes opacity is counted under opaque scope.

| Primary reason | Before the import rule | After the import rule |
| --- | ---: | ---: |
| Opaque macro or attribute scope | 108,545 | 94,729 |
| Competing import or glob | 4,911 | 4,979 |
| Cargo edge uncertainty | 926 | 1,116 |
| Unknown associated owner | 6,199 | 8,510 |
| Other | 17,989 | 22,818 |
| **Total** | **138,570** | **132,152** |

The rule recovered **6,418** named library links. It recovered **468** on
Serde, where some previously opaque `Token::member` sites move to the
associated-owner category once the import itself can be followed.

- **Opaque scope.** Helix's `diagnostic.rs:42` uses prelude `Option` for a
  field. The same module invokes `slotmap::new_key_type!` at line 83. The
  resolver has no proof of the item names that expansion can introduce in
  the module. [Pinned source](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-core/src/diagnostic.rs#L38-L86)
- **Other.** The largest component is 10,720 imports whose export namespace
  is unavailable. Helix's `use dashmap::DashMap` at `syntax.rs:8` proves
  the crate path. The resolver's namespace catalogue has no entry for that
  export. Another 7,780 sites lack a proven binding, and 4,299 have unverified
  placement or other site context. [Pinned source](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-term/src/commands/syntax.rs#L8)
- **Unknown associated owner.** Serde imports `serde_test::Token` on line 15
  and writes `Token::Str("a")` on line 1657. The crate and type path can be
  followed. This site calls the associated name `Str`, which requires its
  own proof. Public documentation identifies `Str` as a variant, and the
  project snapshot lacks that declaration. [Pinned source](https://github.com/serde-rs/serde/blob/e306b0c7c40ad21d5bdf52bcd20da513904682ae/test_suite/tests/test_de.rs#L1657) · [Public variant documentation](https://docs.rs/serde_test/latest/serde_test/enum.Token.html#variant.Str)

After the rule, the recorded scopes for opaque refusals include 20,831
distinct macro or attribute sites. The available definition proof establishes
that **144** cannot introduce a competing named item into that scope. These
are 101 project `macro_rules!` invocations, 31 thiserror derives, and 12
standard macro invocations. There were zero additional proven invocations
of the audited tracing, log, or anyhow macros in this set. The 144 known
invocations occur among possible blockers for 3,254 withheld links. Some of
those links also have a blocker from another expansion. Before the rule the
same 144 known sites occurred among blockers for 3,811 links. This is a
conservative count based on the available macro definitions and binding proofs.

## Per-pin counts

Each reason cell shows before → after the module import rule.

| Pin | Opaque scope | Import or glob | Cargo edge | Associated owner | Other | Recovered |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| actix/actix-web | 14,155 → 12,228 | 473 → 478 | 386 → 484 | 406 → 542 | 801 → 1,687 | 802 |
| alacritty/alacritty | 4,739 → 4,039 | 132 → 133 | 19 → 19 | 248 → 285 | 344 → 564 | 442 |
| BurntSushi/ripgrep | 732 → 656 | 17 → 17 | 24 → 24 | 309 → 309 | 272 → 286 | 62 |
| cberner/redb | 4,518 → 3,981 | 346 → 346 | 30 → 30 | 480 → 596 | 2,264 → 2,337 | 348 |
| clap-rs/clap | 2,342 → 2,248 | 220 → 220 | 0 → 0 | 214 → 214 | 179 → 201 | 72 |
| crossbeam-rs/crossbeam | 508 → 427 | 124 → 124 | 0 → 0 | 670 → 671 | 1,671 → 1,680 | 71 |
| DioxusLabs/dioxus | 20,632 → 19,326 | 1,661 → 1,672 | 41 → 42 | 1,004 → 1,017 | 1,162 → 1,803 | 640 |
| fjall-rs/fjall | 1,412 → 1,308 | 7 → 7 | 0 → 0 | 228 → 228 | 211 → 310 | 5 |
| helix-editor/helix | 13,677 → 12,670 | 748 → 758 | 232 → 232 | 472 → 513 | 495 → 840 | 611 |
| ratatui/ratatui | 5,569 → 5,114 | 91 → 99 | 22 → 22 | 472 → 488 | 1,923 → 2,184 | 170 |
| rust-embedded/cortex-m | 491 → 412 | 15 → 15 | 1 → 1 | 57 → 60 | 170 → 187 | 59 |
| rust-lang/mdBook | 1,271 → 1,052 | 72 → 76 | 0 → 0 | 207 → 207 | 191 → 251 | 155 |
| RustCrypto/hashes | 863 → 428 | 4 → 4 | 0 → 1 | 20 → 20 | 585 → 955 | 64 |
| rustls/rustls | 3,240 → 2,772 | 68 → 68 | 0 → 0 | 340 → 380 | 4,364 → 4,516 | 276 |
| serde-rs/serde | 4,502 → 2,206 | 66 → 66 | 0 → 0 | 84 → 1,831 | 2,155 → 2,236 | 468 |
| tauri-apps/tauri | 13,420 → 11,686 | 690 → 698 | 154 → 222 | 666 → 728 | 616 → 1,185 | 1,027 |
| tokio-rs/axum | 8,080 → 6,841 | 57 → 65 | 12 → 24 | 181 → 237 | 268 → 1,017 | 414 |
| tree-sitter/tree-sitter | 8,394 → 7,335 | 120 → 133 | 5 → 15 | 141 → 184 | 318 → 579 | 732 |
