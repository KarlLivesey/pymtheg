# C-12 source audit

The seed is `c12-rust-macro-scope-2026-11-19`. The comparison ranks stable source-site keys by SHA-256. The proven draw takes the twenty lowest site ranks across the matched pins. The assumption-backed draw takes ten sites from each of the six lowest-ranked pins with at least ten newly credited assumed sites. [Sampling command](compare.mjs)

## Proven sites

The twenty source sites and their declarations or standard paths matched. For checkout paths, the written aliases and re-exports were followed to their source declarations. [Rust standard prelude](https://doc.rust-lang.org/std/prelude/index.html) · [Standard macros](https://doc.rust-lang.org/std/index.html#macros)

| Stored kind | Written name | Target | Pinned source |
| --- | --- | --- | --- |
| calls | `Some` | `std::option::Option::Some` | [`crates/printer/src/standard.rs:2498`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L2498) |
| macros | `vec` | `std::vec!` | [`crates/printer/src/standard.rs:2604`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L2604) |
| calls | `printer_contents` | `crates/printer/src/standard.rs · tests::printer_contents` | [`crates/printer/src/standard.rs:2818`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L2818) |
| patterns | `Ok` | `std::result::Result::Ok` | [`alacritty/src/main.rs:191`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/main.rs#L191) |
| imports | `crate::StorageError` | `src/error.rs · StorageError` | [`src/tree_store/extract_if.rs:5`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/src/tree_store/extract_if.rs#L5) |
| macros | `vec` | `std::vec!` | [`crates/printer/src/standard.rs:2681`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L2681) |
| calls | `printer_contents` | `crates/printer/src/summary.rs · tests::printer_contents` | [`crates/printer/src/summary.rs:1101`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/summary.rs#L1101) |
| imports | `mdbook_core::static_regex` | `crates/mdbook-core/src/utils/mod.rs · static_regex` | [`crates/mdbook-driver/src/builtin_preprocessors/links/take_lines.rs:1`](https://github.com/rust-lang/mdBook/blob/7f307f5e845284f41adeaf7f18f4783f7711343c/crates/mdbook-driver/src/builtin_preprocessors/links/take_lines.rs#L1) |
| calls | `printer_contents` | `crates/printer/src/standard.rs · tests::printer_contents` | [`crates/printer/src/standard.rs:3018`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L3018) |
| macros | `panic` | `std::panic!` | [`crossbeam-channel/tests/golang.rs:1510`](https://github.com/crossbeam-rs/crossbeam/blob/a28f40fdddb70bea8e5faf0efad9af0be4b9dbea/crossbeam-channel/tests/golang.rs#L1510) |
| calls | `process::exit` | `std::process::exit` | [`bogo/src/main.rs:779`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/bogo/src/main.rs#L779) |
| types | `Box` | `std::boxed::Box` | [`alacritty/src/main.rs:97`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/main.rs#L97) |
| macros | `vec` | `std::vec!` | [`crates/printer/src/standard.rs:2907`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L2907) |
| calls | `compile_path_regex` | `helix-stdx/src/path.rs · compile_path_regex` | [`helix-stdx/src/path.rs:430`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-stdx/src/path.rs#L430) |
| imports | `crate::SetDurabilityError` | `src/error.rs · SetDurabilityError` | [`src/db.rs:4308`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/src/db.rs#L4308) |
| imports | `crate::gl` | `alacritty/src/main.rs · gl` | [`alacritty/src/renderer/text/atlas.rs:6`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/renderer/text/atlas.rs#L6) |
| calls | `Some` | `std::option::Option::Some` | [`crates/printer/src/standard.rs:2935`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L2935) |
| imports | `redb::MultimapValue` | `src/multimap_table.rs · MultimapValue` | [`tests/integration_tests.rs:11`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/tests/integration_tests.rs#L11) |
| imports | `menu::MenuBuilder` | `crates/tauri/src/menu/builders/menu.rs · MenuBuilder` | [`crates/tauri/src/menu/builders/mod.rs:10`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri/src/menu/builders/mod.rs#L10) |
| calls | `printer_contents` | `crates/printer/src/standard.rs · tests::printer_contents` | [`crates/printer/src/standard.rs:3664`](https://github.com/BurntSushi/ripgrep/blob/178cc027e283fd965cb72d0a7395b219eada170c/crates/printer/src/standard.rs#L3664) |

## Assumption-backed sites

The sixty links matched their pinned targets. The public macro output contracts and the invocation inputs showed no competing declaration for any of the checked lookup names. The draw had zero failures.

### alacritty/alacritty

Serde generates serialization implementations for IPC and CLI data. The keyboard macro defines the input name `SequenceModifiers` and its flag operations. Clap derives implement command parsing for the CLI types. The sampled lookups reach the written standard or Winit binding. [Serde derives](https://serde.rs/derive.html) · [Bitflags](https://docs.rs/bitflags/latest/bitflags/macro.bitflags.html) · [Clap derives](https://docs.rs/clap/latest/clap/_derive/index.html)

| Stored kind | Written name | Target | Pinned source |
| --- | --- | --- | --- |
| macros | `println` | `std::println!` | [`alacritty/src/polling/ipc.rs:129`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/polling/ipc.rs#L129) |
| types | `Option` | `std::option::Option` | [`alacritty/src/input/keyboard.rs:587`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/input/keyboard.rs#L587) |
| calls | `Ok` | `std::result::Result::Ok` | [`alacritty/src/polling/ipc.rs:149`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/polling/ipc.rs#L149) |
| types | `EventLoopProxy` | `winit::event_loop::EventLoopProxy` | [`alacritty/src/polling/ipc.rs:34`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/polling/ipc.rs#L34) |
| patterns | `Some` | `std::option::Option::Some` | [`alacritty/src/input/keyboard.rs:351`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/input/keyboard.rs#L351) |
| types | `Rc` | `std::rc::Rc` | [`alacritty/src/cli.rs:399`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/cli.rs#L399) |
| patterns | `Err` | `std::result::Result::Err` | [`alacritty/src/polling/ipc.rs:207`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/polling/ipc.rs#L207) |
| calls | `env::set_var` | `std::env::set_var` | [`alacritty/src/polling/ipc.rs:42`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/polling/ipc.rs#L42) |
| types | `KeyEvent` | `winit::event::KeyEvent` | [`alacritty/src/input/keyboard.rs:429`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/input/keyboard.rs#L429) |
| calls | `Ok` | `std::result::Result::Ok` | [`alacritty/src/polling/ipc.rs:205`](https://github.com/alacritty/alacritty/blob/aa5d942f46c40184a3f214830ff5f7989f4733a1/alacritty/src/polling/ipc.rs#L205) |

### cberner/redb

Arbitrary derives implement the trait on the operation and input types. The fuzzer wrapper supplies the fuzz entry points. The sampled bindings are standard paths, explicitly imported Arbitrary paths and the checkout trait exported as `redb::StorageBackend`. [Arbitrary derive](https://docs.rs/derive_arbitrary/latest/derive_arbitrary/derive.Arbitrary.html) · [Fuzz target implementation](https://docs.rs/libfuzzer-sys/latest/src/libfuzzer_sys/lib.rs.html)

| Stored kind | Written name | Target | Pinned source |
| --- | --- | --- | --- |
| calls | `black_box` | `std::hint::black_box` | [`fuzz/fuzz_targets/fuzz_corruption.rs:333`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/fuzz_corruption.rs#L333) |
| implements | `StorageBackend` | `src/db.rs · StorageBackend` | [`fuzz/fuzz_targets/fuzz_corruption.rs:48`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/fuzz_corruption.rs#L48) |
| patterns | `Err` | `std::result::Result::Err` | [`fuzz/fuzz_targets/fuzz_corruption.rs:281`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/fuzz_corruption.rs#L281) |
| patterns | `Ok` | `std::result::Result::Ok` | [`fuzz/fuzz_targets/fuzz_corruption.rs:294`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/fuzz_corruption.rs#L294) |
| types | `Unstructured` | `arbitrary::Unstructured` | [`fuzz/fuzz_targets/common.rs:53`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/common.rs#L53) |
| calls | `Ok` | `std::result::Result::Ok` | [`fuzz/fuzz_targets/fuzz_corruption.rs:67`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/fuzz_corruption.rs#L67) |
| calls | `Some` | `std::option::Option::Some` | [`fuzz/fuzz_targets/common.rs:64`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/common.rs#L64) |
| calls | `Some` | `std::option::Option::Some` | [`fuzz/fuzz_targets/common.rs:27`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/common.rs#L27) |
| patterns | `Ok` | `std::result::Result::Ok` | [`fuzz/fuzz_targets/fuzz_corruption.rs:262`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/fuzz_corruption.rs#L262) |
| types | `arbitrary::Result` | `arbitrary::Result` | [`fuzz/fuzz_targets/common.rs:53`](https://github.com/cberner/redb/blob/357f8bf3f554e85bff1c6c605713ae57c3901006/fuzz/fuzz_targets/common.rs#L53) |

### fjall-rs/fjall

The Serde derives implement traits on the named records. Thiserror implements the standard error traits for the example error. The structured example gets `fjall::Result` from the checkout re-export. [Serde derives](https://serde.rs/derive.html) · [Thiserror](https://docs.rs/thiserror/latest/thiserror/) · [MessagePack serde API](https://docs.rs/rmp-serde/latest/rmp_serde/)

| Stored kind | Written name | Target | Pinned source |
| --- | --- | --- | --- |
| calls | `Ok` | `std::result::Result::Ok` | [`examples_disabled/migration/src/main.rs:113`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples_disabled/migration/src/main.rs#L113) |
| types | `IntoResponse` | `axum::response::IntoResponse` | [`examples/axum-kv/src/error.rs:16`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples/axum-kv/src/error.rs#L16) |
| calls | `rmp_serde::from_slice` | `rmp-serde::from_slice` | [`examples_disabled/migration/src/main.rs:89`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples_disabled/migration/src/main.rs#L89) |
| calls | `rmp_serde::to_vec` | `rmp-serde::to_vec` | [`examples_disabled/migration/src/main.rs:94`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples_disabled/migration/src/main.rs#L94) |
| types | `fjall::Result` | `src/error.rs · Result` | [`examples/structured/src/main.rs:53`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples/structured/src/main.rs#L53) |
| calls | `Ok` | `std::result::Result::Ok` | [`examples/structured/src/main.rs:156`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples/structured/src/main.rs#L156) |
| patterns | `Some` | `std::option::Option::Some` | [`examples/structured/src/main.rs:121`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples/structured/src/main.rs#L121) |
| calls | `rmp_serde::to_vec` | `rmp-serde::to_vec` | [`examples/structured/src/main.rs:22`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples/structured/src/main.rs#L22) |
| calls | `rmp_serde::from_slice` | `rmp-serde::from_slice` | [`examples_disabled/migration/src/main.rs:80`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples_disabled/migration/src/main.rs#L80) |
| macros | `assert_eq` | `std::assert_eq!` | [`examples/structured/src/main.rs:131`](https://github.com/fjall-rs/fjall/blob/87006048139bfe1b072bbc29a5a92bf1f97628e3/examples/structured/src/main.rs#L131) |

### helix-editor/helix

Serde derives wrap their implementations in an anonymous constant. In the transport module, `ServerMessage` carries the Serde derives and `Transport` is a separate declaration. Thiserror derives the error implementation in the LSP module. The Criterion macros produce the benchmark group and the main function. [Serde expansion](https://github.com/serde-rs/serde/blob/master/serde_derive/src/ser.rs) · [Thiserror](https://docs.rs/thiserror/latest/thiserror/) · [Criterion group](https://docs.rs/criterion/latest/criterion/macro.criterion_group.html) · [Criterion main](https://docs.rs/criterion/latest/criterion/macro.criterion_main.html)

| Stored kind | Written name | Target | Pinned source |
| --- | --- | --- | --- |
| imports | `helix_loader::workspace_trust::TrustQuery` | `helix-loader/src/workspace_trust.rs · TrustQuery` | [`helix-view/src/editor.rs:19`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-view/src/editor.rs#L19) |
| types | `String` | `std::string::String` | [`helix-lsp/src/lib.rs:809`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-lsp/src/lib.rs#L809) |
| patterns | `Some` | `std::option::Option::Some` | [`helix-view/src/editor.rs:1757`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-view/src/editor.rs#L1757) |
| types | `From` | `std::convert::From` | [`helix-lsp-types/src/document_diagnostic.rs:270`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-lsp-types/src/document_diagnostic.rs#L270) |
| patterns | `Some` | `std::option::Option::Some` | [`helix-loader/src/workspace_trust.rs:211`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-loader/src/workspace_trust.rs#L211) |
| patterns | `Some` | `std::option::Option::Some` | [`helix-loader/src/workspace_trust.rs:360`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-loader/src/workspace_trust.rs#L360) |
| imports | `crate::transport::Transport` | `helix-lsp/src/transport.rs · Transport` | [`helix-lsp/src/client.rs:4`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-lsp/src/client.rs#L4) |
| macros | `include_str` | `std::include_str!` | [`helix-view/benches/word_index.rs:16`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-view/benches/word_index.rs#L16) |
| types | `String` | `std::string::String` | [`helix-lsp/src/transport.rs:46`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-lsp/src/transport.rs#L46) |
| macros | `vec` | `std::vec!` | [`helix-view/src/editor.rs:559`](https://github.com/helix-editor/helix/blob/872b240251876e56787ad7ec312cefae70e3e28e/helix-view/src/editor.rs#L559) |

### rustls/rustls

Clap supplies parser, subcommand and value-enum implementations. The benchmark imports `KeyType` from `rustls_test`. The separate CLI enum also has an `Rsa2048` variant, so the qualifier matters. [Clap derives](https://docs.rs/clap/latest/clap/_derive/index.html) · [Certificate revocation list parameters](https://docs.rs/rcgen/latest/rcgen/struct.CertificateRevocationListParams.html)

| Stored kind | Written name | Target | Pinned source |
| --- | --- | --- | --- |
| values | `KeyType::Rsa2048` | `rustls-test/src/lib.rs · KeyType::Rsa2048` | [`rustls-bench/src/main.rs:1122`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/rustls-bench/src/main.rs#L1122) |
| macros | `panic` | `std::panic!` | [`rustls-bench/src/main.rs:948`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/rustls-bench/src/main.rs#L948) |
| values | `stderr` | `std::io::stderr` | [`examples/src/bin/tls-server-mio.rs:708`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/examples/src/bin/tls-server-mio.rs#L708) |
| calls | `Ok` | `std::result::Result::Ok` | [`examples/src/bin/tls-server-mio.rs:375`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/examples/src/bin/tls-server-mio.rs#L375) |
| types | `rcgen::CertificateRevocationListParams` | `rcgen::CertificateRevocationListParams` | [`examples/src/bin/server-acceptor.rs:276`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/examples/src/bin/server-acceptor.rs#L276) |
| macros | `assert` | `std::assert!` | [`rustls-bench/src/main.rs:349`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/rustls-bench/src/main.rs#L349) |
| macros | `print` | `std::print!` | [`rustls-bench/src/main.rs:542`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/rustls-bench/src/main.rs#L542) |
| values | `None` | `std::option::Option::None` | [`examples/src/bin/tls-server-mio.rs:147`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/examples/src/bin/tls-server-mio.rs#L147) |
| types | `Fn` | `std::ops::Fn` | [`rustls-bench/src/main.rs:380`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/rustls-bench/src/main.rs#L380) |
| macros | `format` | `std::format!` | [`examples/src/bin/tls-client-mio.rs:352`](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/examples/src/bin/tls-client-mio.rs#L352) |

### tauri-apps/tauri

Clap supplies command parsing implementations. Serde and Thiserror supply trait implementations in the CLI and mobile modules. The source re-exports `Rust` as `AppInterface` and `error::Result` as the crate result alias. The enabled JSON-RPC client feature supplies `Client` through the written core re-export. [Clap derives](https://docs.rs/clap/latest/clap/_derive/index.html) · [Serde derives](https://serde.rs/derive.html) · [Thiserror](https://docs.rs/thiserror/latest/thiserror/) · [JSON-RPC client re-export](https://docs.rs/crate/jsonrpsee-core/0.26.0/source/src/client/mod.rs)

| Stored kind | Written name | Target | Pinned source |
| --- | --- | --- | --- |
| imports | `crate::interface::AppInterface` | `crates/tauri-cli/src/interface/rust.rs · Rust` | [`crates/tauri-cli/src/mobile/ios/build.rs:20`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/mobile/ios/build.rs#L20) |
| types | `Client` | `jsonrpsee::core::client::Client` | [`crates/tauri-cli/src/mobile/mod.rs:580`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/mobile/mod.rs#L580) |
| macros | `format` | `std::format!` | [`crates/tauri-cli/src/interface/rust.rs:1394`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/interface/rust.rs#L1394) |
| patterns | `Ok` | `std::result::Result::Ok` | [`crates/tauri-cli/src/acl/mod.rs:76`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/acl/mod.rs#L76) |
| macros | `assert` | `std::assert!` | [`crates/tauri/src/plugin/mobile.rs:416`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri/src/plugin/mobile.rs#L416) |
| types | `Option` | `std::option::Option` | [`crates/tauri-cli/src/mobile/ios/mod.rs:532`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/mobile/ios/mod.rs#L532) |
| imports | `crate::Result` | `crates/tauri-cli/src/error.rs · Result` | [`crates/tauri-cli/src/mobile/android/build.rs:10`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/mobile/android/build.rs#L10) |
| calls | `Ok` | `std::result::Result::Ok` | [`crates/tauri-cli/src/bundle.rs:346`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/bundle.rs#L346) |
| macros | `format` | `std::format!` | [`crates/tauri-cli/src/acl/permission/add.rs:140`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/acl/permission/add.rs#L140) |
| calls | `serde_json::from_str` | `serde_json::from_str` | [`crates/tauri-cli/src/info/packages_nodejs.rs:39`](https://github.com/tauri-apps/tauri/blob/f5578bc1e07cc2e87a6b4526bc20299aaba3495e/crates/tauri-cli/src/info/packages_nodejs.rs#L39) |
