# C-24 hand audit: 40 newly definite Rust links

Drawn by [union.mjs](union.mjs) from the review-round-1 comparison (the
branch against the union of two runs of current main on all 19 Rust pins,
[union-round1.json](union-round1.json)): every Level 2 site whose decision
neither main run had, ranked by SHA-256 of
`["c24-rust-determinism-2026-11-19", pin, site key, index]`, lowest 40.
Checked against the pinned sources (`sweep/repos.json`).

**Result: 40 of 40 right.**

What was checked for each: the written name binds to the item the target is
(imports and `use` lists, `crate::`/`super::` paths, globs, and for a
cross-crate name the Cargo edge); the target is the only item of that name
the lookup can reach in every configuration where the referencing code
builds; for calls, that it is the method Rust picks (an inherent associated
function or method before any trait method at the same probe step).

Notes on the less obvious ones:

- #1, #3, #14, #17, #19, #21, #24, #31, #36: dioxus names imported from
  `dioxus_vdom`, `dioxus_html` or `crate::innerlude`, whose roots re-export
  through several globs. Each target is the item the supplying glob
  exports (checked); the other globs could at most add a *different* item
  of the same name through an item macro, an ambiguity error (E0659) at
  every use. These are released by rules 4 and 5.
- #2 embassy `aes::load_countermeasure_mask` in `crypto/symmetric/mod.rs`
  under `#[cfg(feature = "_cracen")]`: `aes.rs` re-exports it with
  `#[cfg(feature = "_cracen")] pub(super) use hw::load_countermeasure_mask`,
  and `hw` is `aes_cracen.rs` under that feature (`aes_cryptocell.rs` has no
  such function). Rule 3 makes the cfg-chosen `hw` complete.
- #9, #11, #23, #33, #39 embassy `impl_pin!`/`impl_timer!` in the
  cfg-chosen `chips/*.rs`: `gpio.rs` and `timer.rs` start with
  `#![macro_use]` and are declared before `mod chip`, so their
  `macro_rules!` are in textual scope.
- #13 embassy `self.is_set_low()` inside `impl StatefulOutputPin for
  OutputOpenDrain` (written with the trait's path, so the trait is not in
  scope): the inherent `is_set_low(&self)` is chosen.
- #27 embassy `assert_eq!` in `can/bxcan/filter.rs`: `fmt.rs` (`#![macro_use]`,
  declared first in `lib.rs`) defines `macro_rules! assert_eq`, which shadows
  the standard one in textual scope.
- #29 Fjall `std::str::from_utf8` (marked `rust-external-macro-name`) is
  released by item 2 (serde's derive identified without a lockfile).
- #6 actix-router `RegexSet::empty`: two `RegexSet` structs under
  complementary `cfg(feature = "unicode")` gates share one unconditional
  `impl RegexSet`, so the target holds in both.
- #26 dioxus `Self::new` inside `impl Default for Config` names the inherent
  `Config::new`.

| # | Pin | Site | Kind | Written | Target | Was |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | DioxusLabs/dioxus | packages/stores/src/subscriptions.rs:110 | types | `ReactiveContext` | packages/vdom/src/reactive_context.rs:13 ReactiveContext | unresolved |
| 2 | embassy-rs/embassy | embassy-nrf/src/crypto/symmetric/mod.rs:173 | calls | `aes::load_countermeasure_mask` | embassy-nrf/src/crypto/symmetric/aes_cracen.rs:34 load_countermeasure_mask | unresolved |
| 3 | DioxusLabs/dioxus | packages/hooks/src/use_hook_did_run.rs:13 | calls | `use_before_render` | packages/vdom/src/global_context.rs:434 use_before_render | unresolved |
| 4 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:4089 | calls | `QueryCursor::new` | lib/binding_rust/lib.rs:3136 impl QueryCursor::new | unresolved |
| 5 | tree-sitter/tree-sitter | crates/cli/src/tests/node_test.rs:1022 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 6 | actix/actix-web | actix-router/src/resource.rs:856 | calls | `RegexSet::empty` | actix-router/src/regex_set.rs:35 impl RegexSet::empty | unresolved |
| 7 | DioxusLabs/dioxus | packages/dx/src/check/mod.rs:229 | calls | `MatchInfo::new` | packages/dx/src/check/metadata.rs:51 impl MatchInfo::new | unresolved |
| 8 | actix/actix-web | actix-router/src/router.rs:241 | calls | `Path::new` | actix-router/src/path.rs:38 impl<T:ResourcePath> Path<T>::new | unresolved |
| 9 | embassy-rs/embassy | embassy-nrf/src/chips/nrf52810.rs:191 | macros | `impl_pin` | embassy-nrf/src/gpio.rs:1074 impl_pin | unresolved |
| 10 | tauri-apps/tauri | crates/tauri-utils/src/config.rs:4406 | calls | `opt_lit` | crates/tauri-utils/src/tokens.rs:38 opt_lit | unresolved |
| 11 | embassy-rs/embassy | embassy-nrf/src/chips/nrf52811.rs:205 | macros | `impl_pin` | embassy-nrf/src/gpio.rs:1074 impl_pin | unresolved |
| 12 | DioxusLabs/dioxus | packages/rsx-hotreload/tests/hotreload_pattern.rs:293 | calls | `FmtedSegments::new` | packages/vdom/src/hotreload_utils.rs:80 impl FmtedSegments::new | unresolved |
| 13 | embassy-rs/embassy | embassy-stm32/src/gpio.rs:1155 | calls | `self.is_set_low` | embassy-stm32/src/gpio.rs:657 impl<'d> OutputOpenDrain<'d>::is_set_low | unresolved |
| 14 | DioxusLabs/dioxus | packages/web/src/events/touch.rs:66 | types | `HasTouchPointData` | packages/html/src/events/touch.rs:252 HasTouchPointData | unresolved |
| 15 | embassy-rs/embassy | cyw43/src/runner.rs:1399 | values | `Ioctl::SetVar` | cyw43/src/consts.rs:684 Ioctl::SetVar | unresolved |
| 16 | tokio-rs/axum | axum-extra/src/response/file_stream.rs:283 | calls | `body::Body::new` | axum-core/src/body.rs:46 impl Body::new | unresolved |
| 17 | DioxusLabs/dioxus | packages/vdom/src/error_boundary.rs:108 | calls | `Subscribers::new` | packages/vdom/src/reactive_context.rs:349 impl Subscribers::new | unresolved |
| 18 | actix/actix-web | actix-router/src/resource.rs:1713 | calls | `ResourceDef::new` | actix-router/src/resource.rs:276 impl ResourceDef::new | unresolved |
| 19 | DioxusLabs/dioxus | packages/vdom/src/diff/attributes.rs:264 | calls | `BorrowedAttributeValue::Float` | packages/vdom/src/nodes.rs:600 BorrowedAttributeValue::Float | unresolved |
| 20 | actix/actix-web | actix-web/src/service.rs:201 | calls | `self.head` | actix-web/src/service.rs:170 impl ServiceRequest::head | unresolved |
| 21 | DioxusLabs/dioxus | packages/vdom/src/suspense/component.rs:380 | types | `ScopeId` | packages/vdom/src/scopes.rs:16 ScopeId | unresolved |
| 22 | embassy-rs/embassy | embassy-microchip/src/gpio.rs:141 | calls | `Flex::new` | embassy-microchip/src/gpio.rs:607 impl<'d> Flex<'d>::new | unresolved |
| 23 | embassy-rs/embassy | embassy-nrf/src/chips/nrf52832.rs:229 | macros | `impl_pin` | embassy-nrf/src/gpio.rs:1074 impl_pin | unresolved |
| 24 | DioxusLabs/dioxus | packages/router/src/contexts/router.rs:58 | calls | `provide_context` | packages/vdom/src/global_context.rs:67 provide_context | unresolved |
| 25 | rustls/rustls | bogo/src/client.rs:110 | calls | `ClientCacheWithSpecificKxHints::new` | bogo/src/client.rs:383 impl ClientCacheWithSpecificKxHints::new | unresolved |
| 26 | DioxusLabs/dioxus | packages/desktop/src/config.rs:549 | calls | `Self::new` | packages/desktop/src/config.rs:345 impl Config::new | unresolved |
| 27 | embassy-rs/embassy | embassy-stm32/src/can/bxcan/filter.rs:474 | macros | `assert_eq` | embassy-stm32/src/fmt.rs:44 assert_eq | unresolved |
| 28 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:2712 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 29 | fjall-rs/fjall | examples/structured/src/main.rs:28 | calls | `std::str::from_utf8` | std str::from_utf8 (qualified-path) [rust-external-macro-name] | unresolved |
| 30 | embassy-rs/embassy | embassy-usb/src/class/uvc/device.rs:709 | calls | `self.shared.get` | embassy-usb/src/class/uvc/device.rs:405 impl<'d> Shared<'d>::get | unresolved |
| 31 | DioxusLabs/dioxus | packages/web/src/events/mouse.rs:62 | types | `HasMouseData` | packages/html/src/events/mouse.rs:43 HasMouseData | unresolved |
| 32 | DioxusLabs/dioxus | packages/vdom/src/mount.rs:756 | calls | `MountedElementId::new` | packages/vdom/src/arena.rs:52 impl MountedElementId::new | unresolved |
| 33 | embassy-rs/embassy | embassy-nrf/src/chips/nrf5340_net.rs:219 | macros | `impl_timer` | embassy-nrf/src/timer.rs:34 impl_timer | unresolved |
| 34 | alacritty/alacritty | alacritty_terminal/src/vi_mode.rs:817 | calls | `ViModeCursor::new` | alacritty_terminal/src/vi_mode.rs:68 impl ViModeCursor::new | unresolved |
| 35 | tree-sitter/tree-sitter | crates/cli/src/tests/query_test.rs:3869 | calls | `QueryProperty::new` | lib/binding_rust/lib.rs:3604 impl QueryProperty::new | unresolved |
| 36 | DioxusLabs/dioxus | packages/vdom/src/diff/context.rs:80 | types | `MountId` | packages/vdom/src/arena.rs:130 MountId | unresolved |
| 37 | DioxusLabs/dioxus | packages/vdom/src/diff/node.rs:429 | calls | `self.find_first_element` | packages/vdom/src/diff/node.rs:303 impl VNode::find_first_element | unresolved |
| 38 | tree-sitter/tree-sitter | crates/cli/src/tests/tree_test.rs:573 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
| 39 | embassy-rs/embassy | embassy-nrf/src/chips/nrf5340_app.rs:422 | macros | `impl_pin` | embassy-nrf/src/gpio.rs:1074 impl_pin | unresolved |
| 40 | tree-sitter/tree-sitter | crates/cli/src/tests/tree_test.rs:219 | calls | `Point::new` | lib/binding_rust/lib.rs:3779 impl Point::new | unresolved |
