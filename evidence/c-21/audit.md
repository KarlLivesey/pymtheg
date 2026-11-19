# C-21 hand audit

## 40 newly resolved links (fixed seed)

Population: every Rust link resolved on the branch and not on main, on the 7
pins with newly read files (2,461 links on the final runs, main `920dc47`
against the merged branch: 626 old sites that became resolved and 1,835 new
sites, all in the newly read files), ordered by
`sha256("c21|" + repo + "|" + site)`, first 40
([`compare.mjs`](compare.mjs), context by [`audit-context.mjs`](audit-context.mjs)).
Each was checked against the pinned source: the reference, the imports or
local declarations in scope, and the target declaration.

**Result: 40 of 40 right.** The sample was first drawn on the runs before the
merge of C-18 (2,407 links); the final runs give the same first 40 links with
the same targets.

|   # | Repository | Site                                       | Link                                                   | Target                                             | Why it is right                                                               |
| --: | ---------- | ------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------- |
|   1 | turborepo  | `turborepo-api-client/src/retry.rs:203`    | calls `Retry::Once` (old site)                         | variant `Once`, `retry.rs:157`                     | `enum Retry` in the same file                                                 |
|   2 | turborepo  | `turborepo-api-client/src/lib.rs:1260`     | calls `retry::make_retryable_request`                  | fn, `retry.rs:191`                                 | `mod retry;` in lib.rs; `pub(crate)`                                          |
|   3 | turborepo  | `turborepo-wax/src/rule.rs:335`            | types `TokenTree`                                      | trait, `token/mod.rs:30`                           | `use crate::{token::{…, TokenTree, …}}`                                       |
|   4 | turborepo  | `turborepo-wax/src/rule.rs:368`            | types `Checked`                                        | struct, `rule.rs:271`                              | same file                                                                     |
|   5 | mdBook     | `tests/testsuite/markdown.rs:169`          | calls `BookTest::from_dir`                             | method, `book_test.rs:37`                          | the test suite's `BookTest`                                                   |
|   6 | rustls     | `rustls/src/server/hs.rs:925`              | values `self`                                          | method `start` (local)                             | `self` of `start`, line 924                                                   |
|   7 | rustls     | `rustls/src/server/hs.rs:784`              | types `OfferedKxGroup`                                 | struct, `server/config.rs:947`                     | `use super::config::{…, OfferedKxGroup, …}`                                   |
|   8 | rustls     | `rustls/src/server/test.rs:206`            | calls `process` (old site)                             | fn, `test.rs:784`                                  | same file                                                                     |
|   9 | mdBook     | `tests/testsuite/markdown.rs:104`          | calls `BookTest::from_dir`                             | method, `book_test.rs:37`                          | as #5                                                                         |
|  10 | dioxus     | `packages/desktop/src/config.rs:434`       | calls `self.window.with_disable_context_menu`          | `WindowConfig` method, line 150                    | `Config.window: WindowConfig` (line 337)                                      |
|  11 | turborepo  | `turborepo-wax/src/rule.rs:764`            | values `RuleErrorKind::OversizedInvariant`             | variant, `rule.rs:265`                             | same file                                                                     |
|  12 | turborepo  | `turborepo-api-client/src/lib.rs:139`      | types `Team`                                           | struct, `turborepo-vercel-api/src/lib.rs:79`       | `use turborepo_vercel_api::{…, Team, …}`                                      |
|  13 | rustls     | `rustls/src/server/hs.rs:59`               | values `self`                                          | method `set_resumption_data` (local)               | `&mut self`, line 58                                                          |
|  14 | turborepo  | `turborepo-wax/src/rule.rs:673`            | patterns `Separator`                                   | variant `TokenKind::Separator`, `token/mod.rs:264` | fn-level `use crate::token::{TokenKind::{Separator, Wildcard}, …}` (line 400) |
|  15 | turborepo  | `turborepo-auth/src/auth/login.rs:9`       | imports `turborepo_api_client::CacheClient` (old site) | trait, api-client `lib.rs:159`                     | the now readable crate root                                                   |
|  16 | turborepo  | `turborepo-api-client/src/retry.rs:365`    | values `RetryStrategy::Timeout` (old site)             | variant, `retry.rs:239`                            | same file                                                                     |
|  17 | turborepo  | `turborepo-wax/src/rule.rs:320`            | calls `self.release`                                   | method `Checked::release`, line 276                | `impl<T> Checked<T>` applies to `Checked<Tokenized>`                          |
|  18 | turborepo  | `turborepo-wax/src/encode.rs:301`          | patterns `Wildcard`                                    | variant `TokenKind::Wildcard`, `token/mod.rs:265`  | fn-level `use crate::token::{…, TokenKind::{…, Wildcard}, …}` (line 191)      |
|  19 | turborepo  | `turborepo-api-client/src/lib.rs:250`      | types `Client`                                         | trait, `lib.rs:132`                                | same file                                                                     |
|  20 | dioxus     | `packages/desktop/src/config.rs:517`       | calls `self.window.with_background_color`              | `WindowConfig` method, line 271                    | as #10                                                                        |
|  21 | turborepo  | `turborepo-cache/src/artifact_body.rs:236` | types `turborepo_api_client::Error` (old site)         | enum, api-client `error.rs:9`                      | `pub use crate::error::{Error, Result}` in api-client lib.rs                  |
|  22 | turborepo  | `turborepo-api-client/src/lib.rs:810`      | calls `Self::build_http_client_with_native_roots`      | method, `lib.rs:813`                               | same impl                                                                     |
|  23 | dioxus     | `packages/fullstack/src/lib.rs:57`         | imports `crate::request::FromResponseParts` (old site) | trait, `request.rs:111`                            | the newly read `request.rs`                                                   |
|  24 | turborepo  | `turborepo-api-client/src/lib.rs:252`      | types `Result`                                         | alias, `error.rs:62`                               | `pub use crate::error::{Error, Result}`                                       |
|  25 | rustls     | `rustls/src/server/hs.rs:385`              | values `protocol`                                      | method `from` (local)                              | bound by `AlpnDecision::Selected(protocol)`                                   |
|  26 | rustls     | `rustls/src/server/hs.rs:795`              | calls `offered`                                        | `choose_suite_and_kx_group` (local)                | `let offered = \|\| …` (line 773)                                             |
|  27 | turborepo  | `turborepo-cache/src/http.rs:923`          | types `APIAuth` (old site)                             | struct, api-client `lib.rs:228`                    | `use turborepo_api_client::{APIAuth, …}`                                      |
|  28 | dioxus     | `packages/fullstack/src/request.rs:48`     | types `R`                                              | trait `FromResponse` (type parameter)              | `trait FromResponse<R = ClientResponse>`                                      |
|  29 | turborepo  | `turborepo-api-client/src/analytics.rs:16` | types `AnalyticsClient` (old site)                     | trait, `analytics.rs:8`                            | same file                                                                     |
|  30 | turborepo  | `turborepo-wax/src/rule.rs:341`            | types `Any`                                            | struct, wax `lib.rs:848`                           | `use crate::{Any, …}`                                                         |
|  31 | turborepo  | `turborepo-api-client/src/retry.rs:69`     | values `deadline` (old site)                           | `make_rate_limited_request` (local)                | a local of that function                                                      |
|  32 | turborepo  | `turborepo-cache/src/size.rs:123`          | calls `parse_human_size` (old site)                    | fn, `size.rs:28`                                   | test module of the same file                                                  |
|  33 | alacritty  | `alacritty/src/display/mod.rs:85`          | types `window::Error` (old site)                       | enum, `display/window.rs:59`                       | `mod window;` in display                                                      |
|  34 | alacritty  | `alacritty/src/display/window.rs:95`       | types `Self`                                           | enum `Error`, line 59                              | `impl From<crossfont::Error> for Error`                                       |
|  35 | rustls     | `rustls/src/server/hs.rs:887`              | calls `crate::check::inappropriate_handshake_message`  | fn, `check.rs:54`                                  | expansion of `require_handshake_msg!` (`$crate::check::…`)                    |
|  36 | rustls     | `rustls/src/server/hs.rs:553`              | calls `HandshakeHashOrBuffer::Buffer`                  | variant, `hs.rs:919`                               | same file                                                                     |
|  37 | turborepo  | `turborepo-lsp/src/lib.rs:625`             | calls `convert_ranges`                                 | fn, `lib.rs:1175`                                  | same file                                                                     |
|  38 | turborepo  | `turborepo-wax/src/rule.rs:687`            | patterns `Tree`                                        | variant `Wildcard::Tree`, `token/mod.rs:762`       | fn-level `use crate::token::{…, Wildcard::{Tree, ZeroOrMore}}`                |
|  39 | turborepo  | `turborepo-api-client/src/lib.rs:410`      | types `APIClient`                                      | struct, `lib.rs:215`                               | same file                                                                     |
|  40 | turborepo  | `turborepo-wax/src/rule.rs:719`            | patterns `Wildcard`                                    | variant `TokenKind::Wildcard`, `token/mod.rs:265`  | as #14                                                                        |

## Links definite on main that changed

Final runs (main `920dc47` against the merged branch), all 7 pins: 360,179
links definite on main (all languages), 360,178 keep their target, 1 changes.

**dioxus `packages/web/src/hydration/cursor.rs:135`, `self.base()`**
(calls): main resolves it to `HydrationCursor::base` (line 88), which is
right. The branch leaves it unresolved (`inherent-applicability-unverified`):
lost, not wrong. Cause: the newly read
`packages/interpreter/src/unified_bindings.rs` (patch 0009) holds
`impl Interpreter { pub fn base(&self) -> &BaseInterpreter }`, where
`Interpreter` is declared inside `#[sledgehammer_bindgen::bindgen(module)] mod
js`, which the resolver cannot read. It keeps the impl's methods as unknown
inherent methods for every crate that depends on the interpreter crate
(`retainUnknown`), so a first-step call of a method named `base` there is no
longer proved. The four other `self.base()` calls in the file take `&mut self`
and were already unresolved on main. Deterministic: two runs of each build on
dioxus agree. Rust only allows an inherent impl in its type's crate, so an
unknown inherent impl in a dependency could be ruled out; that is resolver
work, outside this chunk (listed for the manager).

Before the merge of C-18, turborepo `crates/turborepo-auth/src/auth/login.rs:38`
(`match error`, a parameter) also went from resolved to unresolved; on the
merged builds it is unchanged.

Other changed rows (not definite on main): 603 unresolved → library (std
macros such as `vec!` and `assert!` whose textual macro scope passed a
failed file, and paths into the newly read crate roots) and 1 library →
unresolved (dioxus `payloads/sse.rs`, below).
