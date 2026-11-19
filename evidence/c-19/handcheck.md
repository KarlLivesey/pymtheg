# C-19 hand-check of disagreements

## ripgrep

39 disagreements on definite links in all; 30 sampled.

| # | Site | Written | Pymtheg | Toolchain | Right | Cause |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | crates/core/flags/doc/version.rs:110 | `features` | crates/core/flags/doc/version.rs:83 function runtime_cpu_features :: fn runtime_cpu_features() -> Vec<String> { | crates/core/flags/doc/version.rs:161 function features :: fn features() -> Vec<String> { | pymtheg | inactive-cfg: local `features` in a #[cfg(target_arch = "aarch64")] block; the toolchain (x86_64) names fn `features` at line 161 |
| 2 | crates/core/flags/doc/version.rs:152 | `features` | crates/core/flags/doc/version.rs:129 function compile_cpu_features :: fn compile_cpu_features() -> Vec<String> { | crates/core/flags/doc/version.rs:161 function features :: fn features() -> Vec<String> { | pymtheg | inactive-cfg: local `features` in a #[cfg(target_arch = "aarch64")] block of compile_cpu_features; the toolchain names fn `features` |
| 3 | crates/printer/src/jsont.rs:204 | `serde::Serializer` | cargo serde Serializer (qualified-path) | cargo serde_core ser::Serializer  | both | re-export: re-export of the name found |
| 4 | crates/cli/src/hostname.rs:60 | `libc::c_char` | cargo libc c_char (qualified-path) | rust-std core ffi::primitives::c_char  | both | re-export: re-export of the name found |
| 5 | crates/printer/src/jsont.rs:52 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 6 | crates/printer/src/jsont.rs:120 | `serde::Serializer` | cargo serde Serializer (qualified-path) | cargo serde_core ser::Serializer  | both | re-export: re-export of the name found |
| 7 | crates/printer/src/util.rs:392 | `serde::Serializer` | cargo serde Serializer (qualified-path) | cargo serde_core ser::Serializer  | both | re-export: re-export of the name found |
| 8 | crates/printer/src/util.rs:396 | `serde::ser::SerializeStruct` | cargo serde ser::SerializeStruct (qualified-path) | cargo serde_core ser::SerializeStruct  | both | re-export: re-export of the name found |
| 9 | crates/printer/src/jsont.rs:95 | `serde::Serializer` | cargo serde Serializer (qualified-path) | cargo serde_core ser::Serializer  | both | re-export: re-export of the name found |
| 10 | crates/printer/src/jsont.rs:53 | `serde::Serializer` | cargo serde Serializer (qualified-path) | cargo serde_core ser::Serializer  | both | re-export: re-export of the name found |
| 11 | crates/printer/src/jsont.rs:143 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 12 | crates/printer/src/jsont.rs:71 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 13 | crates/printer/src/stats.rs:151 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 14 | crates/printer/src/stats.rs:152 | `serde::Serializer` | cargo serde Serializer (qualified-path) | cargo serde_core ser::Serializer  | both | re-export: re-export of the name found |
| 15 | crates/printer/src/jsont.rs:124 | `serde::ser::SerializeStruct` | cargo serde ser::SerializeStruct (qualified-path) | cargo serde_core ser::SerializeStruct  | both | re-export: re-export of the name found |
| 16 | crates/printer/src/jsont.rs:18 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 17 | crates/printer/src/jsont.rs:52 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 18 | crates/printer/src/jsont.rs:57 | `serde::ser::SerializeStruct` | cargo serde ser::SerializeStruct (qualified-path) | cargo serde_core ser::SerializeStruct  | both | re-export: re-export of the name found |
| 19 | crates/printer/src/util.rs:391 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 20 | crates/printer/src/jsont.rs:94 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 21 | crates/printer/src/stats.rs:151 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 22 | crates/printer/src/jsont.rs:143 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 23 | crates/printer/src/jsont.rs:18 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 24 | crates/printer/src/jsont.rs:72 | `serde::Serializer` | cargo serde Serializer (qualified-path) | cargo serde_core ser::Serializer  | both | re-export: re-export of the name found |
| 25 | crates/printer/src/jsont.rs:76 | `serde::ser::SerializeStruct` | cargo serde ser::SerializeStruct (qualified-path) | cargo serde_core ser::SerializeStruct  | both | re-export: re-export of the name found |
| 26 | crates/printer/src/jsont.rs:119 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 27 | crates/printer/src/jsont.rs:148 | `serde::ser::SerializeStruct` | cargo serde ser::SerializeStruct (qualified-path) | cargo serde_core ser::SerializeStruct  | both | re-export: re-export of the name found |
| 28 | crates/printer/src/jsont.rs:94 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 29 | crates/printer/src/jsont.rs:203 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 30 | crates/printer/src/jsont.rs:208 | `serde::ser::SerializeStruct` | cargo serde ser::SerializeStruct (qualified-path) | cargo serde_core ser::SerializeStruct  | both | re-export: re-export of the name found |

## axum

27 disagreements on definite links in all; 30 sampled.

| # | Site | Written | Pymtheg | Toolchain | Right | Cause |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | axum/src/extract/mod.rs:27 | `axum_macros::FromRequestParts` | axum-macros/src/lib.rs:425 function derive_from_request_parts :: pub fn derive_from_request_parts(item: TokenStream) -> TokenStream { | axum-macros/src/from_request/mod.rs:18 variant FromRequestParts :: FromRequestParts, | pymtheg | proc-macro-export: a proc-macro crate exports only its macros: the derive is `derive_from_request_parts` (#[proc_macro_derive(FromRequestParts)]); the |
| 2 | axum/src/extract/mod.rs:27 | `axum_macros::FromRequest` | axum-macros/src/lib.rs:376 function derive_from_request :: pub fn derive_from_request(item: TokenStream) -> TokenStream { | axum-macros/src/from_request/mod.rs:17 variant FromRequest :: FromRequest, | pymtheg | proc-macro-export: the derive is `derive_from_request`; the toolchain names the private enum variant from_request::Trait::FromRequest |
| 3 | axum/src/lib.rs:596 | `axum_macros::debug_handler` | axum-macros/src/lib.rs:576 function debug_handler :: pub fn debug_handler(_attr: TokenStream, input: TokenStream) -> TokenStream { | axum-macros/src/debug_handler.rs:1 module axum-macros/src/debug_handler.rs :: use std::{collections::HashSet, fmt}; | pymtheg | proc-macro-export: the attribute macro is fn debug_handler; the toolchain names the private module debug_handler |
| 4 | axum-macros/src/typed_path.rs:283 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 5 | axum-macros/src/typed_path.rs:410 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 6 | axum-macros/src/debug_handler.rs:167 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 7 | axum/src/response/sse.rs:96 | `TryStream` | cargo futures-util stream::TryStream (import-binding) | cargo futures-core stream::TryStream  | both | re-export: re-export of the name found |
| 8 | axum/src/middleware/response_axum_body.rs:34 | `Service` | cargo tower Service (import-binding) | cargo tower-service Service  | both | re-export: re-export of the name found |
| 9 | axum-extra/src/routing/resource.rs:165 | `tokio::test` | cargo tokio #[test] (qualified-path) | cargo tokio-macros test  | both | re-export: re-export of the name found |
| 10 | axum-macros/src/typed_path.rs:102 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 11 | axum/benches/benches.rs:98 | `Serialize` | cargo serde #[derive(Serialize)] (import-binding) | cargo serde_derive Serialize  | both (glob re-export) | re-export: only a glob re-export (possible) |
| 12 | axum/src/middleware/response_axum_body.rs:32 | `Service` | cargo tower Service (import-binding) | cargo tower-service Service  | both | re-export: re-export of the name found |
| 13 | axum/src/middleware/response_axum_body.rs:20 | `Layer` | cargo tower Layer (import-binding) | cargo tower-layer Layer  | both | re-export: re-export of the name found |
| 14 | axum/benches/benches.rs:98 | `Deserialize` | cargo serde #[derive(Deserialize)] (import-binding) | cargo serde_derive Deserialize  | both (glob re-export) | re-export: only a glob re-export (possible) |
| 15 | axum/src/middleware/response_axum_body.rs:20 | `Layer<S>` | cargo tower Layer (import-binding) | cargo tower-layer Layer  | both | re-export: re-export of the name found |
| 16 | axum-macros/src/from_request/mod.rs:716 | `Ident` | cargo syn Ident (import-binding) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 17 | axum-macros/src/typed_path.rs:171 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 18 | axum/src/routing/strip_prefix.rs:19 | `Layer` | cargo tower Layer (import-binding) | cargo tower-layer Layer  | both | re-export: re-export of the name found |
| 19 | axum-macros/src/from_request/mod.rs:234 | `Ident` | cargo syn Ident (import-binding) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 20 | axum-macros/src/from_request/mod.rs:712 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 21 | axum-macros/src/typed_path.rs:370 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 22 | axum-macros/src/from_request/mod.rs:10 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 23 | axum-macros/src/from_request/mod.rs:884 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 24 | axum/src/middleware/response_axum_body.rs:32 | `Service<Request>` | cargo tower Service (import-binding) | cargo tower-service Service  | both | re-export: re-export of the name found |
| 25 | axum-macros/src/from_request/mod.rs:331 | `syn::Ident` | cargo syn Ident (qualified-path) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 26 | axum-macros/src/from_request/mod.rs:1056 | `Ident` | cargo syn Ident (import-binding) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |
| 27 | axum-macros/src/from_request/mod.rs:317 | `Ident` | cargo syn Ident (import-binding) | cargo proc-macro2 Ident  | both | re-export: re-export of the name found |

## helix

161 disagreements on definite links in all; 30 sampled.

| # | Site | Written | Pymtheg | Toolchain | Right | Cause |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | helix-event/src/runtime.rs:51 | `RuntimeLocal` | helix-event/src/runtime.rs:43 struct RuntimeLocal :: pub struct RuntimeLocal<T: 'static> { | helix-event/src/runtime.rs:17 struct RuntimeLocal :: pub struct RuntimeLocal<T: 'static> { | pymtheg | inactive-cfg: impl under #[cfg(feature = "integration_test")]: that build's struct is line 43; the toolchain (default features) names line 17 |
| 2 | helix-event/src/runtime.rs:65 | `RuntimeLocal` | helix-event/src/runtime.rs:43 struct RuntimeLocal :: pub struct RuntimeLocal<T: 'static> { | helix-event/src/runtime.rs:17 struct RuntimeLocal :: pub struct RuntimeLocal<T: 'static> { | pymtheg | inactive-cfg: as above (Deref impl under the integration_test feature) |
| 3 | helix-term/src/lib.rs:2 | `helix_view` | helix-view/src/lib.rs:1 module helix-view/src/lib.rs :: #[macro_use] | helix-term/src/lib.rs:2 module helix-term/src/lib.rs :: extern crate helix_view; | pymtheg | extern-crate: `extern crate helix_view;` names the helix-view crate root; the toolchain occurrence names helix-term's own crate root |
| 4 | helix-core/src/line_ending.rs:305 | `get_line_ending_of_str` | helix-core/src/line_ending.rs:176 function get_line_ending_of_str :: pub fn get_line_ending_of_str(line: &str) -> Option<LineEnding> { | helix-core/src/line_ending.rs:164 function get_line_ending_of_str :: pub fn get_line_ending_of_str(line: &str) -> Option<LineEnding> { | pymtheg | inactive-cfg: statement under #[cfg(feature = "unicode-lines")]: that build's fn is line 176; the toolchain names the not(unicode-lines) fn at 164 |
| 5 | helix-view/src/clipboard.rs:47 | `ClipboardProvider` | helix-view/src/clipboard.rs:45 enum ClipboardProvider :: pub enum ClipboardProvider {} | helix-view/src/clipboard.rs:89 enum ClipboardProvider :: pub enum ClipboardProvider { | pymtheg | inactive-cfg: impl inside #[cfg(target_arch = "wasm32")] mod noop, whose enum is line 45; the toolchain names mod external's enum at 89 |
| 6 | helix-term/src/application.rs:1297 | `TerminalEvent` | helix-term/src/application.rs:66 type TerminalEvent :: type TerminalEvent = crossterm::event::Event; | helix-term/src/application.rs:64 type TerminalEvent :: type TerminalEvent = termina::Event; | pymtheg | inactive-cfg: fn under #[cfg(all(not(feature = "integration"), windows))]: the windows alias is line 66; the toolchain names the not(windows) alias at |
| 7 | helix-core/src/indent.rs:751 | `Node` | cargo tree-house tree_sitter::Node (import-binding) | cargo tree-house-bindings node::Node  | both | re-export: re-export of the name found |
| 8 | helix-core/src/syntax.rs:1166 | `Capture` | cargo tree-house tree_sitter::Capture (import-binding) | cargo tree-house-bindings query::Capture  | both | re-export: re-export of the name found |
| 9 | helix-dap-types/src/lib.rs:337 | `Deserializer` | cargo serde Deserializer (import-binding) | cargo serde_core de::Deserializer  | both | re-export: re-export of the name found |
| 10 | helix-stdx/src/uri.rs:255 | `Serialize` | cargo serde Serialize (import-binding) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 11 | helix-core/src/syntax.rs:609 | `Query` | cargo tree-house tree_sitter::Query (import-binding) | cargo tree-house-bindings query::Query  | both | re-export: re-export of the name found |
| 12 | helix-loader/src/grammar.rs:69 | `Grammar` | cargo tree-house tree_sitter::Grammar (import-binding) | cargo tree-house-bindings grammar::Grammar  | both | re-export: re-export of the name found |
| 13 | helix-core/src/syntax.rs:639 | `Node` | cargo tree-house tree_sitter::Node (import-binding) | cargo tree-house-bindings node::Node  | both | re-export: re-export of the name found |
| 14 | helix-core/src/syntax.rs:1014 | `Query` | cargo tree-house tree_sitter::Query (import-binding) | cargo tree-house-bindings query::Query  | both | re-export: re-export of the name found |
| 15 | helix-view/src/document.rs:95 | `Deserialize` | cargo serde de::Deserialize (import-binding) | cargo serde_core de::Deserialize  | both | re-export: re-export of the name found |
| 16 | helix-core/src/indent.rs:1153 | `Node` | cargo tree-house tree_sitter::Node (import-binding) | cargo tree-house-bindings node::Node  | both | re-export: re-export of the name found |
| 17 | helix-core/src/syntax.rs:1010 | `Query` | cargo tree-house tree_sitter::Query (import-binding) | cargo tree-house-bindings query::Query  | both | re-export: re-export of the name found |
| 18 | helix-stdx/src/uri.rs:255 | `Serialize` | cargo serde Serialize (import-binding) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 19 | helix-core/src/indent.rs:299 | `Capture` | cargo tree-house tree_sitter::Capture (import-binding) | cargo tree-house-bindings query::Capture  | both | re-export: re-export of the name found |
| 20 | helix-loader/src/grammar.rs:74 | `Grammar` | cargo tree-house tree_sitter::Grammar (import-binding) | cargo tree-house-bindings grammar::Grammar  | both | re-export: re-export of the name found |
| 21 | helix-view/src/annotations/diagnostics.rs:51 | `Serialize` | cargo serde #[derive(Serialize)] (import-binding) | cargo serde_derive Serialize  | both (glob re-export) | re-export: only a glob re-export (possible) |
| 22 | helix-lsp/src/transport.rs:33 | `Deserialize` | cargo serde #[derive(Deserialize)] (import-binding) | cargo serde_derive Deserialize  | both (glob re-export) | re-export: only a glob re-export (possible) |
| 23 | helix-view/src/input.rs:451 | `Deserialize<'de>` | cargo serde de::Deserialize (import-binding) | cargo serde_core de::Deserialize  | both | re-export: re-export of the name found |
| 24 | helix-core/src/indent.rs:355 | `Pattern` | cargo tree-house tree_sitter::Pattern (import-binding) | cargo tree-house-bindings query::Pattern  | both | re-export: re-export of the name found |
| 25 | helix-core/src/syntax.rs:735 | `InputEdit` | cargo tree-house tree_sitter::InputEdit (import-binding) | cargo tree-house-bindings tree::InputEdit  | both | re-export: re-export of the path's module found |
| 26 | helix-view/src/editor.rs:60 | `serde::Deserializer` | cargo serde Deserializer (qualified-path) | cargo serde_core de::Deserializer  | both | re-export: re-export of the name found |
| 27 | helix-core/src/fuzzy.rs:25 | `nucleo::Matcher` | cargo nucleo Matcher (qualified-path) | cargo nucleo-matcher Matcher  | both | re-export: re-export of the name found |
| 28 | helix-lsp/src/client.rs:507 | `serde::Serialize` | cargo serde Serialize (qualified-path) | cargo serde_core ser::Serialize  | both | re-export: re-export of the name found |
| 29 | helix-core/src/syntax.rs:179 | `UserPredicate::IsPropertySet` | cargo tree-house tree_sitter::query::UserPredicate::IsPropertySet (import-binding) | cargo tree-house-bindings query::UserPredicate::IsPropertySet  | both | re-export: re-export of the name found |
| 30 | helix-core/src/match_brackets.rs:299 | `Node` | cargo tree-house tree_sitter::Node (import-binding) | cargo tree-house-bindings node::Node  | both | re-export: re-export of the name found |

## tauri

240 disagreements on definite links in all; 30 sampled.

| # | Site | Written | Pymtheg | Toolchain | Right | Cause |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | crates/tauri-cli/src/mobile/mod.rs:452 | `HttpResponse` | cargo jsonrpsee server::HttpResponse (import-binding) | cargo jsonrpsee-core http_helpers::Response  | both | renamed-re-export: jsonrpsee-server: `pub use jsonrpsee_core::http_helpers::{..., Response as HttpResponse}`; Pymtheg records the written jsonrpsee pa |
| 2 | crates/tauri-cli/src/mobile/init.rs:405 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 3 | crates/tauri-cli/src/helpers/template.rs:63 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 4 | crates/tauri-cli/src/helpers/flock.rs:327 | `file` | crates/tauri-cli/src/helpers/flock.rs:326 function lock_exclusive :: pub(super) fn lock_exclusive(file: &File) -> Result<()> { | rust-std core macros::builtin::file  | pymtheg | inactive-cfg: parameter `file` inside #[cfg(windows)] mod sys; the toolchain (linux) names core's `file!` macro |
| 5 | crates/tauri-cli/src/helpers/flock.rs:331 | `file` | crates/tauri-cli/src/helpers/flock.rs:330 function try_lock_shared :: pub(super) fn try_lock_shared(file: &File) -> Result<()> { | rust-std core macros::builtin::file  | pymtheg | inactive-cfg: as above |
| 6 | crates/tauri/src/protocol/tauri.rs:242 | `url` | crates/tauri/src/protocol/tauri.rs:196 function proxy_dev_request :: async fn proxy_dev_request( | cargo url  | pymtheg | inactive-cfg: parameter `url` of a #[cfg(all(dev, mobile))] fn; the toolchain names the `url` crate |
| 7 | crates/tauri-cli/src/helpers/template.rs:40 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 8 | crates/tauri-runtime-wry/src/lib.rs:5198 | `window` | crates/tauri-runtime-wry/src/lib.rs:4672 function create_webview :: fn create_webview<T: UserEvent>( | crates/tauri-runtime-wry/src/window/mod.rs:1 module crates/tauri-runtime-wry/src/window/mod.rs :: // Copyright 2019-2024 Tauri Programme within The Co | pymtheg | inactive-cfg: local `window` in platform-gated code; the toolchain names the module `window` |
| 9 | crates/tauri-runtime-wry/src/undecorated_resizing.rs:539 | `attach_resize_handler` | crates/tauri-runtime-wry/src/undecorated_resizing.rs:117 function attach_resize_handler :: pub fn attach_resize_handler(hwnd: isize, has_undecorated_s | crates/tauri-runtime-wry/src/undecorated_resizing.rs:690 function attach_resize_handler :: pub fn attach_resize_handler(webview: &wry::WebView) { | pymtheg | inactive-cfg: call inside the #[cfg(windows)] module (fn at 117); the toolchain names the gtk module's fn at 690 |
| 10 | crates/tauri/src/protocol/tauri.rs:210 | `url` | crates/tauri/src/protocol/tauri.rs:196 function proxy_dev_request :: async fn proxy_dev_request( | cargo url  | pymtheg | inactive-cfg: local `url` in the same #[cfg(all(dev, mobile))] fn |
| 11 | crates/tauri/src/protocol/tauri.rs:83 | `url` | crates/tauri/src/protocol/tauri.rs:27 function get :: pub fn get<R: Runtime>( | cargo url  | pymtheg | inactive-cfg: local `url` bound under #[cfg(all(dev, mobile))] |
| 12 | crates/tauri-cli/src/mobile/mod.rs:450 | `HttpRequest` | cargo jsonrpsee server::HttpRequest (import-binding) | cargo jsonrpsee-core http_helpers::Request  | both | renamed-re-export: `Request as HttpRequest` re-exported by jsonrpsee-server |
| 13 | crates/tauri-cli/src/mobile/mod.rs:466 | `HttpRequest` | cargo jsonrpsee server::HttpRequest (import-binding) | cargo jsonrpsee-core http_helpers::Request  | both | renamed-re-export: as above |
| 14 | crates/tauri-cli/src/mobile/mod.rs:452 | `HttpRequest` | cargo jsonrpsee server::HttpRequest (import-binding) | cargo jsonrpsee-core http_helpers::Request  | both | renamed-re-export: as above |
| 15 | crates/tauri-cli/src/mobile/init.rs:196 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 16 | crates/tauri-cli/src/mobile/init.rs:274 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 17 | crates/tauri-cli/src/dev.rs:173 | `command` | crates/tauri-cli/src/dev.rs:136 function setup :: pub fn setup( | crates/tauri-cli/src/dev.rs:99 function command :: pub fn command(options: Options) -> Result<()> { | pymtheg | inactive-cfg: local `command` in a #[cfg(windows)] block; the toolchain names fn `command` |
| 18 | crates/tauri-bundler/src/bundle/windows/nsis/mod.rs:753 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 19 | crates/tauri-runtime-wry/src/lib.rs:5190 | `window` | crates/tauri-runtime-wry/src/lib.rs:4672 function create_webview :: fn create_webview<T: UserEvent>( | crates/tauri-runtime-wry/src/window/mod.rs:1 module crates/tauri-runtime-wry/src/window/mod.rs :: // Copyright 2019-2024 Tauri Programme within The Co | pymtheg | inactive-cfg: as above (#[cfg(any(target_os = "windows", ...))]) |
| 20 | crates/tauri-cli/src/mobile/init.rs:178 | `handlebars` | crates/tauri-cli/src/mobile/init.rs:48 function exec :: fn exec( | cargo handlebars  | pymtheg | inactive-cfg: local `handlebars` in a #[cfg(target_os = "macos")] block; the toolchain names the handlebars crate |
| 21 | crates/tauri/src/webview/mod.rs:2129 | `R` | crates/tauri/src/webview/mod.rs:2129 function load_channels :: fn load_channels<R: Runtime>(payload: &serde_json::Value, webview: &Webview<R>) { | crates/tauri/src/webview/mod.rs:1782 local impl impl<R:Runtime> Webview<R> [local 208] :: impl<R: Runtime> Webview<R> { | pymtheg | inactive-cfg: type parameter of a fn nested in a #[cfg(mobile)] block; the toolchain names the enclosing impl's R |
| 22 | crates/tauri-runtime-wry/src/lib.rs:593 | `window` | crates/tauri-runtime-wry/src/lib.rs:574 method parse :: fn parse(window: &WindowWrapper, event: &TaoWindowEvent<'_>) -> Self { | crates/tauri-runtime-wry/src/window/mod.rs:1 module crates/tauri-runtime-wry/src/window/mod.rs :: // Copyright 2019-2024 Tauri Programme within The Co | pymtheg | inactive-cfg: parameter `window` used under #[cfg(windows)] |
| 23 | crates/tauri-bundler/src/bundle.rs:181 | `settings` | crates/tauri-bundler/src/bundle.rs:112 function bundle_project :: pub fn bundle_project(settings: &Settings) -> crate::Result<Vec<Bundle>> { | crates/tauri-bundler/src/bundle/settings.rs:1 module crates/tauri-bundler/src/bundle/settings.rs :: // Copyright 2016-2019 Cargo-Bundle developers <ht | pymtheg | inactive-cfg: parameter `settings` in a #[cfg(target_os = "macos")] match arm; the toolchain names module `settings` |
| 24 | crates/tauri/src/path/plugin.rs:235 | `PathResolver` | crates/tauri/src/path/android.rs:10 struct PathResolver :: pub struct PathResolver<R: Runtime>(pub(crate) PluginHandle<R>); | crates/tauri/src/path/desktop.rs:10 struct PathResolver :: pub struct PathResolver<R: Runtime>(pub(crate) AppHandle<R>); | pymtheg | inactive-cfg: call in a #[cfg(target_os = "android")] block: android's PathResolver; the toolchain names desktop's |
| 25 | crates/tauri-bundler/src/bundle.rs:177 | `settings` | crates/tauri-bundler/src/bundle.rs:112 function bundle_project :: pub fn bundle_project(settings: &Settings) -> crate::Result<Vec<Bundle>> { | crates/tauri-bundler/src/bundle/settings.rs:1 module crates/tauri-bundler/src/bundle/settings.rs :: // Copyright 2016-2019 Cargo-Bundle developers <ht | pymtheg | inactive-cfg: as above |
| 26 | crates/tauri-runtime-wry/src/lib.rs:797 | `window` | crates/tauri-runtime-wry/src/lib.rs:792 method with_config :: fn with_config(config: &WindowConfig) -> Self { | crates/tauri-runtime-wry/src/window/mod.rs:1 module crates/tauri-runtime-wry/src/window/mod.rs :: // Copyright 2019-2024 Tauri Programme within The Co | pymtheg | inactive-cfg: local `window` under #[cfg(target_os = "macos")] |
| 27 | crates/tauri-runtime-wry/src/lib.rs:3666 | `WebviewMessage::EvaluateScript` | crates/tauri-runtime-wry/src/lib.rs:1426 variant EvaluateScript :: EvaluateScript(String, Sender<()>, tracing::Span), | crates/tauri-runtime-wry/src/lib.rs:1424 variant EvaluateScript :: EvaluateScript(String), | pymtheg | inactive-cfg: arm under #[cfg(all(feature = "tracing", not(target_os = "android")))] matches the three-field variant at 1426; the toolchain names the  |
| 28 | crates/tauri-cli/src/mobile/init.rs:336 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 29 | crates/tauri-cli/src/mobile/init.rs:385 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |
| 30 | crates/tauri-cli/src/mobile/init.rs:262 | `Handlebars` | cargo handlebars Handlebars (import-binding) | cargo handlebars registry::Registry  | both | renamed-re-export: handlebars re-exports `registry::Registry as Handlebars` |

## Totals

- pymtheg: 28
- both: 85
- both (glob re-export): 4

## Gained links (first 10 per pin, fixed seed)

| Pin | Site | Written | Pymtheg reason | Toolchain answer |
| --- | --- | --- | --- | --- |
| ripgrep | crates/core/flags/defs.rs:1116 | `mode.set_both` | receiver-type-unverified | crates/core/flags/lowargs.rs:400 method set_both :: pub(crate) fn set_both(&mut self, lines: usize) { |
| ripgrep | crates/ignore/src/walk.rs:2331 | `td.path().join` | receiver-type-unverified; namespace-binding-unverified | rust-std std path::Path::join |
| ripgrep | crates/matcher/src/lib.rs:1295 | `Self::Error` | no-reason | crates/matcher/src/lib.rs:559 type Error :: type Error: std::fmt::Display; |
| ripgrep | crates/regex/src/literal.rs:613 | `seq1.len` | receiver-type-unverified | crates/regex/src/literal.rs:512 method len :: fn len(&self) -> Option<usize> { |
| ripgrep | crates/ignore/src/dir.rs:1297 | `ig.matched` | receiver-type-unverified | crates/ignore/src/dir.rs:530 method matched :: pub(crate) fn matched<'a, P: AsRef<Path>>( |
| ripgrep | crates/printer/src/hyperlink/mod.rs:1009 | `HyperlinkFormat::from_str("foo://{path}").unwrap().to_string` | receiver-type-unverified | rust-std alloc string::T::to_string |
| ripgrep | crates/printer/src/json.rs:1029 | `SearcherBuilder::new() .build` | later-probe-step; too-many-targets | crates/searcher/src/searcher/mod.rs:315 method build :: pub fn build(&self) -> Searcher { |
| ripgrep | crates/searcher/src/searcher/mod.rs:760 | `self.line_buffer.borrow_mut` | receiver-type-unverified; namespace-binding-unverified | rust-std core cell::RefCell::borrow_mut |
| ripgrep | crates/ignore/src/walk.rs:2716 | `td.path().join` | receiver-type-unverified; namespace-binding-unverified | rust-std std path::Path::join |
| ripgrep | crates/printer/src/standard.rs:1315 | `m.start` | receiver-type-unverified | crates/matcher/src/lib.rs:94 method start :: pub fn start(&self) -> usize { |
| axum | axum/src/routing/tests/mod.rs:274 | `ready` | opaque-item-may-shadow-name | rust-std core future::ready::ready |
| axum | axum/src/routing/path_router.rs:178 | `T::Future` | blocked | cargo tower-service Service::Future |
| axum | axum/src/extract/path/inner_path.rs:529 | `assert_eq` | no-reason | rust-std core macros::assert_eq |
| axum | axum/src/extract/path/inner_path.rs:330 | `Router::new` | inherent-applicability-unverified | axum/src/routing/mod.rs:166 method new :: pub fn new() -> Self { |
| axum | axum-extra/src/routing/mod.rs:444 | `StatusCode::BAD_REQUEST.into_response` | receiver-type-unverified; too-many-targets | axum-core/src/response/into_response.rs:122 method into_response :: fn into_response(self) -> Response { |
| axum | axum/src/routing/method_routing.rs:1076 | `Send` | opaque-item-may-shadow-name | rust-std core marker::Send |
| axum | axum/src/handler/mod.rs:274 | `T` | item-under-opaque-attribute | axum/src/handler/mod.rs:272 local impl impl<T,S> Handler<private::IntoResponseHandler,S> for T :: impl<T, S> Handler<private::IntoResponseHandler, S>  |
| axum | axum/src/serve/mod.rs:803 | `Send` | opaque-item-may-shadow-name | rust-std core marker::Send |
| axum | axum-macros/src/debug_handler.rs:446 | `quote_spanned` | import-cycle-unverified | cargo quote quote_spanned |
| axum | axum/src/response/mod.rs:173 | `IntoResponse` | opaque-item-may-shadow-name; item-under-opaque-attribute; opaque-item-may-shadow-name; opaque-item-may-shadow-name | axum-core/src/response/into_response.rs:115 trait IntoResponse :: pub trait IntoResponse { |
| helix | helix-core/src/position.rs:278 | `text.line_to_char` | receiver-type-unverified; namespace-binding-unverified | cargo ropey slice::RopeSlice::line_to_char |
| helix | helix-term/src/commands.rs:4340 | `doc.selection` | receiver-type-unverified | helix-view/src/document.rs:2124 method selection :: pub fn selection(&self, view_id: ViewId) -> &Selection { |
| helix | helix-term/src/commands.rs:2477 | `char_is_word` | opaque-item-may-shadow-name | helix-core/src/chars.rs:84 function char_is_word :: pub fn char_is_word(ch: char) -> bool { |
| helix | helix-term/src/commands.rs:2622 | `doc.text` | receiver-type-unverified | helix-view/src/document.rs:2119 method text :: pub fn text(&self) -> &Rope { |
| helix | helix-dap-types/src/lib.rs:694 | `PartialEq` | no-reason | rust-std core cmp::PartialEq |
| helix | helix-view/src/editor.rs:1581 | `None` | opaque-item-may-shadow-name | rust-std core option::Option::None |
| helix | helix-term/src/commands/dap.rs:206 | `template.completion.get` | receiver-type-unverified; opaque-item-may-shadow-name | rust-std core slice::[T]::get |
| helix | helix-core/src/textobject.rs:36 | `pos` | blocked | helix-core/src/textobject.rs:13 local function find_word_boundary :: fn find_word_boundary(slice: RopeSlice, mut pos: usize, direction: Direction, lon |
| helix | helix-term/src/commands.rs:6630 | `bail` | import-cycle-unverified; macro-use-exports-unverified | cargo anyhow macros::bail |
| helix | helix-term/src/commands.rs:4809 | `view` | blocked | helix-term/src/commands.rs:4808 local function commit_undo_checkpoint :: let (view, doc) = current!(cx.editor); |
| tauri | crates/tauri-macros/src/context.rs:67 | `Expr::Array` | namespace-binding-unverified | cargo syn expr::Expr::Array |
| tauri | crates/tauri-cli/src/interface/rust.rs:1745 | `cargo_toml` | blocked | crates/tauri-cli/src/interface/rust.rs:1741 local function app_settings_with_manifest :: fn app_settings_with_manifest(cargo_toml: &str) -> (tempfile: |
| tauri | crates/tauri-utils/src/config_v1/mod.rs:2687 | `String` | opaque-item-may-shadow-name | rust-std alloc string::String |
| tauri | crates/tauri-codegen/src/context.rs:53 | `element.text` | receiver-type-unverified | cargo dom_query selection::Selection::text |
| tauri | bench/src/utils.rs:267 | `status.success` | receiver-type-unverified | rust-std std process::ExitStatus::success |
| tauri | crates/tauri/src/manager/mod.rs:790 | `Default::default` | path-type-unverified; too-many-targets | rust-std alloc vec::Vec::default |
| tauri | crates/tauri-cli/src/plugin/init.rs:143 | `data` | blocked | crates/tauri-cli/src/plugin/init.rs:142 local function command :: let mut data = BTreeMap::new(); |
| tauri | crates/tauri/src/plugin.rs:118 | `Webview` | item-under-opaque-attribute; opaque-item-may-shadow-name; opaque-item-may-shadow-name; opaque-item-may-shadow-name | crates/tauri/src/webview/mod.rs:1428 struct Webview :: pub struct Webview<R: Runtime> { |
| tauri | crates/tauri/src/webview/mod.rs:2234 | `ids` | blocked | crates/tauri/src/webview/mod.rs:2230 local method emit_js :: pub(crate) fn emit_js(&self, emit_args: &EmitArgs, ids: &[u32]) -> crate::Result<()> { |
| tauri | crates/tauri-utils/src/config.rs:3204 | `first.to_str` | receiver-type-unverified | rust-std std ffi::os_str::OsStr::to_str |

