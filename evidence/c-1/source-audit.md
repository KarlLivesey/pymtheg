# Source audit of newly available definite links

The three pins in this draw are Dioxus, Rustls and Serde. All three reached the
wall limit in the release sweep. The population is the candidate's definite
Rust checkout links other than structural `contains` links. The seed
`pymtheg-c1-definite-links` ranked stable source sites by SHA-256. The 20
lowest ranks yielded 13 Dioxus and seven Rustls links. Each target was checked
against the pinned source and, for cross-file links, its binding or re-export.
[Draw script](sample-links.mjs) · [Pinned revisions](../../sweep/repos.json)

| Repository | File and line | Stored target | Source basis |
| --- | --- | --- | --- |
| Rustls | `rustls/src/client/test.rs:243` | `rustls/src/msgs/mod.rs:372` `HandshakeMessagePayload` | The `crate::msgs` import at line 28 names the tuple struct. The site calls its constructor. |
| Dioxus | `packages/wasm-split/wasm-split/src/lib.rs:11` | `packages/wasm-split/wasm-split-macro/src/lib.rs:8` `wasm_split` | The re-export names the workspace dependency. The root manifest gives its path and the sibling crate declares the attribute macro. |
| Dioxus | `packages/signals/src/read.rs:451` | `packages/signals/src/read.rs:41` `Readable` | The `ReadableStrExt` supertrait is the `Readable` trait declared in the same module. |
| Dioxus | `packages/fuzz/src/harness.rs:2082` | `packages/fuzz/src/model.rs:971` `WakeMutationSpec::None` | The crate's `model::*` import brings the enum into scope. The use names its unit variant. |
| Dioxus | `packages/fullstack-server/src/ssr.rs:112` | `packages/fullstack-server/src/isrg/mod.rs:152` `IncrementalRendererError` | The `crate::isrg` import at lines 2–3 names this enum. |
| Rustls | `rustls-test/src/lib.rs:858` | `rustls-test/src/lib.rs:994` `ErrorFromPeer::Client` | `map_err` receives the tuple variant of the local `ErrorFromPeer` enum. |
| Dioxus | `packages/fuzz/src/model.rs:408` | `packages/fuzz/src/model.rs:524` `TemplateNodeSpec` | The slice element type is the enum in the same module. |
| Rustls | `rustls/src/client/config.rs:29` | `rustls/src/lib.rs:346` `sync::Arc` | The anchored import names the type alias in the crate root's `sync` module. |
| Dioxus | `packages/vdom/src/suspense/component.rs:235` | `packages/vdom/src/suspense/component.rs:227` `SuspenseBoundaryPropsWithOwner` | The `Clone` signature in the struct's impl returns the same local struct. |
| Rustls | `bogo/src/main.rs:98` | `bogo/src/main.rs:424` `SideConfig::Server` | The server branch calls the tuple variant constructor of the local `SideConfig` enum. |
| Dioxus | `packages/manganis/manganis-macro/src/ffi.rs:240` | `packages/manganis/manganis-macro/src/ffi.rs:49` `ForeignType::Unit` | The default return arm names the local enum's unit variant. |
| Dioxus | `packages/signals/src/write.rs:486` | `packages/signals/src/write.rs:451` `WritableResultExt` | The blanket impl names the trait declared just above in the same module. |
| Dioxus | `packages/stores/src/impls/result.rs:152` | `packages/stores/src/store.rs:17` `MappedStore` | The explicit `crate::MappedStore` import uses the root's `pub use store::*` re-export. |
| Rustls | `rustls-ring/src/sign.rs:21` | `rustls-ring/src/sign.rs:17` `RsaSigningKey` | The inherent impl names the adjacent local struct. |
| Dioxus | `packages/dx/src/serve/server.rs:118` | `packages/dx/src/serve/server.rs:53` `WebServer` | The struct literal uses `Self` within the inherent `impl WebServer` at line 73. |
| Dioxus | `packages/vdom/src/properties.rs:93` | `packages/vdom/src/properties.rs:82` `RootProps` | The generic impl names the local tuple struct `RootProps<P>`. |
| Dioxus | `packages/web/src/history.rs:330` | `packages/web/src/history.rs:391` `get_current` | The closure calls the free function in its enclosing module. |
| Dioxus | `packages/vdom/src/scopes.rs:25` | `packages/vdom/src/runtime.rs:154` `Runtime::try_current` | `crate::Runtime` is re-exported from `runtime` by the crate root. This is its inherent associated function. |
| Rustls | `rustls-aws-lc-rs/src/verify.rs:45` | `rustls-aws-lc-rs/src/verify.rs:167` `ECDSA_P256_SHA256` | The slice contains the static algorithm defined in the same module. |
| Rustls | `rustls/src/msgs/server_hello.rs:526` | `rustls/src/msgs/server_hello.rs:520` `EchConfigExtension::Unknown` | Inside `impl EchConfigExtension`, the pattern names that enum's tuple variant. |
