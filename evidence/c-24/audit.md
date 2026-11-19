# C-24 hand audit: 40 newly definite Rust links

Drawn by [union.mjs](union.mjs) from the final comparison (merged branch
against the union of three merged-main runs, [union-final.json](union-final.json)):
every Level 2 site whose decision no main run had, ranked by
SHA-256 of `["c24-rust-determinism-2026-11-19", pin, site key, index]`,
lowest 40. Checked against the pinned sources (`sweep/repos.json`).

**Result: 40 of 40 right.**

What was checked for each: the written name binds to the type the target
belongs to (imports, `use` lists, `crate::`/`super::` paths, and for a
cross-crate type the Cargo edge: tree-sitter `tree-sitter = { path = "./lib" }`
and the wasm fixture's `path = "../../../lib"`, crossbeam-epoch's path
dependency on crossbeam-utils, axum-extra's `axum_core::body`); the target is
the only inherent associated function or method of that name for the type
(the inherent candidate comes before any trait method for `Type::name` and
at the first probe step for `self.m()`); and it holds in every
configuration (actix-router's `RegexSet` has two struct definitions under
complementary `cfg(feature = "unicode")` gates and one unconditional
`impl RegexSet`, so `RegexSet::empty` is that method in both). #11 dioxus
`Self::new` sits in `impl Default for Config` and names the inherent
`Config::new`. #19 is a chain: `static_path()` is declared to return
`TemplatePath`, whose `is_root` is the target.

The three Fjall links marked `rust-external-macro-name` (#13, #27, #28:
`std::str::from_utf8`, `vec!`, `Some` in `examples/structured/src/main.rs`)
are released by item 2: serde's derive is now identified without a lockfile,
so the existing expansion assumption applies beside it. Each names the
standard item the source writes. Every other link here is released by item 3:
an unplaced inherent impl in another crate had kept each call open.

| # | Pin | Site | Kind | Written | Target | Was |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:4089 | calls | `QueryCursor::new` | lib/binding_rust/lib.rs:3136 impl QueryCursor::new | unresolved |
| 2 | tree-sitter/tree-sitter | crates/cli/src/tests/node_test.rs:1022 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 3 | actix/actix-web | actix-router/src/resource.rs:856 | calls | `RegexSet::empty` | actix-router/src/regex_set.rs:35 impl RegexSet::empty | unresolved |
| 4 | DioxusLabs/dioxus | packages/dx/src/check/mod.rs:229 | calls | `MatchInfo::new` | packages/dx/src/check/metadata.rs:51 impl MatchInfo::new | unresolved |
| 5 | actix/actix-web | actix-router/src/router.rs:241 | calls | `Path::new` | actix-router/src/path.rs:38 impl<T:ResourcePath> Path<T>::new | unresolved |
| 6 | DioxusLabs/dioxus | packages/rsx-hotreload/tests/hotreload_pattern.rs:293 | calls | `FmtedSegments::new` | packages/vdom/src/hotreload_utils.rs:80 impl FmtedSegments::new | unresolved |
| 7 | tokio-rs/axum | axum-extra/src/response/file_stream.rs:283 | calls | `body::Body::new` | axum-core/src/body.rs:46 impl Body::new | unresolved |
| 8 | actix/actix-web | actix-router/src/resource.rs:1713 | calls | `ResourceDef::new` | actix-router/src/resource.rs:276 impl ResourceDef::new | unresolved |
| 9 | actix/actix-web | actix-web/src/service.rs:201 | calls | `self.head` | actix-web/src/service.rs:170 impl ServiceRequest::head | unresolved |
| 10 | rustls/rustls | bogo/src/client.rs:110 | calls | `ClientCacheWithSpecificKxHints::new` | bogo/src/client.rs:383 impl ClientCacheWithSpecificKxHints::new | unresolved |
| 11 | DioxusLabs/dioxus | packages/desktop/src/config.rs:549 | calls | `Self::new` | packages/desktop/src/config.rs:345 impl Config::new | unresolved |
| 12 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:2712 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 13 | fjall-rs/fjall | examples/structured/src/main.rs:28 | calls | `std::str::from_utf8` | std str::from_utf8 (qualified-path) [rust-external-macro-name] | unresolved |
| 14 | DioxusLabs/dioxus | packages/vdom/src/mount.rs:756 | calls | `MountedElementId::new` | packages/vdom/src/arena.rs:52 impl MountedElementId::new | unresolved |
| 15 | alacritty/alacritty | alacritty_terminal/src/vi_mode.rs:817 | calls | `ViModeCursor::new` | alacritty_terminal/src/vi_mode.rs:68 impl ViModeCursor::new | unresolved |
| 16 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:3869 | calls | `QueryProperty::new` | lib/binding_rust/lib.rs:3604 impl QueryProperty::new | unresolved |
| 17 | tree-sitter/tree-sitter | crates/cli/src/tests/tree_test.rs:573 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 18 | tree-sitter/tree-sitter | crates/cli/src/tests/tree_test.rs:219 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 19 | DioxusLabs/dioxus | packages/vdom/src/diff/template.rs:226 | calls | `anchor.static_path().is_root` | packages/vdom-template/src/path.rs:73 impl TemplatePath::is_root | unresolved |
| 20 | tree-sitter/tree-sitter | crates/cli/src/tests/language_test.rs:7 | calls | `Parser::new` | lib/binding_rust/lib.rs:769 impl Parser::new | unresolved |
| 21 | actix/actix-web | actix-multipart/src/field.rs:875 | calls | `Multipart::new` | actix-multipart/src/multipart.rs:89 impl Multipart::new | unresolved |
| 22 | tree-sitter/tree-sitter | test/fixtures/rust_wasm_web/src/rust_wasm_web.rs:256 | calls | `Parser::new` | lib/binding_rust/lib.rs:769 impl Parser::new | unresolved |
| 23 | actix/actix-web | actix-web/src/service.rs:399 | calls | `self.head` | actix-web/src/service.rs:170 impl ServiceRequest::head | unresolved |
| 24 | alacritty/alacritty | alacritty_terminal/src/selection.rs:573 | calls | `Point::new` | alacritty_terminal/src/index.rs:56 impl<L,C> Point<L,C>::new | unresolved |
| 25 | DioxusLabs/dioxus | packages/vdom/src/mount.rs:747 | calls | `MountedElementId::new` | packages/vdom/src/arena.rs:52 impl MountedElementId::new | unresolved |
| 26 | rustls/rustls | ci-bench/src/main.rs:928 | calls | `CountInstructions::start` | ci-bench/src/valgrind.rs:465 impl CountInstructions::start | unresolved |
| 27 | fjall-rs/fjall | examples/structured/src/main.rs:84 | macros | `vec` | std vec! (declared-builtin) [rust-external-macro-name] | unresolved |
| 28 | fjall-rs/fjall | examples/structured/src/main.rs:61 | calls | `Some` | std option::Option::Some (declared-builtin) [rust-external-macro-name] | unresolved |
| 29 | tree-sitter/tree-sitter | crates/cli/src/tests/node_test.rs:778 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 30 | DioxusLabs/dioxus | packages/stores/src/store.rs:124 | calls | `SelectorScope::new` | packages/stores/src/scope.rs:81 impl<Lens> SelectorScope<Lens>::new | unresolved |
| 31 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:231 | calls | `Query::new` | lib/binding_rust/lib.rs:2496 impl Query::new | unresolved |
| 32 | actix/actix-web | actix-router/src/resource.rs:1289 | calls | `ResourceDef::new` | actix-router/src/resource.rs:276 impl ResourceDef::new | unresolved |
| 33 | DioxusLabs/dioxus | packages/dx/src/build/assets.rs:645 | calls | `AppManifest::new` | packages/dx/src/opt/mod.rs:37 impl AppManifest::new | unresolved |
| 34 | tree-sitter/tree-sitter | crates/cli/src/tests/node_test.rs:156 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 35 | crossbeam-rs/crossbeam | crossbeam-epoch/src/internal.rs:354 | calls | `CachePadded::new` | crossbeam-utils/src/cache_padded.rs:173 impl<T> CachePadded<T>::new | unresolved |
| 36 | actix/actix-web | actix-web/src/test/test_request.rs:283 | calls | `ServiceRequest::new` | actix-web/src/service.rs:82 impl ServiceRequest::new | unresolved |
| 37 | alacritty/alacritty | alacritty_terminal/src/vi_mode.rs:598 | calls | `Point::new` | alacritty_terminal/src/index.rs:56 impl<L,C> Point<L,C>::new | unresolved |
| 38 | tauri-apps/tauri | crates/tauri-build/src/lib.rs:1117 | calls | `crate::Attributes::new` | crates/tauri-build/src/lib.rs:492 impl Attributes::new | unresolved |
| 39 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:2837 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 40 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:2386 | calls | `Parser::new` | lib/binding_rust/lib.rs:769 impl Parser::new | unresolved |
