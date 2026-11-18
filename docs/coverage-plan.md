# Coverage plan for 0.2.0

Read the 90% target against **Level 2**. It divides definite checkout targets
plus named library symbols by every stored link in the finished graphs.
Level 1 also credits a known library unit without a symbol. Strict-inside
excludes proved outside targets from its denominator. Raw is the released
resolved outcome divided by all stored links. [Scoreboard and scope variants](../evidence/sw-3/scoreboard.md)

A library identity can come from a stored import and selector, a qualified
path, or a written receiver type. For example, a stored `strconv` import and
`strconv.Quote` selector can identify `strconv → Quote`. A Rust method
spelling such as `unwrap` needs evidence that the receiver is, for example,
`std::result::Result`. An import alias for Node `child_process.spawnSync` or
the Zod export path `z.string` can likewise identify a library use. These
paths name the API used by the source. They do not establish a runtime
implementation or provide the library's body. In schema 3, the stored target
ID points to a symbol in a captured file. Giving library targets graph nodes
would make those names queryable. The representation items add zero points
for identities already credited from stored facts. [Graph store](../src/graph/store.ts#L94)

The completion checklist tracks all 60 pins. A newly finished pin enters
coverage with its actual stored links. The points below are upper bounds
that assume every labelled site in the item gains a definite target. A
newly resolved checkout link and a newly named library symbol each add one
to the numerator. The denominator stays fixed. Receiver inference can earn
both kinds of credit. A repository count prefixed by ≥ is a sample lower
bound. Legitimate runtime dispatch earns no definite credit.

**Should a correctly closed candidate set count as covered?** Here that
means the set contains every real alternative and no extra target. Both
figures are shown. The alternative uses source-verified sampled sets with
their recorded candidates and is an estimate. A candidate set whose
closure could not be verified earns no bonus. The evidence also shows the
arithmetic bound if every stored ambiguous link were credited.
[Sample labels and closure checks](../evidence/sw-3/sampling.md)

The source-only ceiling keeps legitimate alternatives, whole-unit imports
and language intrinsics in the denominator. It also subtracts cases where
the selected member depends on unavailable dependency declarations.
Unknowns are treated as recoverable for this optimistic ceiling. A site
whose graph emits no link has no measured outcome or points. Bundle,
fixture and template coverage variants remain available.
[Source sites without an emitted link](../evidence/sw-3/sampling.md#candidate-sites-that-have-no-stored-link)

Dependency information could lift the ceiling. These are open options.

| Option | Information it supplies | Cost or constraint |
| --- | --- | --- |
| Read declaration files in an existing `node_modules` | TypeScript exported declarations, re-exports, method owners and return types | Accuracy depends on the installed lockfile versions and their type declarations. Reading existing files needs extra I/O. Installing packages is a separate operation. |
| Read the Go module cache or opt in to `go list` | Package names, selected versions and build-aware type information | The cache may be incomplete. A toolchain needs platform and build-tag settings, and may attempt module downloads unless run offline. |
| Read Cargo registry sources or opt in to Cargo metadata | Selected versions and crate identities. Registry source can provide signatures and re-exports. | Cargo metadata alone does not type-check method bodies. Registry source or compiler integration adds version, feature and sandboxing requirements. Build scripts and procedural macros introduce execution risks. |

Failed-file estimates are the missing outgoing links, based on the median
stored links per readable source line. They enter the measured coverage
when indexing emits them. Existing Rust links marked
`failed-file-unseen-declarations` keep a separate exact footprint. A tainted
receiver site belongs to that item, so the estimates avoid counting the same
stored link twice. [Rust resolver](../src/graph/languages/rust/resolve.ts#L4371)

The Serde profile places the stall in recursive scope and `use` lookups
through `find`, `children`, `inScope`, `findUsePath` and `resolveUse`. The
synchronous lookup continued after shutdown signals. TypeScript's
`no-symbol` records a lookup without a usable symbol. Its `local` reason
records a captured declaration without a graph anchor.
[Rust lookup](../src/graph/languages/rust/resolve.ts#L2169) · [No symbol](../src/graph/languages/typescript/extract.ts#L263) · [Local declaration](../src/graph/languages/typescript/extract.ts#L330)

Some outside names remain unclassified in the strict-inside score even
when the source review can establish them, including Rust prelude variants
and test-runner globals. The exporter also suppresses some prelude evidence
across a whole repository when a captured file uses `no_std` or
`#[macro_use]`. Crate- and scope-specific evidence would narrow that
restriction. [Outside classification rules](../sweep/README.md#coverage-scoreboard)

<!-- sweep:coverage:start -->

## A. All 60 finish

**53 of 60 finished.**

- [ ] DioxusLabs/dioxus · Rust analysis stalled at the wall limit · open
- [ ] embassy-rs/embassy · Rust analysis stalled at the wall limit · open
- [ ] microsoft/TypeScript · Node heap exhausted · open
- [ ] rustls/rustls · Rust resolution stalled at the wall limit · open
- [ ] serde-rs/serde · Rust resolution stalled in recursive scope and use lookups · open
- [ ] swc-project/swc · Rust analysis stalled at the wall limit · open
- [ ] vercel/turborepo · Node heap exhausted · open

## B. Coverage of finished graphs

### Go

**Level 2 77.01%** · Level 1 79.20% · Strict-inside 81.87% · Raw 63.80%.
**If verified closed sets count** 77.01%. Crediting every ambiguous link would give an arithmetic upper bound of 79.60%.

| Support item | Kind | Links | Repositories | Points | Running total | Examples | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Identify Go library methods on results and typed receivers | Library target | 36,977 | ≥20 | 2.49 pp | 79.50% | samber/lo ` map_test.go:832 ` ` is.NoError(err) `<br>golang/tools ` internal/robustio/robustio_test.go:80 ` ` if !realMtime.Equal(symlinkMtime) { ` | open |
| Use the element type of slices, maps and ranged values for member links | Inside target | 28,116 | ≥11 | 1.89 pp | 81.39% | golang/tools ` internal/diff/diff_test.go:109 ` ` tc.In, tc.Out, tc.Edits, got, want) `<br>cli/cli ` pkg/cmd/pr/view/view_test.go:966 ` ` if len(tt.fixtures) > 0 { ` | open |
| Identify Go library members reached through fields and embedding | Library target | 16,414 | ≥8 | 1.11 pp | 82.50% | cli/cli ` script/ghmock/schemacmd.go:321 ` ` if schema.Value != nil { `<br>cockroachdb/pebble ` version_set_test.go:307 ` ` defer buf.Mutex.Unlock() ` | open |
| Identify Go library symbols through package-qualified selectors | Library target | 15,087 | ≥11 | 1.02 pp | 83.51% | golang/tools ` go/analysis/passes/unmarshal/testdata/src/a/a.go:28 ` ` gob.NewDecoder(r).Decode(v) // want "call of Decode passes non-pointer" `<br>restic/restic ` internal/fs/fs_local_vss_test.go:285 ` ` } else if !ole.IsEqualGUID(id, test.id) { ` | open |
| Resolve fields of local structs, including embedded and anonymous fields | Inside target | 14,998 | ≥5 | 1.01 pp | 84.52% | cockroachdb/pebble ` objstorage/objstorageprovider/vfs.go:116 ` ` prefix := base.MakeFilepath(p.st.Local.FS, p.st.Local.FSDirName, metaFileType, fileNum) `<br>cli/cli ` .github/skills/cli-exercise/tool/internal/evidence/raster.go:150 ` ` lines := data.Lines[max(0, len(data.Lines)-data.Rows):] ` | open |
| Resolve named Go types and package members across files and local modules | Inside target | 11,930 | ≥7 | 0.80 pp | 85.33% | golang/tools ` gopls/internal/util/typesutil/typesutil.go:186 ` ` case edge.CallExpr_Args: `<br>gin-gonic/gin ` binding/binding_test.go:1055 ` ` b := Form ` | open |
| Use package identity and build variants for generated Go declarations | Inside target | 10,900 | ≥1 | 0.73 pp | 86.06% | protocolbuffers/protobuf-go ` internal/testprotos/test3/test3_hybrid/test.hybrid.pb.go:2323 ` ` (*TestAllTypes_NestedMessage)(nil), // 4: hybrid.goproto.proto.test3.TestAllTypes.NestedMessage `<br>protocolbuffers/protobuf-go ` internal/testprotos/testeditions/testeditions_hybrid/test.hybrid.pb.go:2847 ` ` func (x *TestManyMessageFieldsMessage) GetF20() *TestAllTypes { ` | open |
| Match declared implementation relations using local Go method sets | Inside target | 10,287 | ≥6 | 0.69 pp | 86.75% | protocolbuffers/protobuf-go ` internal/testprotos/testeditions/test.pb.go:2190 ` ` type TestRequiredForeign struct { `<br>etcd-io/bbolt ` tests/dmflakey/dmflakey.go:133 ` ` type flakey struct { ` | open |
| Link Go pointer conversions to their checked-in type declarations | Inside target | 4,115 | ≥2 | 0.28 pp | 87.03% | cockroachdb/pebble ` batch.go:480 ` ` var _ Writer = (*Batch)(nil) `<br>protocolbuffers/protobuf-go ` internal/testprotos/legacy/proto2_20180125_92554152/test.pb.go:2634 ` ` ExtendedType:  (*Message)(nil), ` | open |
| Follow checked-in Go return types to local method or field targets | Inside target | 3,384 | ≥4 | 0.23 pp | 87.26% | cilium/ebpf ` link/perf_event.go:275 ` ` return fd.File("perf-event") `<br>restic/restic ` internal/archiver/scanner_test.go:87 ` ` defer back() ` | open |
| Anchor Go type-parameter conversions to their local constraint declarations | Inside target | 2,057 | ≥2 | 0.14 pp | 87.40% | cockroachdb/pebble ` sstable/reader_iter_single_lvl.go:1812 ` ` kv, kvMeta = PD(&i.data).SeekGEWithMeta(i.lower, base.SeekGEFlagsNone) `<br>gofiber/fiber ` helpers_test.go:1183 ` ` if test.bits <= int(unsafe.Sizeof(V(0)))*8 { ` | open |
| Resolve a method on a concrete local receiver or checked-in field | Inside target | 2,013 | ≥3 | 0.14 pp | 87.53% | cli/cli ` pkg/cmd/release/create/create_test.go:1394 ` ` pm.RegisterConfirm("Is this a prerelease?", func(_ string, _ bool) (bool, error) { `<br>protocolbuffers/protobuf-go ` internal/reflection_test/reflection_hybrid_test.go:427 ` ` return m.GetMapSfixed32Sfixed32() ` | open |
| Make Go library targets first-class graph nodes | Library target | 228,765 named links | 23 | 0.00 pp | 87.53% | cli/cli ` pkg/cmd/agent-task/view/view_test.go:768 ` ` capiStubs: func(t *testing.T, m *capi.CapiClientMock) { `<br>evanw/esbuild ` internal/compat/compat_test.go:74 ` ` t.Run(fmt.Sprintf("%q ? %q", at, bt), func(t *testing.T) { ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | Inside target | ~211 missing | 1 | 0.00 pp | 87.53% | golang/tools ` cmd/fiximports/testdata/src/old.com/bad/bad.go:1 ` ` // This ill-formed Go source file is here to ensure the tool is robust `<br>golang/tools ` go/analysis/passes/copylock/testdata/src/a/newexpr_go126.go:11 ` ` func _(ptr *sync.Mutex) { ` | open |
| Parse parenthesized Go builtins and method expressions on anonymous structs | Inside target | ~333 missing | 1 | 0.00 pp | 87.53% | golang/tools ` go/ssa/interp/testdata/static.go:55 ` ` _ = (make)([]int, 0) `<br>golang/tools ` go/ssa/testdata/objlookup.go:116 ` ` _ = (*struct{ J }).method ` | open |
| Identify standard Go packages and symbols in type references | Library target | 0 | ≥0 | 0.00 pp | 87.53% | cli/cli ` pkg/cmd/agent-task/view/view_test.go:768 ` ` capiStubs: func(t *testing.T, m *capi.CapiClientMock) { `<br>evanw/esbuild ` internal/compat/compat_test.go:74 ` ` t.Run(fmt.Sprintf("%q ? %q", at, bt), func(t *testing.T) { ` | open |

**77.01% baseline → 87.53% after the listed items (+10.52 pp) → 87.77% source-only ceiling.** 2,892 unresolved links remain unexplained (3.91% of links estimated inside or still unclassified). 40,405 estimated links have valid alternatives, 32,537 name a unit only by design, and 50,917 are language intrinsics without a library symbol.
About 57,774 links need dependency information (52,721–65,416 from the sample and exact gaps). Resolving them all could lift the ceiling to 91.66%.

### Rust

**Level 2 33.48%** · Level 1 33.52% · Strict-inside 28.58% · Raw 25.05%.
**If verified closed sets count** 33.56%. Crediting every ambiguous link would give an arithmetic upper bound of 33.60%.

| Support item | Kind | Links | Repositories | Points | Running total | Examples | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Identify Rust prelude and dependency symbols by their final paths | Library target | 108,934 | ≥15 | 16.05 pp | 49.53% | helix-editor/helix ` helix-stdx/src/faccess.rs:407 ` ` if unsafe { IsValidAcl(sd.dacl) } != 0 { `<br>ratatui/ratatui ` ratatui-termion/src/lib.rs:276 ` ` let terminal = termion::terminal_size()?; ` | open |
| Link Rust references and patterns to their local bindings | Inside target | 85,749 | ≥13 | 12.63 pp | 62.16% | cberner/redb ` src/tree_store/btree_cursor.rs:1973 ` ` let result = operation(&mut cursor); `<br>helix-editor/helix ` helix-core/src/transaction.rs:679 ` ` if last > to { ` | open |
| Identify standard or dependency methods from Rust receiver types | Library target | 81,397 | ≥15 | 11.99 pp | 74.16% | clap-rs/clap ` clap_complete/tests/testsuite/engine.rs:549 ` ` fs::write(testdir_path.join("b_file"), "").unwrap(); `<br>tokio-rs/axum ` examples/parse-body-based-on-content-type/src/main.rs:69 ` ` if content_type.starts_with("application/x-www-form-urlencoded") { ` | open |
| Carry a checked-in Rust type through chained calls and indexed values | Inside target | 36,380 | ≥11 | 5.36 pp | 79.52% | fjall-rs/fjall ` examples/rolling-log/src/main.rs:9 ` ` let db = Database::builder(path).temporary(true).open()?; `<br>ratatui/ratatui ` ratatui-widgets/examples/chart.rs:106 ` ` frame.render_widget(chart, area); ` | open |
| Infer inside receiver types from local bindings and constructors | Inside target | 28,177 | ≥8 | 4.15 pp | 83.67% | clap-rs/clap ` clap_builder/src/builder/debug_asserts.rs:662 ` ` p.get_index() `<br>cberner/redb ` tests/integration_tests.rs:5008 ` ` let id = txn.persistent_savepoint().unwrap(); ` | open |
| Resolve associated names through checked-in Rust types, traits and impls | Inside target | 24,258 | ≥8 | 3.57 pp | 87.24% | cberner/redb ` src/tree_store/btree_base.rs:2553 ` ` let accessor2 = BranchAccessor::new(&page2, u64::fixed_width()); `<br>clap-rs/clap ` tests/derive/subcommands.rs:83 ` ` let result = Opt::try_parse_from(["test", "badcmd", "-i", "-v"]); ` | open |
| Bind Rust type and const parameters in signatures and constraints | Inside target | 20,825 | ≥8 | 3.07 pp | 90.31% | actix/actix-web ` actix-web/src/test/test_utils.rs:59 ` ` R: IntoServiceFactory<S, Request>, `<br>tree-sitter/tree-sitter ` crates/generate/src/quickjs.rs:23 ` ` fn or_js_error(self, ctx: &Ctx) -> JSResult<T> { ` | open |
| Resolve Rust names through local modules, imports and re-exports | Inside target | 16,115 | ≥7 | 2.37 pp | 92.68% | alacritty/alacritty ` alacritty_terminal/src/event.rs:7 ` ` use crate::vte::ansi::Rgb; `<br>ratatui/ratatui ` ratatui-core/src/layout/rect/ops.rs:109 ` ` fn sub_offset(#[case] rect: Rect, #[case] offset: Offset, #[case] expected: Rect) { ` | open |
| Resolve checked-in macros and names generated by them | Inside target | 10,785 | ≥7 | 1.59 pp | 94.27% | tauri-apps/tauri ` examples/state/main.rs:42 ` ` .invoke_handler(tauri::generate_handler![increment, decrement, reset, get]) `<br>RustCrypto/hashes ` sha1/src/compress/x86_sha.rs:61 ` ` h0 = rounds4!(h1, h0, w3, 0); ` | open |
| Keep independent Rust links resolvable after a different file fails | Both | 10,572 exact L2 misses | 2 | 1.29 pp | 95.56% | alacritty/alacritty ` alacritty/src/input/mod.rs:1426 ` ` window_id: WindowId::dummy(), `<br>alacritty/alacritty ` alacritty/src/display/mod.rs:1441 ` ` / self ` | open |
| Link calls to checked-in Rust functions brought into scope by use | Inside target | 5,987 | ≥5 | 0.88 pp | 96.44% | actix/actix-web ` actix-web/src/resource.rs:816 ` ` App::new().service(web::resource("/test").route(web::query().to(HttpResponse::Ok))), `<br>crossbeam-rs/crossbeam ` crossbeam-channel/tests/array.rs:127 ` ` let (s, r) = bounded::<i32>(100); ` | open |
| Link Rust methods on explicitly typed checkout receivers | Inside target | 4,288 | ≥4 | 0.63 pp | 97.07% | tauri-apps/tauri ` crates/tauri/src/webview/mod.rs:871 ` ` let webview = match &mut window.runtime() { `<br>helix-editor/helix ` helix-term/src/ui/editor.rs:890 ` ` .or_else(\|\| theme.try_get_exact("ui.cursorcolumn")) ` | open |
| Resolve checkout names brought into scope by Rust glob imports | Inside target | 3,204 | ≥3 | 0.47 pp | 97.55% | ratatui/ratatui ` ratatui-core/src/backend/test.rs:1119 ` ` let mut backend = TestBackend::with_lines(initial_screen); `<br>actix/actix-web ` actix-web/src/rmap.rs:419 ` ` ResourceMap::finish(&root); ` | open |
| Resolve Self and self method calls through checked-in trait implementations | Inside target | 2,026 | ≥2 | 0.30 pp | 97.84% | BurntSushi/ripgrep ` crates/printer/src/standard.rs:802 ` ` self.record_matches(searcher, ctx.bytes(), 0..ctx.bytes().len())?; `<br>cberner/redb ` src/types.rs:942 ` ` Self::from_bytes(data1).cmp(&Self::from_bytes(data2)) ` | open |
| Make Rust library targets first-class graph nodes | Library target | 57,529 named links | 15 | 0.00 pp | 97.84% | BurntSushi/ripgrep ` crates/ignore/src/gitignore.rs:670 ` ` use regex_automata::{meta::Regex, util::syntax}; `<br>clap-rs/clap ` clap_builder/src/builder/range.rs:192 ` ` impl std::fmt::Display for ValueRange { ` | open |
| Parse Rust attributes on function and closure parameters | Inside target | ~495 missing | 2 | 0.00 pp | 97.84% | alacritty/alacritty ` alacritty/src/display/window.rs:136 ` ` #[rustfmt::skip] `<br>tauri-apps/tauri ` examples/file-associations/src-tauri/src/main.rs:52 ` ` .setup(\|#[allow(unused_variables)] app\| { ` | open |
| Parse Rust snapshot macros with nested bracket token trees | Inside target | ~11,608 missing | 2 | 0.00 pp | 97.84% | clap-rs/clap ` tests/builder/cargo.rs:36 ` ` utils::assert_error(err, ErrorKind::DisplayHelp, str![[r#" `<br>rust-lang/mdBook ` tests/testsuite/build.rs:12 ` ` cmd.expect_stderr(str![[r#" ` | open |
| Recognize unrendered source templates and documentation snippets | Inside target | ~158 missing | 2 | 0.00 pp | 97.84% | rust-lang/mdBook ` guide/src/format/example.rs:3 ` ` # `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/__example-api/tauri-app/src-tauri/src/lib.rs:11 ` ` .plugin(tauri_plugin_{{ plugin_name_snake_case }}::init()) ` | open |

**33.48% baseline → 97.84% after the listed items (+64.36 pp) → 98.50% source-only ceiling.** 4,155 unresolved links remain unexplained (1.70% of links estimated inside or still unclassified). 1,564 estimated links have valid alternatives, 276 name a unit only by design, and 1,068 are language intrinsics without a library symbol.
About 7,305 links need dependency information (2,009–40,057 from the sample and exact gaps). Resolving them all could lift the ceiling to 99.57%.
139 proved outside links also lack an identified support shape.
The previous strict-inside plan assigned about 22 pp to local binding anchors and source-only local receiver inference. Those choices account for 16.78 pp on this denominator. The library receiver item prices the separate gain from identifying an outside receiver.

### TypeScript / JS

**Level 2 48.02%** · Level 1 49.52% · Strict-inside 44.91% · Raw 35.47%.
**If verified closed sets count** 48.07%. Crediting every ambiguous link would give an arithmetic upper bound of 48.30%.

**Bundle scope** 48.02% including bundles and 51.70% without them. Should checked-in minified bundles count toward the release target?

| Support item | Kind | Links | Repositories | Points | Running total | Examples | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Identify JavaScript standard and DOM symbols | Library target | 223,808 | ≥31 | 14.49 pp | 62.52% | vitest-dev/vitest ` packages/vitest/src/node/pools/browser.ts:571 ` ` this.openingSessions.delete(sessionId) `<br>trpc/trpc ` www/build/og-cards.ts:142 ` ` ...cloudModules.map((file) => path.join(www, file)), ` | open |
| Identify Node and third-party symbols through aliases and globals | Library target | 81,379 | ≥12 | 5.27 pp | 67.79% | trpc/trpc ` packages/react-query/test/useUtils.test.tsx:106 ` ` test('client query sad path', async () => { `<br>reduxjs/redux-toolkit ` packages/toolkit/src/query/tests/buildHooks.test.tsx:3207 ` ` test('useMutation hook callback returns various properties to handle the result', async () => { ` | open |
| Identify library members through TypeScript return types and re-exports | Library target | 54,499 | ≥14 | 3.53 pp | 71.32% | react-hook-form/react-hook-form ` e2e/basicSchemaValidation.spec.ts:37 ` ` await type(page.locator('input[name="lastName"]'), 'luo'); `<br>nestjs/nest ` integration/cookies/e2e/cookies.spec.ts:304 ` ` expect(setCookieHeaders(res)).toEqual([ ` | open |
| Link lexical TypeScript and JavaScript declarations and their call sites | Inside target | 51,774 | ≥15 | 3.35 pp | 74.67% | react-hook-form/react-hook-form ` examples/V6/typescript/SubmitHandler.tsx:12 ` ` const onSubmit: SubmitHandler<FormValues> = (data) => `<br>honojs/hono ` src/types.ts:2582 ` ` ? Prefix ` | open |
| Follow checked-in TypeScript types and return values through property chains | Inside target | 43,375 | ≥12 | 2.81 pp | 77.48% | mermaid-js/mermaid ` packages/mermaid/src/diagrams/flowchart/parser/flow-arrows.spec.js:76 ` ` const edges = flow.parser.yy.getEdges(); `<br>pingdotgg/t3code ` apps/server/src/vcs/GitVcsDriverCore.test.ts:283 ` ` yield* driver.removeWorktree({ cwd, path: worktreePath }); ` | open |
| Resolve imports and uses of sibling pnpm and workspace packages | Inside target | 41,982 | ≥3 | 2.72 pp | 80.20% | vitest-dev/vitest ` packages/browser-preview/src/locators.ts:21 ` ` } from '@vitest/browser/locators' `<br>withastro/astro ` packages/astro/src/core/routing/match-request.ts:1 ` ` import { prependForwardSlash, stripRequestBase } from '@astrojs/internal-helpers/path'; ` | open |
| Anchor functions declared inside React components and other functions | Inside target | 40,865 | ≥7 | 2.65 pp | 82.84% | pingdotgg/t3code ` apps/server/src/auth/Layers/SessionCredentialService.ts:476 ` ` yield* emitRemoved(sessionId); `<br>cli/cli ` evals/src/review-loop.test.ts:25 ` ` io, repo: "sandbox/run", workDir: "/unused", baseSha: "base", initialHead: head, pr: pull() }; ` | open |
| Link TypeScript references to their generic parameter declarations | Inside target | 36,380 | ≥10 | 2.36 pp | 85.20% | honojs/hono ` src/types.ts:659 ` ` I3 extends Input = I & I2, `<br>withastro/astro ` packages/astro/templates/content/types.d.ts:22 ` ` export type CollectionEntry<C extends CollectionKey> = Flatten<DataEntryMap[C]>; ` | open |
| Anchor recorded lexical declarations in checked-in bundles | Inside target | 34,951 | ≥3 | 2.26 pp | 87.46% | pocketbase/pocketbase ` ui/public/libs/tinymce/plugins/fullscreen/plugin.min.js:5 ` ` ew Error(null!=e?e:"Called getOrDie on None")}static from(e){return d(e)?b.some(e):b.none()}getOrNull(){return this.tag?this.value:null}getOrUndefined(){return this.value}each(e){this.tag&&e(this.value)}toArray(){return this.tag?[t `<br>pocketbase/pocketbase ` ui/dist/libs/tinymce/models/dom/model.min.js:1 ` ` e:g({nu:xe.fromTag,clone:e=>xe.fromDom(e.dom.cloneNode(!1)),text:xe.fromText}),query:g({comparePosition:(e,t)=>e.dom.compareDocumentPosition(t.dom),prevSibling:ze,nextSibling:Ae}),property:g({children:Le,name:ne,parent:Ne,document: ` | open |
| Bind TypeScript imports and re-exports to checked-in modules | Inside target | 12,423 | ≥8 | 0.80 pp | 88.27% | nestjs/nest ` packages/microservices/test/context/rpc-context-creator.spec.ts:23 ` ` import { RpcException } from '../../index'; `<br>colinhacks/zod ` packages/zod/src/v4/classic/tests/optional.test.ts:4 ` ` import * as z from "zod/v4"; ` | open |
| Follow checked-in bundle receivers with a visible terminal definition | Inside target | 6,809 | ≥1 | 0.44 pp | 88.71% | pocketbase/pocketbase ` ui/dist/libs/tinymce/plugins/fullscreen/plugin.min.js:5 ` ` e.ui.registry.addToggleMenuItem("fullscreen",{text:"Fullscreen",icon:"fullscreen" `<br>pocketbase/pocketbase ` ui/public/libs/tinymce/tinymce.min.js:13 ` ` ai(e,I.some(t)).fold((()=>{o.each((e=>{ ` | open |
| Link immediately invoked function expressions to their checked-in bodies | Inside target | 6,588 | ≥4 | 0.43 pp | 89.14% | excalidraw/excalidraw ` packages/element/src/selection.ts:123 ` ` export const isSomeElementSelected = (function () { `<br>honojs/hono ` src/utils/color.ts:44 ` ` ? await (async () => { ` | open |
| Link literal tag factories exposed by a checked-in browser script | Inside target | 6,366 | ≥1 | 0.41 pp | 89.55% | pocketbase/pocketbase ` ui/src/base/confirm.js:117 ` ` t.div( `<br>pocketbase/pocketbase ` ui/src/fields/relation/settings.js:168 ` ` t.div( ` | open |
| Recover local TypeScript links when a base configuration is missing | Inside target | 4,147 | ≥2 | 0.27 pp | 89.82% | withastro/astro ` packages/astro/test/fixtures/content-intellisense/src/content.config.ts:5 ` ` const blogCC = defineCollection({ `<br>vitest-dev/vitest ` packages/ui/client/components/views/ViewReport.spec.ts:4 ` ` import { page, render } from '~/test' ` | open |
| Recover checked-in TypeScript links when a package tsconfig preset is missing | Inside target | 3,607 | ≥2 | 0.23 pp | 90.05% | changesets/changesets ` packages/config/src/defaults.ts:1 ` ` import type { Config, WrittenConfig } from "@changesets/types"; `<br>withastro/astro ` packages/astro/e2e/fixtures/cloudflare/src/content.config.ts:83 ` ` description: z.string(), ` | open |
| Anchor members of checked-in TypeScript object types | Inside target | 712 | ≥1 | 0.05 pp | 90.10% | pocketbase/pocketbase ` plugins/jsvm/internal/types/generated/types.d.ts:12606 ` ` date: types.DateTime `<br>oclif/core ` src/util/find-root.ts:150 ` ` const childLocator = pnp.getLocator(name, referencish) ` | open |
| Make TypeScript library targets first-class graph nodes | Library target | 217,020 named links | 27 | 0.00 pp | 90.10% | puppeteer/puppeteer ` packages/puppeteer-core/src/bidi/Connection.ts:37 ` ` returnType: ChromiumBidi.Cdp.GetSessionResult; `<br>pingdotgg/t3code ` packages/effect-codex-app-server/src/_generated/schema.gen.ts:8697 ` ` lineEnd: Schema.Number.annotate({ format: "uint32" }) ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | Inside target | ~20 missing | 4 | 0.00 pp | 90.10% | puppeteer/puppeteer ` test/assets/syntax-error.js:3 ` ` const = ; `<br>vitejs/vite ` packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error.js:1 ` ` invalid code ` | open |
| Read TypeScript package manifests that start with a UTF-8 BOM | Inside target | ~1 missing | 1 | 0.00 pp | 90.10% | vitejs/vite ` playground/resolve/utf8-bom-package/package.json:1 ` ` ﻿{ `<br>vitejs/vite ` playground/resolve/utf8-bom-package/index.mjs:1 ` ` export const msg = '[success]' ` | open |
| Recognize unrendered source templates and documentation snippets | Inside target | ~6 missing | 1 | 0.00 pp | 90.10% | tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:1 ` ` {{#if license_header}} `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:7 ` ` return await invoke<{value?: string}>('plugin:{{ plugin_name }}\|ping', { ` | open |
| Recover readable TypeScript files under missing or malformed base configs | Inside target | ~72 missing | 1 | 0.00 pp | 90.10% | trpc/trpc ` examples/nuxt/tsconfig.json:3 ` ` "extends": "./.nuxt/tsconfig.json" `<br>trpc/trpc ` examples/nuxt/server/tsconfig.json:2 ` ` "extends": "../.nuxt/tsconfig.server.json" ` | open |

**48.02% baseline → 90.10% after the listed items (+42.07 pp) → 91.19% source-only ceiling.** 16,923 unresolved links remain unexplained (5.58% of links estimated inside or still unclassified). 17,254 estimated links have valid alternatives, 23,140 name a unit only by design, and 0 are language intrinsics without a library symbol.
About 95,618 links need dependency information (78,211–157,237 from the sample and exact gaps). Resolving them all could lift the ceiling to 97.38%.

<!-- sweep:coverage:end -->

Recompute the plan and scoreboard with the coverage script. For a subset
candidate run, overlay files from matching pins. A matched site follows its
current recorded reason bucket even when its outcome has not changed.
A disappeared site remains unconfirmed.
[Sweep commands and classification rules](../sweep/README.md)
