# C-12 remaining Rust macro opacity

The 18 pinned graphs at `ca9d20d` contain **166,999** unresolved Rust links
whose stored reason includes `opaque-item-may-shadow-name`. The separate
library-path replay counted **81,257** named library paths still withheld
under the macro-scope reason. That replay groups paths by their original
library diagnostic. [Coverage and library-path replay](README.md#named-library-paths-still-withheld)

The census replays each pinned graph's captured facts and finds macro
origins for the scope guards that still block a lookup after the C-12
proof and assumption checks. A site can encounter several opaque origins.
Each row counts a site once, under the first named blocking origin visited
in the replay. A recorded spelling can occur in several kinds when its
binding or position differs across sites. The ranked counts attribute
links to spellings and do not count invocations or predict recoverable links.
[Replay script](remaining.mjs)

Run the replay with the follow-up build and the original pin sweep's
results and work directory.

```text
node evidence/c-12/remaining.mjs <build-directory> <pinned-run.json> <pinned-work-directory> <output.json>
```

| Primary blocker | Links | What would make lookup safe |
| --- | ---: | --- |
| A. Derive on an item in scope | 68,999 | Establish the derive identity and rule out emission of the queried name in the relevant namespace. Built-in derives are provable once bound. An external derive needs a verified output bound or an explicit assumption about its output. |
| B. Other attribute proc macro | 10,972 | Establish that the expansion preserves the queried binding and cannot emit a competing name into its scope. A bounded transform is provable. For an external transform with unknown output, that claim can only be an assumption. |
| C. External function-like macro at item position | 2,002 | Establish the macro's source and bound the names exported by this invocation. A verified declarative transcriber can prove that bound. An unknown expansion needs a recordable assumption that covers the specific name and input. |
| D. Local `macro_rules!` at item position | 16,014 | Bound the emitted names through repetitions, fragments, nested calls and imports. Some transcribers admit a static proof. A matching emitted name or an unreadable layout leaves the original lookup unsafe. |
| E. Macro in a block | 6,358 | Rule out new items and bindings in the same block, accounting for order and hygiene. A verified macro and sufficient scope facts can prove this. A specific external binding bound may be assumable. |
| F. Other or unattributed | 62,654 | Recover the binding, scope, or layout evidence before judging the name. Some identities and layouts are provable with more facts. A missing identity or unobserved origin alone supports neither proof nor assumption. |
| **Total** | **166,999** | |

### Most frequent spellings by kind

These are the top 15 call-site spellings with attributed link counts.
The external item-position row has 13 distinct spellings. The derive row
includes familiar built-in spellings where the replay could not establish
the prelude binding, such as when a glob or macro import competes.
The attribute proc-macro row requires a captured proc-macro declaration or
a Cargo macro binding in the attribute namespace.

| Kind | Spellings in descending order |
| --- | --- |
| A | `Debug` 19,439, `Clone` 7,954, `Deserialize` 5,450, `PartialEq` 4,376, `Serialize` 4,351, `serde::Deserialize` 3,728, `Copy` 3,449, `serde::Serialize` 3,265, `Default` 2,287, `JsonSchema` 2,014, `Parser` 1,836, `Hash` 1,832, `Error` 1,302, `Eq` 1,279, `thiserror::Error` 1,045 |
| B | `tokio::test` 5,948, `tokio::main` 2,028, `default_runtime` 723, `retry` 415, `command` 346, `rustversion::attr` 305, `serial_test::serial` 169, `tauri_macros::default_runtime` 162, `test_log::test` 122, `asm_cfg` 102, `actix_rt::main` 91, `divan::bench` 90, `scope` 84, `wasm_bindgen::prelude::wasm_bindgen` 57, `macro_rules_attribute::apply` 48 |
| C | `pin_project!` 1,364, `slotmap::new_key_type!` 192, `cfg_if::cfg_if!` 185, `quickcheck::quickcheck!` 125, `digest::buffer_fixed!` 46, `new_test!` 26, `bitflags::bitflags!` 22, `syn::custom_keyword!` 16, `digest::buffer_ct_variable!` 12, `new_mac_test!` 7, `digest::new_test!` 3, `bench_update!` 2, `fuzz_target!` 2 |
| D | `read_impls!` 1,470, `unstable_struct!` 1,465, `lsp_enum!` 1,368, `enum_builder!` 1,001, `embed_files!` 940, `extension_struct!` 890, `shared_app_impl!` 709, `top_level_service_fn!` 513, `gen_wrappers!` 506, `codegen_reexport!` 468, `composite_rejection!` 384, `all_the_tuples_no_last_special_case!` 382, `rustls_test::provider_aws_lc_rs!` 357, `nonzero_impl!` 321, `nonzero_encoding_test!` 290 |
| E | `rsx!` 1,259, `debug!` 1,193, `assert_eq!` 764, `trace!` 503, `quote!` 354, `thread_local!` 275, `quote_block!` 215, `select!` 208, `println!` 206, `tri!` 126, `deriving!` 105, `info!` 102, `assert_json_eq!` 71, `tracing::debug!` 67, `add_line!` 64 |
| F | `test` 16,824, `bitflags` 4,701, `rstest` 4,059, `diagnostic::do_not_recommend` 3,006, `thread_local` 1,776, `tokio::test` 1,752, `tokio::main` 1,664, `declare_error_trait` 1,617, `rustfmt::skip` 1,582, `crate::test` 1,309, `component` 1,197, `fixture` 931, `pyclass` 897, `impl_deserialize_num` 801, `get` 736 |

### Local transcriber constructs and unattributed links

The resolver identifies unresolved local transcribers. For those that are
generically opaque, the replay labels visible constructs in the captured
definition's source. A construct can co-occur with another in an arm.
These labels summarize the blocked cases and do not add a new proof rule.

| Local transcriber finding | Links |
| --- | ---: |
| Wildcard or token-built import | 5,449 |
| Identifier in a keyword position | 4,064 |
| Repeated output tokens | 1,561 |
| Token, item or statement fragments with attributes and repeated output | 1,528 |
| Attributes with repeated output | 1,202 |
| Other item header or dynamic macro call | 849 |
| Unverified placement or input | 709 |
| Attributes in output | 502 |
| Token, item or statement fragments with repeated output | 83 |
| Unsettled nested expansion | 67 |
| **Total** | **16,014** |

Kind F includes 35,907 links beside an unverified attribute binding,
13,257 beside an unverified function-like macro identity, and 496 beside
a layout macro. For 11,973 links the replay found no named final blocking
origin. Another 1,021 links came from derived facts outside the parse-link
walk. Those two placeholders are excluded from the name ranking.
