# C-21 tree gate

Every `.rs` file of the 20 Rust sweep pins, vercel/turborepo (a TypeScript pin
with a large Rust workspace) and the pinned Vector corpus (`515e87d9`, read
only) was parsed with main's grammar (sha256 `66a1d357…`, W2-V) and with this
branch's (`421c975a…`), by [`tree-compare.mjs`](tree-compare.mjs). A tree is
compared node by node, named and anonymous, with type, field name and byte
range, so this is stricter than comparing S-expressions. A file fails when its
tree has an ERROR or MISSING node (the module's whole-file rule).

The six single-patch builds (patches 0001–0008 plus exactly one of 0009–0014,
[`grammar-dev.mjs`](grammar-dev.mjs) with `ONLY=`) were compared the same way.
Each also leaves every previously parsed tree identical and breaks no file,
and each newly read file below is read by exactly one of them on its own.
Summary by [`tree-summary.mjs`](tree-summary.mjs).

Gate results:

1. **11,022 of 11,022 files that parsed before give identical trees.**
2. **48 files are newly read**, each tied to one patch (table below).
3. **No file that parsed before now fails.**
4. **19 files still fail**, each with its cause (last table): 2 mdBook
   documentation snippets with hidden `#` lines (not Rust), 8 tauri
   handlebars templates (not Rust), the embassy compile-fail UI test
   `where (): Sized` (a `()` type on the left of a where predicate), 5 swc
   generated visitors with a numbered field in a struct pattern
   (`AbsoluteColorBase::HexColor { 0: _field_0 }`), swc `config/mod.rs` (an
   attribute on a later tuple element; on main its first error was the
   lifetime-first `dyn` that 0010 now reads), and Vector's 2 known gaps
   (`char::<_, E>(…)`, `+ for<'a> …` bound).

| Corpus                  | .rs files | Parsed before | Identical trees | Changed | Newly read | Newly failing | Still failing |
| ----------------------- | --------: | ------------: | --------------: | ------: | ---------: | ------------: | ------------: |
| actix/actix-web         |       328 |           328 |             328 |       0 |          0 |             0 |             0 |
| alacritty/alacritty     |        88 |            87 |              87 |       0 |          1 |             0 |             0 |
| BurntSushi/ripgrep      |       102 |           102 |             102 |       0 |          0 |             0 |             0 |
| cberner/redb            |        98 |            98 |              98 |       0 |          0 |             0 |             0 |
| clap-rs/clap            |       337 |           324 |             324 |       0 |         13 |             0 |             0 |
| crossbeam-rs/crossbeam  |       114 |           114 |             114 |       0 |          0 |             0 |             0 |
| DioxusLabs/dioxus       |       884 |           881 |             881 |       0 |          3 |             0 |             0 |
| embassy-rs/embassy      |      2514 |          2513 |            2513 |       0 |          0 |             0 |             1 |
| fjall-rs/fjall          |       119 |           119 |             119 |       0 |          0 |             0 |             0 |
| helix-editor/helix      |       251 |           251 |             251 |       0 |          0 |             0 |             0 |
| ratatui/ratatui         |       250 |           250 |             250 |       0 |          0 |             0 |             0 |
| RustCrypto/hashes       |       162 |           162 |             162 |       0 |          0 |             0 |             0 |
| rust-embedded/cortex-m  |       132 |           132 |             132 |       0 |          0 |             0 |             0 |
| rust-lang/mdBook        |       102 |            83 |              83 |       0 |         17 |             0 |             2 |
| rustls/rustls           |       172 |           171 |             171 |       0 |          1 |             0 |             0 |
| serde-rs/serde          |       208 |           208 |             208 |       0 |          0 |             0 |             0 |
| swc-project/swc         |      1523 |          1511 |            1511 |       0 |          6 |             0 |             6 |
| tauri-apps/tauri        |       331 |           322 |             322 |       0 |          1 |             0 |             8 |
| tokio-rs/axum           |       305 |           305 |             305 |       0 |          0 |             0 |             0 |
| tree-sitter/tree-sitter |       113 |           113 |             113 |       0 |          0 |             0 |             0 |
| vercel/turborepo        |      1393 |          1388 |            1388 |       0 |          5 |             0 |             0 |
| vector                  |      1563 |          1560 |            1560 |       0 |          1 |             0 |             2 |
| **Total**               |     11089 |         11022 |           11022 |       0 |         48 |             0 |            19 |

## Newly read files, each with the one patch that reads it alone

| Corpus              | File                                                      | Error on main's grammar                              | Patch |
| ------------------- | --------------------------------------------------------- | ---------------------------------------------------- | ----- |
| alacritty/alacritty | `alacritty/src/display/window.rs`                         | line 136:9 `#[rustfmt::skip]`                        | 0011  |
| clap-rs/clap        | `tests/builder/cargo.rs`                                  | line 36:57 `!`                                       | 0009  |
| clap-rs/clap        | `tests/builder/default_vals.rs`                           | line 53:58 `!`                                       | 0009  |
| clap-rs/clap        | `tests/builder/double_require.rs`                         | line 46:57 `!`                                       | 0009  |
| clap-rs/clap        | `tests/builder/error.rs`                                  | line 8:22 `!`                                        | 0009  |
| clap-rs/clap        | `tests/builder/groups.rs`                                 | line 149:12 `!`                                      | 0009  |
| clap-rs/clap        | `tests/builder/help.rs`                                   | line 109:23 `!`                                      | 0009  |
| clap-rs/clap        | `tests/builder/ignore_errors.rs`                          | line 132:12 `!`                                      | 0009  |
| clap-rs/clap        | `tests/builder/multiple_values.rs`                        | line 186:12 `!`                                      | 0009  |
| clap-rs/clap        | `tests/builder/subcommands.rs`                            | line 505:67 `!`                                      | 0009  |
| clap-rs/clap        | `tests/builder/version.rs`                                | line 35:12 `!`                                       | 0009  |
| clap-rs/clap        | `tests/derive/doc_comments_help.rs`                       | line 441:21 `!`                                      | 0009  |
| clap-rs/clap        | `tests/derive/groups.rs`                                  | line 48:21 `!`                                       | 0009  |
| clap-rs/clap        | `tests/derive/help.rs`                                    | line 230:23 `!`                                      | 0009  |
| DioxusLabs/dioxus   | `packages/desktop/src/config.rs`                          | line 16:5 `dyn`                                      | 0010  |
| DioxusLabs/dioxus   | `packages/fullstack/src/request.rs`                       | line 64:33 `::<serde_json::Value>`                   | 0014  |
| DioxusLabs/dioxus   | `packages/interpreter/src/unified_bindings.rs`            | line 64:33 `str<`                                    | 0009  |
| rust-lang/mdBook    | `tests/testsuite/build.rs`                                | line 12:30 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/cli.rs`                                  | line 15:31 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/config.rs`                               | line 121:35 `!`                                      | 0009  |
| rust-lang/mdBook    | `tests/testsuite/includes.rs`                             | line 12:16 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/index.rs`                                | line 11:12 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/init.rs`                                 | line 13:30 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/markdown.rs`                             | line 10:67 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/playground.rs`                           | line 10:12 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/preprocessor.rs`                         | line 65:30 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/redirects.rs`                            | line 24:47 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/renderer.rs`                             | line 65:35 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/rendering.rs`                            | line 35:16 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/search.rs`                               | line 128:47 `!`                                      | 0009  |
| rust-lang/mdBook    | `tests/testsuite/sidebar_logo.rs`                         | line 43:34 `!`                                       | 0009  |
| rust-lang/mdBook    | `tests/testsuite/test.rs`                                 | line 9:30 `!`                                        | 0009  |
| rust-lang/mdBook    | `tests/testsuite/theme.rs`                                | line 9:47 `!`                                        | 0009  |
| rust-lang/mdBook    | `tests/testsuite/toc.rs`                                  | line 148:26 `!`                                      | 0009  |
| rustls/rustls       | `rustls/src/server/hs.rs`                                 | line 608:9 `dyn`                                     | 0013  |
| swc-project/swc     | `crates/swc_bundler/src/bundler/chunk/merge.rs`           | line 1389:23 `'`                                     | 0010  |
| swc-project/swc     | `crates/swc_bundler/src/bundler/mod.rs`                   | line 102:19 `'`                                      | 0010  |
| swc-project/swc     | `crates/swc_css_prefixer/src/prefixer.rs`                 | line 814:31 `'`                                      | 0010  |
| swc-project/swc     | `crates/swc_ecma_compat_es2015/src/block_scoping/vars.rs` | line 64:59 `'`                                       | 0010  |
| swc-project/swc     | `crates/swc_ecma_transforms_testing/src/babel_like.rs`    | line 22:13 `'`                                       | 0010  |
| swc-project/swc     | `crates/swc_ecma_transforms_testing/src/lib.rs`           | line 912:17 `'`                                      | 0010  |
| tauri-apps/tauri    | `examples/file-associations/src-tauri/src/main.rs`        | line 52:12 `\|`                                      | 0011  |
| vercel/turborepo    | `crates/turborepo-api-client/src/lib.rs`                  | line 823:22 `#[allow(unused_variables)]`             | 0011  |
| vercel/turborepo    | `crates/turborepo-cache/src/multiplexer.rs`               | line 188:21 `box`                                    | 0012  |
| vercel/turborepo    | `crates/turborepo-lsp/src/lib.rs`                         | line 437:53 `box`                                    | 0012  |
| vercel/turborepo    | `crates/turborepo-wax/src/encode.rs`                      | line 87:45 `'`                                       | 0010  |
| vercel/turborepo    | `crates/turborepo-wax/src/rule.rs`                        | line 220:45 `'`                                      | 0010  |
| vector              | `lib/codecs/tests/avro.rs`                                | line 24:5 `#[files("tests/data/avro/generated/*.avr` | 0011  |

## Files still failing on this branch

| Corpus             | File                                                                             | First error                                            |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| embassy-rs/embassy | `embassy-executor/tests/ui/where_clause.rs`                                      | line 8:6 `missing type_identifier`                     |
| rust-lang/mdBook   | `guide/src/format/example.rs`                                                    | line 3:1 `# #`                                         |
| rust-lang/mdBook   | `tests/testsuite/includes/all_includes/src/example.rs`                           | line 3:1 `# #`                                         |
| swc-project/swc    | `crates/swc/src/config/mod.rs`                                                   | line 952:21 `#[cfg(feature = "lint")]`                 |
| swc-project/swc    | `crates/swc_css_visit/src/generated.rs`                                          | line 7838:43 `0:`                                      |
| swc-project/swc    | `crates/swc_ecma_regexp_visit/src/generated.rs`                                  | line 1376:59 `0:`                                      |
| swc-project/swc    | `crates/swc_ecma_visit/src/generated.rs`                                         | line 10045:47 `0:`                                     |
| swc-project/swc    | `crates/swc_html_visit/src/generated.rs`                                         | line 870:35 `0:`                                       |
| swc-project/swc    | `crates/swc_xml_visit/src/generated.rs`                                          | line 828:35 `0:`                                       |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/__example-api/tauri-app/src-tauri/src/lib.rs` | line 11:30 `{`                                         |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/__example-basic/vanilla/src-tauri/src/lib.rs` | line 4:26 `{`                                          |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/src/commands.rs`                              | line 1:3 `#if`                                         |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/src/desktop.rs`                               | line 1:1 `{{#if license_header}} {{ license_header`    |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/src/error.rs`                                 | line 1:3 `#if`                                         |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/src/lib.rs`                                   | line 1:3 `#if`                                         |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/src/mobile.rs`                                | line 1:3 `#if`                                         |
| tauri-apps/tauri   | `crates/tauri-cli/templates/plugin/src/models.rs`                                | line 1:3 `#if`                                         |
| vector             | `lib/prometheus-parser/src/line.rs`                                              | line 363:37 `::`                                       |
| vector             | `lib/tracing-limit/src/lib.rs`                                                   | line 740:25 `+ for<'a> tracing_subscriber::registry::` |
