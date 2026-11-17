# Coverage plan for 0.2.0

Read the release's 90% target against **estimated-true coverage**. The point
estimate removes unresolved links whose targets the audit identifies outside
the checkout. This approximates how much of the checkable code the graph
actually resolves. Strict coverage is the measured conservative floor. It
removes only links the automated evidence rule proves outside. Raw coverage
uses every stored link. Unknowns stay eligible in both adjusted figures.
[Scope variants, medians and repository scores](../evidence/sw-3/scoreboard.md)

All three figures measure stored links. The source audit also found candidate
sites where the graph emits no link. Those sites belong in a separate
extraction check. They have no denominator or points in this plan.
[Source checks](../evidence/sw-3/sampling.md#candidate-sites-that-have-no-stored-link)

The completion checklist tracks whether all 60 pins finish. A newly finished
pin joins the coverage figures with its measured links. The support tables
use only links from finished graphs. For an inside item, the running total
credits definite resolution. For an outside item, it removes the newly
provable outside links from the strict denominator. Points show the gain
from each item on its own. The running total applies the rows in order,
so the gains interact when the denominator shrinks. The totals use
unrounded estimates. Repository counts prefixed by ≥ are confirmed by the
sample.

The ceiling keeps the sample's correctly ambiguous links eligible. Unknown
links are assumed resolvable when computing this ceiling. The unexplained
percentage is unknown unresolved links divided by estimated inside-unresolved
links, with ambiguous graph rows excluded from both. Unknown ambiguous rows
are reported in the sample evidence. [Label counts and intervals](../evidence/sw-3/sampling.md)

Failed-file rows show estimated missing outgoing links based on the median
eligible links per readable source line in that language. A missing link has
no measured outcome and earns zero points in the table until the file is
indexed. Existing Rust links marked `failed-file-unseen-declarations` have a
separate exact footprint. The sample estimates the gain within that footprint.
A link with both failed-file and receiver reasons belongs to the failed-file
item. [Rust resolver](../src/graph/languages/rust/resolve.ts#L4371)

The Serde profile places the stall in mutually recursive scope and `use`
lookups through `find`, `children`, `inScope`, `findUsePath` and
`resolveUse`. The synchronous lookup continued after shutdown signals.
TypeScript's `no-symbol` means a lookup returned no usable symbol. Its
`local` reason means the captured declaration had no graph anchor.
[Rust lookup](../src/graph/languages/rust/resolve.ts#L2169) · [No symbol](../src/graph/languages/typescript/extract.ts#L263) · [Local declaration](../src/graph/languages/typescript/extract.ts#L330)

<!-- sweep:coverage:start -->

## A. All 60 finish

**53 of 60 finished.**

- [ ] DioxusLabs/dioxus · Rust analysis stalled at the wall limit · open
- [ ] embassy-rs/embassy · Rust analysis stalled at the wall limit · open
- [ ] microsoft/TypeScript · Node heap exhausted · open
- [ ] rustls/rustls · Rust resolution stalled at the wall limit · open
- [ ] serde-rs/serde · Rust analysis stalled at the wall limit · open
- [ ] swc-project/swc · Rust analysis stalled at the wall limit · open
- [ ] vercel/turborepo · Node heap exhausted · open

## B. Coverage of finished graphs

### Go

Strict baseline **77.75%**. Estimated-true **87.92%** (86.95%–88.86%). Raw **63.80%**.

| Support item | Links | Repositories | Points | Running total | Examples | Status |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Recognize standard packages in type references and signatures | 71,714 | ≥18 | 4.86 pp | 82.62% | cli/cli ` pkg/cmd/agent-task/view/view_test.go:768 ` ` capiStubs: func(t *testing.T, m *capi.CapiClientMock) { `<br>evanw/esbuild ` internal/compat/compat_test.go:74 ` ` t.Run(fmt.Sprintf("%q ? %q", at, bt), func(t *testing.T) { ` | open |
| Trace methods and fields on concrete standard or dependency results | 40,056 | ≥13 | 2.64 pp | 85.61% | samber/lo ` map_test.go:832 ` ` is.NoError(err) `<br>golang/tools ` internal/robustio/robustio_test.go:80 ` ` if !realMtime.Equal(symlinkMtime) { ` | open |
| Use the element type of slices, maps and ranged values for member links | 26,489 | ≥11 | 2.17 pp | 88.00% | golang/tools ` internal/diff/diff_test.go:109 ` ` tc.In, tc.Out, tc.Edits, got, want) `<br>cli/cli ` pkg/cmd/pr/view/view_test.go:966 ` ` if len(tt.fixtures) > 0 { ` | open |
| Follow results of functions and methods in checked-in packages | 14,824 | ≥10 | 1.22 pp | 89.34% | cli/cli ` script/ghmock/schemacmd.go:321 ` ` if schema.Value != nil { `<br>pocketbase/pocketbase ` core/db_table.go:14 ` ` err := app.ConcurrentDB().NewQuery("SELECT name FROM PRAGMA_TABLE_INFO({:tableName})"). ` | open |
| Resolve fields of local structs, including embedded and anonymous fields | 14,205 | ≥5 | 1.17 pp | 90.62% | cockroachdb/pebble ` objstorage/objstorageprovider/vfs.go:116 ` ` prefix := base.MakeFilepath(p.st.Local.FS, p.st.Local.FSDirName, metaFileType, fileNum) `<br>cli/cli ` .github/skills/cli-exercise/tool/internal/evidence/raster.go:150 ` ` lines := data.Lines[max(0, len(data.Lines)-data.Rows):] ` | open |
| Trace package-qualified selectors to dependencies outside the checkout | 15,506 | ≥12 | 1.00 pp | 91.91% | golang/tools ` go/analysis/passes/unmarshal/testdata/src/a/a.go:28 ` ` gob.NewDecoder(r).Decode(v) // want "call of Decode passes non-pointer" `<br>restic/restic ` internal/fs/fs_local_vss_test.go:285 ` ` } else if !ole.IsEqualGUID(id, test.id) { ` | open |
| Resolve named Go types and package members across files and local modules | 11,456 | ≥7 | 0.94 pp | 92.96% | golang/tools ` gopls/internal/util/typesutil/typesutil.go:186 ` ` case edge.CallExpr_Args: `<br>cilium/ebpf ` prog_test.go:959 ` ` testutils.RunWithToken(t, "no-prog", testutils.Delegated{ ` | open |
| Use package identity and build variants for generated Go declarations | 10,908 | ≥1 | 0.90 pp | 93.96% | protocolbuffers/protobuf-go ` internal/testprotos/test3/test3_hybrid/test.hybrid.pb.go:2323 ` ` (*TestAllTypes_NestedMessage)(nil), // 4: hybrid.goproto.proto.test3.TestAllTypes.NestedMessage `<br>protocolbuffers/protobuf-go ` internal/testprotos/testeditions/testeditions_hybrid/test.hybrid.pb.go:2847 ` ` func (x *TestManyMessageFieldsMessage) GetF20() *TestAllTypes { ` | open |
| Trace dependency types through Go fields and embedded members | 13,568 | ≥7 | 0.88 pp | 95.14% | cockroachdb/pebble ` version_set_test.go:307 ` ` defer buf.Mutex.Unlock() `<br>gofiber/fiber ` middleware/csrf/cross_origin_test.go:243 ` ` ctx.Request.Header.SetMethod(fiber.MethodPost) ` | open |
| Match declared implementation relations using local Go method sets | 9,691 | ≥6 | 0.80 pp | 96.04% | protocolbuffers/protobuf-go ` internal/testprotos/testeditions/test.pb.go:2190 ` ` type TestRequiredForeign struct { `<br>etcd-io/bbolt ` tests/dmflakey/dmflakey.go:133 ` ` type flakey struct { ` | open |
| Link Go pointer conversions to their checked-in type declarations | 3,876 | ≥2 | 0.32 pp | 96.40% | cockroachdb/pebble ` batch.go:480 ` ` var _ Writer = (*Batch)(nil) `<br>protocolbuffers/protobuf-go ` internal/testprotos/legacy/proto2_20180125_92554152/test.pb.go:2634 ` ` ExtendedType:  (*Message)(nil), ` | open |
| Resolve a method on a concrete local receiver or checked-in field | 2,575 | ≥4 | 0.21 pp | 96.64% | cli/cli ` pkg/cmd/release/create/create_test.go:1394 ` ` pm.RegisterConfirm("Is this a prerelease?", func(_ string, _ bool) (bool, error) { `<br>restic/restic ` internal/archiver/exclude.go:123 ` ` if fs.Base(filename) == tagFilename { ` | open |
| Anchor Go type-parameter conversions to their local constraint declarations | 1,938 | ≥2 | 0.16 pp | 96.82% | cockroachdb/pebble ` sstable/reader_iter_single_lvl.go:1812 ` ` kv, kvMeta = PD(&i.data).SeekGEWithMeta(i.lower, base.SeekGEFlagsNone) `<br>gofiber/fiber ` helpers_test.go:1183 ` ` if test.bits <= int(unsafe.Sizeof(V(0)))*8 { ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | ~165 missing | 1 | 0.00 pp | 96.82% | golang/tools ` cmd/fiximports/testdata/src/old.com/bad/bad.go:1 ` ` // This ill-formed Go source file is here to ensure the tool is robust `<br>golang/tools ` go/analysis/passes/copylock/testdata/src/a/newexpr_go126.go:11 ` ` func _(ptr *sync.Mutex) { ` | open |
| Parse parenthesized Go builtins and method expressions on anonymous structs | ~260 missing | 1 | 0.00 pp | 96.82% | golang/tools ` go/ssa/interp/testdata/static.go:55 ` ` _ = (make)([]int, 0) `<br>golang/tools ` go/ssa/testdata/objlookup.go:116 ` ` _ = (*struct{ J }).method ` | open |

**77.75% baseline → 96.82% after the listed items (+19.07 pp) → 97.25% estimated ceiling.** 29,618 estimated links remain legitimately non-definite. 2,733 unresolved links are unexplained (2.98% of estimated inside-unresolved).

### Rust

Strict baseline **28.29%**. Estimated-true **39.27%** (37.58%–41.21%). Raw **25.05%**.

| Support item | Links | Repositories | Points | Running total | Examples | Status |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Link Rust references and patterns to their local bindings | 83,222 | ≥13 | 13.85 pp | 42.14% | cberner/redb ` src/tree_store/btree_cursor.rs:1973 ` ` let result = operation(&mut cursor); `<br>helix-editor/helix ` helix-core/src/transaction.rs:679 ` ` if last > to { ` | open |
| Infer types from Rust local bindings and constructor results for method calls | 49,263 | ≥11 | 8.20 pp | 50.34% | clap-rs/clap ` clap_builder/src/builder/debug_asserts.rs:662 ` ` p.get_index() `<br>actix/actix-web ` actix-web/tests/compression.rs:108 ` ` assert_eq!(res.headers().get(header::CONTENT_ENCODING).unwrap(), "gzip"); ` | open |
| Resolve checkout names brought into scope by Rust glob imports | 28,758 | ≥6 | 4.79 pp | 55.12% | ratatui/ratatui ` ratatui-core/src/backend/test.rs:1119 ` ` let mut backend = TestBackend::with_lines(initial_screen); `<br>actix/actix-web ` actix-web/src/rmap.rs:419 ` ` ResourceMap::finish(&root); ` | open |
| Identify when a Rust method receiver has a standard or dependency type | 81,909 | ≥15 | 4.46 pp | 63.82% | clap-rs/clap ` clap_complete/tests/testsuite/engine.rs:549 ` ` fs::write(testdir_path.join("b_file"), "").unwrap(); `<br>tokio-rs/axum ` examples/parse-body-based-on-content-type/src/main.rs:69 ` ` if content_type.starts_with("application/x-www-form-urlencoded") { ` | open |
| Recognize Rust prelude and dependency names through imports and macro arguments | 79,885 | ≥12 | 4.34 pp | 75.43% | helix-editor/helix ` helix-stdx/src/faccess.rs:407 ` ` if unsafe { IsValidAcl(sd.dacl) } != 0 { `<br>tree-sitter/tree-sitter ` crates/generate/src/build_tables.rs:289 ` ` && let Some(index) = conflict_free_tokens.terminals().find(\|&other\| { ` | open |
| Resolve associated names through checked-in Rust types, traits and impls | 25,386 | ≥9 | 4.22 pp | 81.21% | clap-rs/clap ` tests/derive/subcommands.rs:83 ` ` let result = Opt::try_parse_from(["test", "badcmd", "-i", "-v"]); `<br>tree-sitter/tree-sitter ` crates/cli/src/tests/query_test.rs:3869 ` ` QueryProperty::new("cool", None, None), ` | open |
| Carry a checked-in Rust type through chained calls and indexed values | 24,589 | ≥10 | 4.09 pp | 86.81% | fjall-rs/fjall ` examples/rolling-log/src/main.rs:9 ` ` let db = Database::builder(path).temporary(true).open()?; `<br>actix/actix-web ` actix-files/src/lib.rs:1101 ` ` test::init_service(App::new().service(Files::new("/", ".").show_files_listing())).await; ` | open |
| Bind Rust type and const parameters in signatures and constraints | 20,662 | ≥8 | 3.44 pp | 91.52% | actix/actix-web ` actix-web/src/test/test_utils.rs:59 ` ` R: IntoServiceFactory<S, Request>, `<br>tree-sitter/tree-sitter ` crates/generate/src/quickjs.rs:23 ` ` fn or_js_error(self, ctx: &Ctx) -> JSResult<T> { ` | open |
| Resolve checked-in macros and names generated by them | 7,136 | ≥5 | 1.19 pp | 93.14% | tauri-apps/tauri ` examples/state/main.rs:42 ` ` .invoke_handler(tauri::generate_handler![increment, decrement, reset, get]) `<br>RustCrypto/hashes ` sha1/src/compress/x86_sha.rs:61 ` ` h0 = rounds4!(h1, h0, w3, 0); ` | open |
| Resolve Rust names through local modules, imports and re-exports | 6,759 | ≥5 | 1.12 pp | 94.68% | alacritty/alacritty ` alacritty_terminal/src/event.rs:7 ` ` use crate::vte::ansi::Rgb; `<br>tree-sitter/tree-sitter ` crates/cli/src/parse.rs:17 ` ` InputEdit, Language, LogType, ParseOptions, ParseState, Parser, Point, Range, Tree, TreeCursor, ` | open |
| Keep independent Rust links resolvable after a different file fails | 10,071 exact footprint | 2 | 0.77 pp | 96.69% | alacritty/alacritty ` alacritty/src/input/mod.rs:1426 ` ` window_id: WindowId::dummy(), `<br>alacritty/alacritty ` alacritty/src/renderer/text/gles2.rs:375 ` ` gl::ARRAY_BUFFER, ` | open |
| Resolve Self and self method calls through checked-in trait implementations | 2,043 | ≥2 | 0.34 pp | 97.16% | BurntSushi/ripgrep ` crates/printer/src/standard.rs:802 ` ` self.record_matches(searcher, ctx.bytes(), 0..ctx.bytes().len())?; `<br>cberner/redb ` src/types.rs:942 ` ` Self::from_bytes(data1).cmp(&Self::from_bytes(data2)) ` | open |
| Link calls to checked-in Rust functions brought into scope by use | 2,017 | ≥1 | 0.34 pp | 97.63% | crossbeam-rs/crossbeam ` crossbeam-channel/tests/array.rs:127 ` ` let (s, r) = bounded::<i32>(100); `<br>crossbeam-rs/crossbeam ` crossbeam-channel/tests/ready.rs:591 ` ` scope(\|scope\| { ` | open |
| Parse Rust attributes on function and closure parameters | ~419 missing | 2 | 0.00 pp | 97.63% | alacritty/alacritty ` alacritty/src/display/window.rs:136 ` ` #[rustfmt::skip] `<br>tauri-apps/tauri ` examples/file-associations/src-tauri/src/main.rs:52 ` ` .setup(\|#[allow(unused_variables)] app\| { ` | open |
| Parse Rust snapshot macros with nested bracket token trees | ~9,830 missing | 2 | 0.00 pp | 97.63% | clap-rs/clap ` tests/builder/cargo.rs:36 ` ` utils::assert_error(err, ErrorKind::DisplayHelp, str![[r#" `<br>rust-lang/mdBook ` tests/testsuite/build.rs:12 ` ` cmd.expect_stderr(str![[r#" ` | open |
| Recognize unrendered source templates and documentation snippets | ~134 missing | 2 | 0.00 pp | 97.63% | rust-lang/mdBook ` guide/src/format/example.rs:3 ` ` # `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/__example-api/tauri-app/src-tauri/src/lib.rs:11 ` ` .plugin(tauri_plugin_{{ plugin_name_snake_case }}::init()) ` | open |

**28.29% baseline → 97.63% after the listed items (+69.34 pp) → 99.76% estimated ceiling.** 1,024 estimated links remain legitimately non-definite. 9,234 unresolved links are unexplained (3.52% of estimated inside-unresolved).

### TypeScript / JS

Strict baseline **44.80%**. Estimated-true **61.49%** (59.38%–63.76%). Raw **35.47%**.

| Support item | Links | Repositories | Points | Running total | Examples | Status |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Recognize standard JavaScript and DOM targets from source types | 138,472 | ≥19 | 5.72 pp | 50.52% | vitest-dev/vitest ` packages/vitest/src/node/pools/browser.ts:571 ` ` this.openingSessions.delete(sessionId) `<br>trpc/trpc ` www/build/og-cards.ts:142 ` ` ...cloudModules.map((file) => path.join(www, file)), ` | open |
| Follow checked-in TypeScript types and return values through property chains | 61,718 | ≥12 | 5.05 pp | 56.22% | pingdotgg/t3code ` apps/server/src/vcs/GitVcsDriverCore.test.ts:283 ` ` yield* driver.removeWorktree({ cwd, path: worktreePath }); `<br>mermaid-js/mermaid ` packages/mermaid/src/diagrams/flowchart/parser/flow-arrows.spec.js:76 ` ` const edges = flow.parser.yy.getEdges(); ` | open |
| Follow lexical functions and objects within checked-in JavaScript bundles | 58,359 | ≥3 | 4.77 pp | 61.60% | golang/tools ` cmd/present/static/jquery.js:2 ` ` return this.each(function(c){p(this).wrapAll(b?a.call(this,c):a)}) `<br>pocketbase/pocketbase ` ui/public/libs/tinymce/themes/silver/theme.min.js:1 ` ` n).fold(x(e),(t=>({len:t.finish,list:e.list.concat([t])})))) ` | open |
| Track outside return types through test, browser and other dependency APIs | 114,613 | ≥15 | 4.63 pp | 68.88% | react-hook-form/react-hook-form ` e2e/basicSchemaValidation.spec.ts:37 ` ` await type(page.locator('input[name="lastName"]'), 'luo'); `<br>nestjs/nest ` integration/cookies/e2e/cookies.spec.ts:304 ` ` expect(setCookieHeaders(res)).toEqual([ ` | open |
| Link lexical TypeScript and JavaScript declarations and their call sites | 54,073 | ≥16 | 4.42 pp | 74.46% | react-hook-form/react-hook-form ` examples/V6/typescript/SubmitHandler.tsx:12 ` ` const onSubmit: SubmitHandler<FormValues> = (data) => `<br>vitest-dev/vitest ` test/unit/test/jest-mock.test.ts:499 ` ` expect(spy.mock.settledResults[1]).toEqual(h(new Error('error'))) ` | open |
| Resolve imports and uses of sibling pnpm and workspace packages | 42,826 | ≥3 | 3.50 pp | 78.88% | vitest-dev/vitest ` packages/browser-preview/src/locators.ts:21 ` ` } from '@vitest/browser/locators' `<br>withastro/astro ` packages/astro/src/core/routing/match-request.ts:1 ` ` import { prependForwardSlash, stripRequestBase } from '@astrojs/internal-helpers/path'; ` | open |
| Anchor functions declared inside React components and other functions | 40,434 | ≥7 | 3.31 pp | 83.05% | pingdotgg/t3code ` apps/server/src/auth/Layers/SessionCredentialService.ts:476 ` ` yield* emitRemoved(sessionId); `<br>cli/cli ` evals/src/review-loop.test.ts:25 ` ` io, repo: "sandbox/run", workDir: "/unused", baseSha: "base", initialHead: head, pr: pull() }; ` | open |
| Trace Node and third-party import aliases and globals to outside packages | 78,686 | ≥12 | 3.08 pp | 90.39% | trpc/trpc ` packages/react-query/test/useUtils.test.tsx:106 ` ` test('client query sad path', async () => { `<br>reduxjs/redux-toolkit ` packages/toolkit/src/query/tests/buildHooks.test.tsx:3207 ` ` test('useMutation hook callback returns various properties to handle the result', async () => { ` | open |
| Link TypeScript references to their generic parameter declarations | 35,358 | ≥10 | 2.89 pp | 94.36% | honojs/hono ` src/types.ts:659 ` ` I3 extends Input = I & I2, `<br>withastro/astro ` packages/astro/templates/content/types.d.ts:22 ` ` export type CollectionEntry<C extends CollectionKey> = Flatten<DataEntryMap[C]>; ` | open |
| Bind TypeScript imports and re-exports to checked-in modules | 13,136 | ≥9 | 1.07 pp | 95.83% | nestjs/nest ` packages/microservices/test/context/rpc-context-creator.spec.ts:23 ` ` import { RpcException } from '../../index'; `<br>colinhacks/zod ` packages/zod/src/v4/classic/tests/optional.test.ts:4 ` ` import * as z from "zod/v4"; ` | open |
| Link immediately invoked function expressions to their checked-in bodies | 6,446 | ≥4 | 0.53 pp | 96.56% | excalidraw/excalidraw ` packages/element/src/selection.ts:123 ` ` export const isSomeElementSelected = (function () { `<br>honojs/hono ` src/utils/color.ts:44 ` ` ? await (async () => { ` | open |
| Recover local TypeScript links when a base configuration is missing | 4,164 | ≥2 | 0.34 pp | 97.02% | withastro/astro ` packages/astro/test/fixtures/content-intellisense/src/content.config.ts:5 ` ` const blogCC = defineCollection({ `<br>vitest-dev/vitest ` packages/ui/client/components/views/ViewReport.spec.ts:4 ` ` import { page, render } from '~/test' ` | open |
| Recover checked-in TypeScript links when a package tsconfig preset is missing | 3,607 | ≥2 | 0.30 pp | 97.43% | changesets/changesets ` packages/config/src/defaults.ts:1 ` ` import type { Config, WrittenConfig } from "@changesets/types"; `<br>withastro/astro ` packages/astro/e2e/fixtures/cloudflare/src/content.config.ts:83 ` ` description: z.string(), ` | open |
| Use known assignments for calls through props and option callbacks | 3,214 | ≥2 | 0.26 pp | 97.79% | trpc/trpc ` packages/server/src/adapters/next-app-dir/nextAppDirCaller.ts:73 ` ` config.onError?.({ `<br>excalidraw/excalidraw ` packages/excalidraw/components/RadioSelection.tsx:50 ` ` onChange={() => props.onChange(option.value)} ` | open |
| Anchor members of checked-in TypeScript object types | 712 | ≥1 | 0.06 pp | 97.87% | pocketbase/pocketbase ` plugins/jsvm/internal/types/generated/types.d.ts:12606 ` ` date: types.DateTime `<br>oclif/core ` src/util/find-root.ts:150 ` ` const childLocator = pnp.getLocator(name, referencish) ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | ~15 missing | 4 | 0.00 pp | 97.87% | puppeteer/puppeteer ` test/assets/syntax-error.js:3 ` ` const = ; `<br>vitejs/vite ` packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error.js:1 ` ` invalid code ` | open |
| Read TypeScript package manifests that start with a UTF-8 BOM | ~0 missing | 1 | 0.00 pp | 97.87% | vitejs/vite ` playground/resolve/utf8-bom-package/package.json:1 ` ` ﻿{ `<br>vitejs/vite ` playground/resolve/utf8-bom-package/index.mjs:1 ` ` export const msg = '[success]' ` | open |
| Recognize unrendered source templates and documentation snippets | ~5 missing | 1 | 0.00 pp | 97.87% | tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:1 ` ` {{#if license_header}} `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:7 ` ` return await invoke<{value?: string}>('plugin:{{ plugin_name }}\|ping', { ` | open |
| Recover readable TypeScript files under missing or malformed base configs | ~54 missing | 1 | 0.00 pp | 97.87% | trpc/trpc ` examples/nuxt/tsconfig.json:3 ` ` "extends": "./.nuxt/tsconfig.json" `<br>trpc/trpc ` examples/nuxt/server/tsconfig.json:2 ` ` "extends": "../.nuxt/tsconfig.server.json" ` | open |

**44.80% baseline → 97.87% after the listed items (+53.07 pp) → 99.96% estimated ceiling.** 314 estimated links remain legitimately non-definite. 18,652 unresolved links are unexplained (5.51% of estimated inside-unresolved).

<!-- sweep:coverage:end -->

Recompute the table and scoreboard with `scripts/sweep/coverage.mjs`. For a
candidate run on a subset, pass the release archive as `--base` and overlay
only matching pins. The status shows newly resolved sampled sites, reduced
failed-file counts, fewer tainted links or more completed attempts. A missing
sampled site stays unconfirmed. [Sweep commands and classification rules](../sweep/README.md)
