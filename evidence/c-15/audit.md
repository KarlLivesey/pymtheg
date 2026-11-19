# C-15 hand audit

This branch resolves no link that main withheld: every outcome, target,
candidate set and library row is the same on all compared pins. So the audit
is of what did change, the reason. From each affected repository, the 12
links whose `failed-file-unseen-declarations` reason was dropped with the
lowest fixed-seed hash (seed `c15`, `compare.mjs`) were read against the
pinned source ([`audit-sample.json`](audit-sample.json)).

The question for each: could the content of the failed file(s) change this
link's answer? **Right** means no: what stops the link is visible and the
failed file cannot add a declaration that would answer it (its module is not
in the lookup's path, no glob of it is in scope, and for a call it cannot
hold an inherent impl of the type). **Wrong** means it could. **Cannot tell**
means the source does not settle it.

Every one of the 60 was also checked mechanically, as was every dropped
reason in the five repositories (37,000+ links): none changes outcome in the
diagnostic build that empties the failed files (`cross-check.mjs`).

Result: **60 right, 0 wrong, 0 cannot tell.**

## alacritty/alacritty (failed: `alacritty/src/display/window.rs`)

| Site | Link | Remaining reason | Why the failed file cannot change it |
| --- | --- | --- | --- |
| `display/mod.rs:1341` | `LineDamageBounds::new` | path type unverified, opaque macro | Type of `alacritty_terminal`; an inherent `new` can only be there; the opaque macro stays |
| `input/keyboard.rs:619` | pattern `NamedKey::Shift` | opaque macro | winit variant named by an explicit import; the macro doubt stays |
| `scheduler.rs:62` | `self.timers.pop_front()` | receiver, namespace binding | `VecDeque` field: outside type |
| `input/keyboard.rs:323` | `context.try_build_control_char_or_mod` | later probe step | autoref blocked by a visible trait or import, not by the failure |
| `display/hint.rs:96` | `self.matches.extend` | receiver | `Vec` field: outside type |
| `display/mod.rs:1070` | `point` | (none) | `let` binding; unproved because `use glutin::prelude::*` could supply a constant; `display::window` adds nothing to `display`'s scope |
| `config/bindings.rs:723` | `"=".into()` | receiver | literal receiver (parser gap) |
| `event.rs:979` | `….damage_tracker.frame()` | later probe step | visible blocker as above |
| `renderer/text/glyph_cache.rs:150` | `load_or_regular(…)` | (none) | closure binding; unproved because of `use crate::gl::types::*`, a different module |
| `input/mod.rs:767` | `f64::from` | path type unverified | trait call on a primitive |
| `input/keyboard.rs:395` | `u32::from` | path type, opaque macro | trait call on a primitive |
| `input/mod.rs:936` | `Default::default` | path type unverified | trait path |

## rust-lang/mdBook (failed: 17 `tests/testsuite/*.rs` modules and 2 snippets)

| Site | Link | Remaining reason | Why |
| --- | --- | --- | --- |
| `tests/testsuite/book_test.rs:186` | `line.trim().strip_prefix` | receiver | closure parameter (parser gap) |
| `book_test.rs:187` | `line.strip_suffix` | receiver | closure parameter |
| `book_test.rs:331` | `std::fs::remove_file` | path type | `std` path; sibling modules add nothing to `book_test`'s scope |
| `book_test.rs:560` | `glob::glob` | path type | dependency crate path, same |
| `book_test.rs:171` | `self.toc_js_html()` | later probe step | visible blocker |
| `book_test.rs:536` | type `Path` | namespace binding | explicit `std` import |
| `book_test.rs:99` | type `IntoData` | namespace binding | explicit `snapbox` import |
| `book_test.rs:484` | `self.assert.try_eq` | receiver | `snapbox::Assert` field: outside type |
| `book_test.rs:70` | type `PathBuf` | namespace binding | explicit `std` import |
| `book_test.rs:345` | `fs::create_dir_all(&parent).unwrap` | receiver, namespace binding | receiver from a `std` call |
| `book_test.rs:505` | `s.split_whitespace` | receiver | `&str` receiver |
| `book_test.rs:264` | `self.assert.eq` | receiver | outside field type |

## rustls/rustls (failed: `rustls/src/server/hs.rs`)

| Site | Link | Remaining reason | Why |
| --- | --- | --- | --- |
| `msgs/handshake_test.rs:245` | `ExtensionType::KeyShare` | opaque macro | different module; the macro doubt stays |
| `quic.rs:658` | type `Sync` | opaque macro | prelude trait; the failed module is not in scope |
| `server/tls13.rs:318` | `signer` | (none) | binding inside `mod client_hello { use super::*; … }`; its imports from `server::hs` are explicit names (`ClientHelloInput`, `ServerHandler`, …), none `signer` |
| `msgs/server_hello.rs:99` | `ExtensionType::read` | path type, cfg, opaque macro, macro body | inside a macro body; all visible |
| `client/test.rs:460` | `ServerName::try_from` | path type, namespace binding | trait call on an outside type |
| `client/hs.rs:434` | `hrr` | (none) | `client::hs`, not `server::hs`; no glob of the failed module |
| `tls13/key_schedule.rs:976` | `self.sign_verify_data` | receiver, cfg | method on a type in `tls13`; cfg alternative visible |
| `crypto/cipher/messages.rs:682` | `OutboundPlain::Single` | opaque macro, path type | visible macro doubt |
| `webpki/client_verifier.rs:497` | `WebPkiClientVerifier::builder` | path type, opaque macro | visible macro doubt |
| `enums.rs:127` | `data.as_ref()` | receiver | pattern binding (parser gap) |
| `msgs/handshake.rs:12` | import `crate::crypto::kx::NamedGroup` | cfg, opaque macro | path through `crypto::kx`, not the failed module |
| `conn/mod.rs:581` | type `Box` | namespace binding | prelude type |

## DioxusLabs/dioxus (failed: `fullstack/src/request.rs`, `desktop/src/config.rs`, `interpreter/src/unified_bindings.rs`)

| Site | Link | Remaining reason | Why |
| --- | --- | --- | --- |
| `fullstack/src/payloads/cbor.rs:83` | `(…).into_response()` | receiver | tuple literal (parser gap) |
| `desktop/src/webview.rs:22` | type `tao::dpi::Size` | opaque macro | extern crate path; `config.rs` cannot shadow `tao` in `webview`'s scope |
| `web/src/files.rs:125` | `file.array_buffer()` | receiver | generic call (parser gap) |
| `web/src/hydration/walk.rs:70` | `element.children()` | receiver, opaque macro | `StaticElement` from `dioxus-core`, which has no failed file |
| `web/src/document.rs:110` | `WebHistory::default` | trait dispatch | `dioxus-web` has no failed file, so no unseen inherent `default` |
| `fullstack-server/src/isrg/fs_cache.rs:64` | `entry.file_type().map` | receiver | iterator item (parser gap) |
| `web/src/files.rs:182` | `FileReader::new` | path type, namespace binding | `web_sys` type |
| `fullstack-server/src/ssr.rs:330` | `renderer.render` | receiver | `Self`-typed receiver (parser gap) |
| `fullstack-server/src/ssr.rs:590` | `anchor.nodes()` | receiver | iterator item |
| `fullstack-server/src/launch.rs:156` | `hot_serve_callback.call` | inherent applicability | visible inherent doubt |
| `web/src/history.rs:401` | type `History` | namespace binding | `web_sys` import |
| `fullstack/src/magic.rs:398` | pattern `Ok` | opaque macro | `request::*` is glob-imported at the crate root, not in `magic`, whose imports name items explicitly |

TURBOREPO
