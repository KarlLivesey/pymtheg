# Coverage plan for 0.2.0

The release target is 90% coverage. The [scoreboard](../evidence/sw-3/scoreboard.md)
reports the measured baseline from `pymtheg@0.1.0`. This plan estimates how much
each support item could add. The ordering uses potential percentage points in
the item's language.

Adjusted coverage divides resolved links by resolved, ambiguous, inside-unresolved
and unclassified links. The raw score includes outside-unresolved links too.
The main plan includes every observed file scope. The source-only forecast
excludes checked-in bundles, deliberately broken fixtures and unrendered
templates. These source scopes are counted separately in the scoreboard.

A support item's link count is an estimate. The unresolved and ambiguous rows
were sampled at a fixed seed by language and recorded reason, then inspected at
the source site. The plan uses the share of each support shape within its
language, reason group and file scope. `≥` marks the number of repositories
where the sample directly showed the shape. A link that looked external or
whose target remained unclear could stay unlabeled. Some support items touch
candidate sets that may correctly remain ambiguous at run time. [Sample sizes and populations](../evidence/sw-3/sampling.md)

The Rust failed-file item uses an exact stored count of eligible unresolved
links with `failed-file-unseen-declarations`. It takes precedence when the same
link also has `receiver-type-unverified`. The grammar items estimate only the
missing outgoing links from failed files. Existing links affected elsewhere
in their crate belong to the failed-file item. [Rust resolver](../src/graph/languages/rust/resolve.ts#L4371)

The SW-1 Serde profile points to recursive scope and `use` lookups in `find`,
`children`, `inScope`, `findUsePath` and `resolveUse`. The resolver stays in
synchronous work long enough to miss the CLI's shutdown signal. The memory
and timeout rows describe separate groups of lost graphs. [Rust lookup](../src/graph/languages/rust/resolve.ts#L2169)

For TypeScript, `no-symbol` records a lookup with no usable symbol. `local`
records a declaration in the captured source that has no graph anchor. The
source review uses those meanings when assigning support items. [No symbol](../src/graph/languages/typescript/extract.ts#L263) · [Local declaration](../src/graph/languages/typescript/extract.ts#L330)

The planning baseline adds an estimate for eligible links from failed source
files and repositories that did not finish. It multiplies line counts by the
median observed eligible links per readable source line for the language.
Mixed checkouts contribute an estimate to each module with source. Missing
repositories have no measured file scopes, so both planning variants use the
same estimates for them. The source excerpts for process failures show code
from the affected pins. The process logs locate the failures only to a phase.
If one of these repositories starts indexing, its actual score replaces its
zero in the pinned mean and its estimated missing volume in the plan.

Potential gain divides the estimated eligible links by the planning
denominator for that language. The running total assumes every listed link
can become definite. That is a planning ceiling, with uncertainty from
sampling, valid ambiguous calls and estimated missing volumes. The
`unexplained` count identifies the part of the eligible population left after
these estimates, including unsampled reasons and links whose source did not
establish a support shape.

<!-- sweep:coverage:start -->

| Support item | Language | Estimated eligible links | Repositories affected | Potential gain | Two source examples | Status |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Finish Rust analysis on Dioxus, Embassy and SWC | Rust | 1,108,628 | 3 | 48.12 pp | DioxusLabs/dioxus ` packages/dx/src/main.rs:54 ` ` async fn main() -> ExitCode { `<br>embassy-rs/embassy ` cyw43/src/fmt.rs:205 ` ` pub trait Debuggable: Debug + defmt::Format {} ` | open |
| Complete TypeScript graphs when an earlier Rust analysis stalls in Dioxus or SWC | TypeScript / JS | 1,655,740 | 2 | 45.52 pp | DioxusLabs/dioxus ` packages/web/src/ts/eval.ts:11 ` ` export class WebDioxusChannel extends DioxusChannel { `<br>swc-project/swc ` packages/core/src/util.ts:2 ` ` export function wrapNativeSuper(Class) { ` | open |
| Keep Go graphs within the Node heap in mixed-language TypeScript and Turborepo checkouts | Go | 631,997 | 2 | 34.14 pp | microsoft/TypeScript ` tsc/cmd/tsc/api.go:17 ` ` type apiFlags struct { `<br>vercel/turborepo ` crates/turborepo-trace-testkit/fixtures/go/basic/main.go:24 ` ` func main() { ` | open |
| Keep Rust graph assembly within the Node heap in Turborepo | Rust | 499,445 | 1 | 21.68 pp | vercel/turborepo ` crates/turborepo/src/main.rs:38 ` ` struct TurboQueryServer; `<br>vercel/turborepo ` crates/turbo-trace/src/main.rs:12 ` ` struct Args { ` | open |
| Keep TypeScript and JavaScript graphs within the Node heap in mixed-language checkouts | TypeScript / JS | 758,969 | 2 | 20.87 pp | microsoft/TypeScript ` packages/typescript/src/api/fs.ts:23 ` ` export interface FileSystemEntries { `<br>vercel/turborepo ` packages/turbo-gen/src/types.ts:13 ` ` export interface Answers { ` | open |
| Finish the Rust resolution pass on rustls | Rust | 56,276 | 1 | 2.44 pp | rustls/rustls ` bogo/src/main.rs:56 ` ` pub fn main() { `<br>rustls/rustls ` bogo/src/opts.rs:18 ` ` pub(crate) struct Options { ` | open |
| Link TypeScript type parameters to their declarations | TypeScript / JS | 50,753 | ≥7 (10 sampled) | 1.40 pp | honojs/hono ` src/types.ts:659 ` ` I3 extends Input = I & I2, `<br>withastro/astro ` packages/astro/templates/content/types.d.ts:22 ` ` export type CollectionEntry<C extends CollectionKey> = Flatten<DataEntryMap[C]>; ` | open |
| Link Rust references to locally declared value bindings | Rust | 31,706 | ≥10 (19 sampled) | 1.38 pp | cberner/redb ` src/tree_store/btree_cursor.rs:1973 ` ` let result = operation(&mut cursor); `<br>helix-editor/helix ` helix-core/src/transaction.rs:679 ` ` if last > to { ` | open |
| Finish the recursive Rust scope and import analysis on Serde | Rust | 28,173 | 1 | 1.22 pp | serde-rs/serde ` serde_derive/src/de.rs:25 ` ` pub fn expand_derive_deserialize(input: &mut syn::DeriveInput) -> syn::Result<TokenStream> { `<br>serde-rs/serde ` serde/src/private/de.rs:38 ` ` fn deserialize_any<V>(self, _visitor: V) -> Result<V::Value, E> ` | open |
| Link TypeScript calls and references to local parameters, variables and fields | TypeScript / JS | 40,602 | ≥7 (8 sampled) | 1.12 pp | pingdotgg/t3code ` apps/server/src/auth/Layers/SessionCredentialService.ts:476 ` ` yield* emitRemoved(sessionId); `<br>honojs/hono ` src/types.ts:2582 ` ` ? Prefix ` | open |
| Infer the receiver type of a local Rust `let` when resolving a method call | Rust | 19,213 | ≥5 (12 sampled) | 0.83 pp | actix/actix-web ` actix-http/src/responses/response.rs:435 ` ` assert_eq!(res.status(), StatusCode::OK); `<br>cberner/redb ` tests/basic_tests.rs:2936 ` ` write_txn.commit().unwrap(); ` | open |
| Resolve calls through imports from checked-in TypeScript packages | TypeScript / JS | 28,270 | ≥3 (10 sampled) | 0.78 pp | vitest-dev/vitest ` test/unit/test/mocking/automocking-class-inheritance.test.ts:7 ` ` describe('not mocking class when parent is mocked', () => { `<br>withastro/astro ` packages/integrations/cloudflare/src/utils/image-config.ts:89 ` ` service: passthroughImageService(), ` | open |
| Resolve Rust method calls through `self` and fields of checked-in types | Rust | 11,323 | ≥5 (6 sampled) | 0.49 pp | BurntSushi/ripgrep ` crates/printer/src/standard.rs:802 ` ` self.record_matches(searcher, ctx.bytes(), 0..ctx.bytes().len())?; `<br>fjall-rs/fjall ` src/tx/optimistic/write_tx.rs:912 ` ` let mut t2 = env.db.write_tx()?; ` | open |
| Resolve TypeScript relative and workspace imports to checked-in source | TypeScript / JS | 17,678 | ≥3 (6 sampled) | 0.49 pp | vitest-dev/vitest ` test/browser/fixtures/print-logs/vitest.config.ts:1 ` ` import { defineConfig } from 'vitest/config' `<br>withastro/astro ` packages/astro/test/fixtures/container-custom-renderers/src/pages/button-directive.ts:1 ` ` import type { APIRoute, SSRLoadedRenderer } from 'astro'; ` | open |
| Keep independent Rust links resolvable when another file in the crate fails | Rust | 10,071 measured | 2 | 0.44 pp | alacritty/alacritty ` alacritty/src/window_context.rs:158 ` ` let mut window_context = Self::new(display, config, options, proxy)?; `<br>alacritty/alacritty ` alacritty/src/config/color.rs:264 ` ` green: Rgb::new(0x5f, 0x6f, 0x3a), ` | open |
| Parse Rust snapshot macros with nested bracket token trees | Rust | 9,830 | 2 | 0.43 pp | clap-rs/clap ` tests/builder/cargo.rs:36 ` ` utils::assert_error(err, ErrorKind::DisplayHelp, str![[r#" `<br>rust-lang/mdBook ` tests/testsuite/build.rs:12 ` ` cmd.expect_stderr(str![[r#" ` | open |
| Establish exact Go interface implementation links from known method sets | Go | 7,260 | ≥2 (3 sampled) | 0.39 pp | protocolbuffers/protobuf-go ` internal/testprotos/testeditions/test.pb.go:2190 ` ` type TestRequiredForeign struct { `<br>etcd-io/bbolt ` tests/dmflakey/dmflakey.go:133 ` ` type flakey struct { ` | open |
| Narrow Go method candidates using a source-evident receiver | Go | 7,230 | ≥4 (5 sampled) | 0.39 pp | golang/tools ` cmd/callgraph/testdata/src/pkg/pkg.go:17 ` ` i.f() // dynamic call `<br>evanw/esbuild ` internal/resolver/resolver.go:610 ` ` if !r.fs.IsAbs(firstPrefix) { ` | open |
| Resolve Rust imports and module declarations through `crate`, `self` and `super` | Rust | 3,391 | ≥3 (4 sampled) | 0.15 pp | cberner/redb ` src/transactions.rs:15 ` ` PageListMut, PageNumber, PageNumberHashMap, PageResolver, PageTracker, SerializedSavepoint, `<br>tauri-apps/tauri ` crates/tauri/src/path/plugin.rs:9 ` ` use super::{BaseDirectory, Error, PathResolver, Result}; ` | open |
| Follow TypeScript callbacks passed through props, options and destructured parameters | TypeScript / JS | 5,075 | ≥1 (1 sampled) | 0.14 pp | trpc/trpc ` packages/server/src/adapters/next-app-dir/nextAppDirCaller.ts:73 ` ` config.onError?.({ `<br>excalidraw/excalidraw ` packages/excalidraw/components/RadioSelection.tsx:50 ` ` onChange={() => props.onChange(option.value)} ` | open |
| Narrow Go references to types in generated source variants | Go | 2,405 | ≥1 (2 sampled) | 0.13 pp | protocolbuffers/protobuf-go ` internal/testprotos/test3/test3_hybrid/test.hybrid.pb.go:2323 ` ` (*TestAllTypes_NestedMessage)(nil), // 4: hybrid.goproto.proto.test3.TestAllTypes.NestedMessage `<br>protocolbuffers/protobuf-go ` cmd/protoc-gen-go/testdata/nameclash/test_name_clash_hybrid3/test_name_clash_hybrid3.pb.go:436 ` ` func (x *M3) Get_GetFoo() *M0 { ` | open |
| Recover local TypeScript links when a base configuration is missing | TypeScript / JS | 4,047 | ≥3 (14 sampled) | 0.11 pp | changesets/changesets ` packages/config/src/defaults.ts:1 ` ` import type { Config, WrittenConfig } from "@changesets/types"; `<br>withastro/astro ` packages/astro/e2e/fixtures/cloudflare/src/content.config.ts:83 ` ` description: z.string(), ` | open |
| Resolve JSX components through captured imports and local aliases | TypeScript / JS | 2,743 | ≥1 (1 sampled) | 0.08 pp | trpc/trpc ` examples/next-prisma-starter/src/pages/post/[id].tsx:114 ` ` <Empty className="border bg-background"> `<br>trpc/trpc ` examples/.test/monotest-app/src/App.tsx:21 ` ` <TRPCReactProvider> ` | open |
| Narrow TypeScript candidate sets using the concrete receiver or local declaration | TypeScript / JS | 2,671 | ≥8 (20 sampled) | 0.07 pp | colinhacks/zod ` packages/zod/src/v3/locales/en.ts:2 ` ` import { util, ZodParsedType } from "../helpers/util.js"; `<br>dexie/Dexie.js ` addons/dexie-cloud/src/sync/messagesFromServerQueue.ts:3 ` ` import { DexieCloudDB } from '../db/DexieCloudDB'; ` | open |
| Parse Rust attributes on function and closure parameters | Rust | 419 | 2 | 0.02 pp | alacritty/alacritty ` alacritty/src/display/window.rs:136 ` ` #[rustfmt::skip] `<br>tauri-apps/tauri ` examples/file-associations/src-tauri/src/main.rs:52 ` ` .setup(\|#[allow(unused_variables)] app\| { ` | open |
| Parse parenthesized Go builtins and method expressions on anonymous structs | Go | 260 | 1 | 0.01 pp | golang/tools ` go/ssa/interp/testdata/static.go:55 ` ` _ = (make)([]int, 0) `<br>golang/tools ` go/ssa/testdata/objlookup.go:116 ` ` _ = (*struct{ J }).method ` | open |
| Narrow Rust candidates using source-evident module and receiver bindings | Rust | 293 | ≥4 (12 sampled) | 0.01 pp | helix-editor/helix ` helix-term/src/application.rs:1302 ` ` pub fn event_stream(&self) -> impl Stream<Item = std::io::Result<TerminalEvent>> + Unpin { `<br>crossbeam-rs/crossbeam ` crossbeam-channel/src/flavors/array.rs:96 ` ` one_lap: Index, ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | Go | 165 | 1 | 0.01 pp | golang/tools ` cmd/fiximports/testdata/src/old.com/bad/bad.go:1 ` ` // This ill-formed Go source file is here to ensure the tool is robust `<br>golang/tools ` go/analysis/passes/copylock/testdata/src/a/newexpr_go126.go:11 ` ` func _(ptr *sync.Mutex) { ` | open |
| Recognize unrendered source templates and documentation snippets | Rust | 134 | 2 | 0.01 pp | rust-lang/mdBook ` guide/src/format/example.rs:3 ` ` # `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/__example-api/tauri-app/src-tauri/src/lib.rs:11 ` ` .plugin(tauri_plugin_{{ plugin_name_snake_case }}::init()) ` | open |
| Recover readable TypeScript files under missing or malformed base configs | TypeScript / JS | 54 | 1 | 0.00 pp | trpc/trpc ` examples/nuxt/tsconfig.json:3 ` ` "extends": "./.nuxt/tsconfig.json" `<br>trpc/trpc ` examples/nuxt/server/tsconfig.json:2 ` ` "extends": "../.nuxt/tsconfig.server.json" ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | TypeScript / JS | 15 | 4 | 0.00 pp | puppeteer/puppeteer ` test/assets/syntax-error.js:3 ` ` const = ; `<br>vitejs/vite ` packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error.js:1 ` ` invalid code ` | open |
| Recognize unrendered source templates and documentation snippets | TypeScript / JS | 5 | 1 | 0.00 pp | tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:1 ` ` {{#if license_header}} `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:7 ` ` return await invoke<{value?: string}>('plugin:{{ plugin_name }}\|ping', { ` | open |
| Read TypeScript package manifests that start with a UTF-8 BOM | TypeScript / JS | 0 | 1 | 0.00 pp | vitejs/vite ` playground/resolve/utf8-bom-package/package.json:1 ` ` ﻿{ `<br>vitejs/vite ` playground/resolve/utf8-bom-package/index.mjs:1 ` ` export const msg = '[success]' ` | open |

### Running total

- **Go** has measured adjusted coverage of 77.76%. With estimated missing links included, the planning baseline is 51.20%. The listed items add 35.08 pp to reach 86.27%, with 254,063 eligible links left unexplained. The 90% target still needs 68,962 more links. The source-only planning forecast is 51.20% → 86.27%.
- **Rust** has measured adjusted coverage of 28.29%. With estimated missing links included, the planning baseline is 7.38%. The listed items add 77.21 pp to reach 84.59%, with 354,922 eligible links left unexplained. The 90% target still needs 124,539 more links. The source-only planning forecast is 7.38% → 84.59%.
- **TypeScript / JS** has measured adjusted coverage of 44.80%. With estimated missing links included, the planning baseline is 15.06%. The listed items add 70.57 pp to reach 85.62%, with 522,946 eligible links left unexplained. The 90% target still needs 159,225 more links. The source-only planning forecast is 15.46% → 88.08%.
- **Overall** has measured adjusted coverage of 54.74%. With estimated missing links included, the planning baseline is 21.37%. The listed items add 64.10 pp to reach 85.47%, with 1,131,931 eligible links left unexplained. The 90% target still needs 352,724 more links. The source-only planning forecast is 21.64% → 86.60%.

The median eligible links per readable source line used for missing inputs were Go 0.527, Rust 0.661, TypeScript / JS 0.390.

<!-- sweep:coverage:end -->

Recompute the table and scoreboard with `scripts/sweep/coverage.mjs`. For a
candidate run on a subset, pass the release archive as `--base` and overlay
only matching pins. The status shows newly resolved sampled sites, reduced
failed-file counts, fewer tainted links or more completed attempts. A missing
sampled site stays unconfirmed. [Sweep commands and classification rules](../sweep/README.md)
