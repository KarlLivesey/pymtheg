# C-18 source audit

The fixed seed `c18-identity-2026-11-19` selected five newly proved and five
newly assumption-backed links in each of six pinned repositories. Every
entry below was checked at its written use, against its import or declaration
where present, and against the relevant macro's documented output or source.
The corrected draw retained 56 of the original checked sites.
The draw found **60 right, 0 wrong, 0 cannot tell**. Thirty entries were
proved. `A` denotes `rust-external-macro-name`. [Draw script](draw.mjs)

The corrected graph withholds the original assumption-backed
`BoxedWindow` and `Vec` links at
`ratatui/tests/stateful_widget_ref_dyn.rs:58`, the `mime::AUDIO` link
at `actix-files/src/named.rs:106`, and the `assert_eq!` link at
`skein/tests/mod.rs:56`. The four replacement rows below use the
original seed and the corrected graph.

## Axum

The routing and redirect sites use prelude types and standard assertions.
`Service` is the explicit `tower_service` import. The serve module imports
`Response` from `axum_core` and re-exports `Listener` from its child module.
The two `pin_project_lite` sites use their written pin projection macros.
Those invocations introduce projections and trait implementations on the
declared struct. The benchmark's Serde derives add trait implementations
for its payload type, and Tokio's test attribute wraps each named test.
[Pinned source](https://github.com/tokio-rs/axum/tree/36d38c4cf2766cd7313dd53d808f30546ee36b1e) · [Pin projection macro](https://docs.rs/pin-project-lite/latest/pin_project_lite/macro.pin_project.html) · [Serde derive](https://serde.rs/derive.html) · [Tokio test](https://docs.rs/tokio/1.54.1/tokio/attr.test.html)

| Site | Checked target | Basis |
| --- | --- | --- |
| `axum/src/routing/mod.rs:587` | `std::result::Result` | Proof |
| `axum/src/routing/mod.rs:728` | `std::option::Option::Some` | Proof |
| `axum/src/serve/mod.rs:523` | `axum-core/src/response/mod.rs:25 Response` | Proof |
| `axum/src/routing/mod.rs:297` | `tower-service::Service` | Proof |
| `axum/src/response/redirect.rs:159` | `std::assert_eq!` | Proof |
| `axum/src/util.rs:119` | `std::option::Option::Some` | A |
| `axum/benches/benches.rs:6` | `axum/src/routing/mod.rs:86 Router` | A |
| `axum/src/middleware/from_extractor.rs:173` | `std::clone::Clone` | A |
| `axum/src/serve/mod.rs:978` | `axum/src/serve/listener.rs:16 Listener` | A |
| `axum/src/util.rs:46` | `std::ops::Deref` | A |

## Ratatui

The `WrappedLine` and selection helper declarations are in their enclosing
modules. The Termina tests use the standard `assert_eq!` and build cursor
sequences inside expressions. The task runner's `Subcommand` derive
implements Clap traits for its enum. Its `cmd!` call comes from the
explicit Duct import. The build and feature-test argument lists use
the standard `vec!` macro.
[Pinned source](https://github.com/ratatui/ratatui/tree/60feb0eb09789f4c0ed11c0c532bb605689fbbc0) · [Clap derive](https://docs.rs/clap/4.6.7/clap/_derive/index.html) · [Duct cmd](https://docs.rs/duct/1.1.2/duct/macro.cmd.html) · [Standard vec macro](https://doc.rust-lang.org/std/macro.vec.html)

| Site | Checked target | Basis |
| --- | --- | --- |
| `ratatui-widgets/src/reflow.rs:392` | `ratatui-widgets/src/reflow.rs:20 WrappedLine` | Proof |
| `ratatui-termina/src/lib.rs:648` | `std::assert_eq!` | Proof |
| `ratatui-termina/src/lib.rs:690` | `std::assert_eq!` | Proof |
| `ratatui-widgets/src/table.rs:2497` | `ratatui-widgets/src/table.rs:2248 test_table_with_selection` | Proof |
| `ratatui-termina/src/lib.rs:634` | `std::assert_eq!` | Proof |
| `xtask/src/commands.rs:135` | `std::vec!` | A |
| `xtask/src/commands.rs:158` | `std::vec!` | A |
| `xtask/src/commands.rs:212` | `std::vec!` | A |
| `xtask/src/commands.rs:153` | `std::result::Result::Ok` | A |
| `xtask/src/commands.rs:152` | `duct::cmd!` | A |

## Actix Web

The standard macros are in written test bodies, and the route helper uses
the enclosing `RouteInfo` declaration. The dispatcher explicitly imports
both Tokio names. The WebSocket dispatcher uses the standard `write!`
beside `pin_project_lite::pin_project!`, whose transcriber generates code
for the input struct's pin projections. The WebSocket codec uses `Err`
beside its `Flags` bitflags declaration. The rustls client test uses
Tokio's test wrapper and the standard `Result` type.
[Pinned source](https://github.com/actix/actix-web/tree/3c6ea6acf52d9e6f41207222b672774246be7205) · [Pin Project Lite transcriber](https://docs.rs/pin-project-lite/latest/src/pin_project_lite/lib.rs.html) · [Bitflags macro](https://docs.rs/bitflags/2.13.2/bitflags/macro.bitflags.html) · [Tokio test](https://docs.rs/tokio/1.54.1/tokio/attr.test.html)

| Site | Checked target | Basis |
| --- | --- | --- |
| `actix-web/src/http/header/range.rs:359` | `std::assert_eq!` | Proof |
| `actix-web/src/http/header/content_disposition.rs:1018` | `std::format!` | Proof |
| `actix-web/src/introspection.rs:1057` | `actix-web/src/introspection.rs:48 RouteInfo` | Proof |
| `actix-web/src/http/header/content_disposition.rs:657` | `std::vec!` | Proof |
| `actix-web/src/guard/host.rs:232` | `std::assert!` | Proof |
| `actix-http/src/h1/dispatcher.rs:1507` | `tokio::time::sleep_until` | A |
| `actix-http/src/ws/dispatcher.rs:143` | `std::write!` | A |
| `actix-http/src/h1/dispatcher.rs:366` | `tokio::io::AsyncWrite` | A |
| `actix-http/src/ws/codec.rs:260` | `std::result::Result::Err` | A |
| `awc/tests/test_rustls_client.rs:61` | `std::result::Result` | A |

## mdBook

The five assertions use the standard macro. The module's `static_regex!`
calls declare `ANCHOR_START` and `ANCHOR_END` from their input names. The
configuration tests use standard `vec!` and `assert_eq!` beside the Serde
derive on their local type. The clean command imports `MDBook` through its
public `mdbook_driver` export.
[Pinned source](https://github.com/rust-lang/mdBook/tree/7f307f5e845284f41adeaf7f18f4783f7711343c) · [Standard assertions](https://doc.rust-lang.org/std/macro.assert_eq.html) · [Serde derive](https://serde.rs/derive.html)

| Site | Checked target | Basis |
| --- | --- | --- |
| `crates/mdbook-driver/src/builtin_preprocessors/links/take_lines.rs:192` | `std::assert_eq!` | Proof |
| `crates/mdbook-driver/src/builtin_preprocessors/links/take_lines.rs:156` | `std::assert_eq!` | Proof |
| `crates/mdbook-driver/src/builtin_preprocessors/links/take_lines.rs:198` | `std::assert_eq!` | Proof |
| `crates/mdbook-driver/src/builtin_preprocessors/links/take_lines.rs:128` | `std::assert_eq!` | Proof |
| `crates/mdbook-driver/src/builtin_preprocessors/links/take_lines.rs:144` | `std::assert_eq!` | Proof |
| `crates/mdbook-core/src/config.rs:1079` | `std::vec!` | A |
| `crates/mdbook-core/src/config.rs:1076` | `std::assert_eq!` | A |
| `src/cmd/clean.rs:5` | `crates/mdbook-driver/src/mdbook.rs:29 MDBook` | A |
| `crates/mdbook-core/src/config.rs:1081` | `std::assert_eq!` | A |
| `crates/mdbook-core/src/config.rs:1070` | `std::vec!` | A |

## RustCrypto hashes

The JH manifest renames `ppv-lite86` to `simd`. The grouped import and the
dependency's exports match `Machine` and `vec128_storage`. The `U64` import
comes from Digest's array re-export. `rustfmt::skip` leaves `unroll7` intact
and its literal transcriber names are block-local. The Belt hash test uses
the `hex_literal::hex` import. Digest's `new_test!` and
`hash_serialization_test!` bodies each create the test function named by
their first input. Their local imports and assertions are inside that
function.
[Pinned source](https://github.com/RustCrypto/hashes/tree/c50eeb468b26629bbd1177620733a32a084d6f86) · [Digest test transcribers](https://docs.rs/digest/0.11.3/src/digest/dev.rs.html) · [PPV exports](https://docs.rs/ppv-lite86/0.2.21/src/ppv_lite86/lib.rs.html) · [Hex literal](https://docs.rs/hex-literal/1.1.0/hex_literal/macro.hex.html)

| Site | Checked target | Basis |
| --- | --- | --- |
| `jh/src/compressor.rs:153` | `ppv-lite86::vec128_storage` | Proof |
| `jh/src/compressor.rs:165` | `digest::array::typenum::U64` | Proof |
| `jh/src/compressor.rs:79` | `ppv-lite86::Machine` | Proof |
| `belt-hash/src/block_api.rs:218` | `hex-literal::hex!` | Proof |
| `jh/src/compressor.rs:33` | `ppv-lite86::Machine` | Proof |
| `ripemd/tests/mod.rs:76` | `std::assert_eq!` | A |
| `gost94/tests/mod.rs:91` | `std::assert_eq!` | A |
| `sha2/tests/mod.rs:26` | `std::assert_eq!` | A |
| `ripemd/tests/mod.rs:15` | `digest::hash_serialization_test!` | A |
| `sha1-checked/tests/mod.rs:81` | `hex-literal::hex!` | A |

## Helix

The LSP test helper resolves by its `crate::tests` import. `TextAnnotations`
and `Overlay` are named imports from `helix_core`. The document selector
uses `thiserror::Error` for the separate error type. The `graphics` and
filesystem sites are beside declared bitflags types. Serde implements
traits for DAP payloads in `transport.rs`; `Transport` is the separate
written struct imported by the client.
[Pinned source](https://github.com/helix-editor/helix/tree/872b240251876e56787ad7ec312cefae70e3e28e) · [Bitflags macro](https://docs.rs/bitflags/2.13.2/bitflags/macro.bitflags.html) · [Serde derive](https://serde.rs/derive.html) · [Thiserror derive](https://docs.rs/thiserror/latest/thiserror/)

| Site | Checked target | Basis |
| --- | --- | --- |
| `helix-lsp-types/src/semantic_tokens.rs:553` | `helix-lsp-types/src/lib.rs:2771 test_serialization` | Proof |
| `helix-core/src/doc_formatter.rs:227` | `std::option::Option::None` | Proof |
| `helix-core/src/graphemes.rs:154` | `std::result::Result::Err` | Proof |
| `helix-view/src/view.rs:14` | `helix-core/src/text_annotations.rs:278 TextAnnotations` | Proof |
| `helix-tui/src/widgets/block.rs:355` | `std::assert_eq!` | Proof |
| `helix-view/src/graphics.rs:771` | `std::assert_eq!` | A |
| `helix-stdx/src/faccess.rs:67` | `std::result::Result::Ok` | A |
| `helix-dap/src/transport.rs:62` | `std::marker::Unpin` | A |
| `helix-dap/src/client.rs:4` | `helix-dap/src/transport.rs:53 Transport` | A |
| `helix-view/src/document.rs:14` | `helix-core/src/text_annotations.rs:68 Overlay` | A |
