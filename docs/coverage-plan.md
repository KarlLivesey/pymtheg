# Coverage plan for 0.2.0

Read the 90% target against **Level 2**. It divides definite checkout targets
plus named library symbols by every stored link in the finished graphs.
Level 1 also credits a known library unit without a symbol. Strict-inside
excludes proved outside targets from its denominator. Raw is the released
resolved outcome divided by all stored links. [Scoreboard and scope variants](../evidence/sw-3/scoreboard.md)

A library identity can come from a stored import and selector, a qualified
path, or a named declaring trait. For example, a stored `strconv` import and
`strconv.Quote` selector can identify `strconv → Quote`. A Rust dot call
needs evidence of the method's declaring owner after aliases, deref and
trait selection. A written receiver type can point to a different crate
than the method. Helix's checkout `RopeSliceExt` declares methods on a
dependency type, and fjall's local `Error` enum shares the name of an
imported derive macro. Both require tracking the actual declaring
scope. Go has a similar problem with promoted members.
An import alias for Node `child_process.spawnSync` or
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

The previous Go calculation stayed below 90% at an 87.77% source-only
Level 2 ceiling. Its 91.66% estimate assumed that every one of about
57,774 misses needing dependency information was recovered. The updated
estimates below use the stricter declaring-owner rule.

The previous Rust projection of 97.84% was an upper bound. Ripgrep's
`caps.get(0)` at `crates/matcher/src/lib.rs:840` already invalidates the assumption of a single definite
target for some sites. It calls through the checkout's `Captures` trait,
which has multiple implementations. The audit treats that call as a
candidate set. [Sample audit](../evidence/sw-3/sampling.md)

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
synchronous lookup continued after shutdown signals. C-1 reuses incomplete
lookups when their recursion checks agree, deduplicates identical unseen
macro entries, and makes the Rust graph phases cancellable.
[C-1 evidence](../evidence/c-1/README.md)

TypeScript's `no-symbol` records a lookup without a usable symbol. Its
`local` reason records a captured declaration without a graph anchor.
[No symbol](../src/graph/languages/typescript/extract.ts#L263) · [Local declaration](../src/graph/languages/typescript/extract.ts#L330)

Some outside names remain unclassified in the strict-inside score even
when the source review can establish them, including Rust prelude variants
and test-runner globals. The exporter also suppresses some prelude evidence
across a whole repository when a captured file uses `no_std` or
`#[macro_use]`. Crate- and scope-specific evidence would narrow that
restriction. [Outside classification rules](../sweep/README.md#coverage-scoreboard)

<!-- sweep:coverage:start -->

## A. All 60 finish

**55 of 60 finished.**

- [ ] DioxusLabs/dioxus · Rust analysis stalled at the wall limit · open
- [ ] embassy-rs/embassy · Rust analysis stalled at the wall limit · open
- [x] microsoft/TypeScript · Node heap exhausted · finished
- [ ] rustls/rustls · Rust resolution stalled at the wall limit · open
- [ ] serde-rs/serde · Rust resolution stalled in recursive scope and use lookups · open
- [ ] swc-project/swc · Rust analysis stalled at the wall limit · open
- [x] vercel/turborepo · Node heap exhausted · finished

## B. Coverage of finished graphs

### Go

**Level 2 76.80%** · Level 1 78.82% · Strict-inside 81.82% · Raw 67.91%.
**If verified closed sets count** 76.80%. Crediting every ambiguous link would give an arithmetic upper bound of 78.94%.

| Support item | Kind | Links | Repositories | Points | Running total | Examples | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Identify Go library methods on results and typed receivers | Library target | 78,416 | ≥19 | 3.98 pp | 80.78% | samber/lo ` map_test.go:832 ` ` is.NoError(err) `<br>golang/tools ` internal/robustio/robustio_test.go:80 ` ` if !realMtime.Equal(symlinkMtime) { ` | open |
| Use the element type of slices, maps and ranged values for member links | Inside target | 26,511 | ≥11 | 1.35 pp | 82.13% | golang/tools ` internal/diff/diff_test.go:109 ` ` tc.In, tc.Out, tc.Edits, got, want) `<br>cli/cli ` pkg/cmd/pr/view/view_test.go:966 ` ` if len(tt.fixtures) > 0 { ` | open |
| Identify Go library symbols through package-qualified selectors | Library target | 17,674 | ≥11 | 0.90 pp | 83.03% | golang/tools ` go/analysis/passes/unmarshal/testdata/src/a/a.go:28 ` ` gob.NewDecoder(r).Decode(v) // want "call of Decode passes non-pointer" `<br>restic/restic ` internal/fs/fs_local_vss_test.go:285 ` ` } else if !ole.IsEqualGUID(id, test.id) { ` | open |
| Resolve fields of local structs, including embedded and anonymous fields | Inside target | 16,547 | ≥5 | 0.84 pp | 83.87% | cockroachdb/pebble ` objstorage/objstorageprovider/vfs.go:116 ` ` prefix := base.MakeFilepath(p.st.Local.FS, p.st.Local.FSDirName, metaFileType, fileNum) `<br>cli/cli ` .github/skills/cli-exercise/tool/internal/evidence/raster.go:150 ` ` lines := data.Lines[max(0, len(data.Lines)-data.Rows):] ` | open |
| Identify Go library members reached through fields and embedding | Library target | 15,905 | ≥8 | 0.81 pp | 84.67% | cli/cli ` script/ghmock/schemacmd.go:321 ` ` if schema.Value != nil { `<br>cockroachdb/pebble ` version_set_test.go:307 ` ` defer buf.Mutex.Unlock() ` | open |
| Resolve named Go types and package members across files and local modules | Inside target | 12,539 | ≥7 | 0.64 pp | 85.31% | golang/tools ` gopls/internal/util/typesutil/typesutil.go:186 ` ` case edge.CallExpr_Args: `<br>gin-gonic/gin ` binding/binding_test.go:1055 ` ` b := Form ` | open |
| Use package identity and build constraints to select Go declarations | Inside target | 11,546 | ≥2 | 0.59 pp | 85.90% | protocolbuffers/protobuf-go ` internal/testprotos/test3/test3_hybrid/test.hybrid.pb.go:2323 ` ` (*TestAllTypes_NestedMessage)(nil), // 4: hybrid.goproto.proto.test3.TestAllTypes.NestedMessage `<br>cilium/ebpf ` link/perf_event.go:275 ` ` return fd.File("perf-event") ` | open |
| Match declared implementation relations using local Go method sets | Inside target | 11,247 | ≥6 | 0.57 pp | 86.47% | protocolbuffers/protobuf-go ` internal/testprotos/testeditions/test.pb.go:2190 ` ` type TestRequiredForeign struct { `<br>etcd-io/bbolt ` tests/dmflakey/dmflakey.go:133 ` ` type flakey struct { ` | open |
| Link Go pointer conversions to their checked-in type declarations | Inside target | 3,213 | ≥2 | 0.16 pp | 86.63% | cockroachdb/pebble ` batch.go:480 ` ` var _ Writer = (*Batch)(nil) `<br>protocolbuffers/protobuf-go ` internal/testprotos/legacy/proto2_20180125_92554152/test.pb.go:2634 ` ` ExtendedType:  (*Message)(nil), ` | open |
| Anchor Go type-parameter conversions to their local constraint declarations | Inside target | 2,410 | ≥2 | 0.12 pp | 86.75% | cockroachdb/pebble ` sstable/reader_iter_single_lvl.go:1812 ` ` kv, kvMeta = PD(&i.data).SeekGEWithMeta(i.lower, base.SeekGEFlagsNone) `<br>gofiber/fiber ` helpers_test.go:1183 ` ` if test.bits <= int(unsafe.Sizeof(V(0)))*8 { ` | open |
| Follow checked-in Go return types to local method or field targets | Inside target | 2,248 | ≥2 | 0.11 pp | 86.87% | cilium/ebpf ` link/perf_event.go:275 ` ` return fd.File("perf-event") `<br>restic/restic ` internal/archiver/scanner_test.go:87 ` ` defer back() ` | open |
| Resolve a method on a concrete local receiver or checked-in field | Inside target | 2,248 | ≥3 | 0.11 pp | 86.98% | cli/cli ` pkg/cmd/release/create/create_test.go:1394 ` ` pm.RegisterConfirm("Is this a prerelease?", func(_ string, _ bool) (bool, error) { `<br>protocolbuffers/protobuf-go ` internal/reflection_test/reflection_hybrid_test.go:427 ` ` return m.GetMapSfixed32Sfixed32() ` | open |
| Make Go library targets first-class graph nodes | Library target | 214,787 named links | 25 | 0.00 pp | 86.98% | cli/cli ` pkg/cmd/agent-task/view/view_test.go:768 ` ` capiStubs: func(t *testing.T, m *capi.CapiClientMock) { `<br>evanw/esbuild ` internal/compat/compat_test.go:74 ` ` t.Run(fmt.Sprintf("%q ? %q", at, bt), func(t *testing.T) { ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | Inside target | ~211 missing | 1 | 0.00 pp | 86.98% | golang/tools ` cmd/fiximports/testdata/src/old.com/bad/bad.go:1 ` ` // This ill-formed Go source file is here to ensure the tool is robust `<br>golang/tools ` go/analysis/passes/copylock/testdata/src/a/newexpr_go126.go:11 ` ` func _(ptr *sync.Mutex) { ` | open |
| Parse parenthesized Go builtins and method expressions on anonymous structs | Inside target | ~333 missing | 1 | 0.00 pp | 86.98% | golang/tools ` go/ssa/interp/testdata/static.go:55 ` ` _ = (make)([]int, 0) `<br>golang/tools ` go/ssa/testdata/objlookup.go:116 ` ` _ = (*struct{ J }).method ` | open |

**76.80% baseline → 86.98% after the listed items (+10.18 pp) → 89.33% source-only ceiling.** 42,530 unresolved links remain unexplained (37.40% of links estimated inside or still unclassified). 39,807 estimated links have valid alternatives, 39,683 name a unit only by design, and 66,345 are language intrinsics without a library symbol.
About 64,392 links need dependency information (59,272–72,103 from the sample and exact gaps). The 92.60% ceiling assumes all of those misses are recovered.
Go stays below 90% on the source-only Level 2 estimate (89.33%).
**Should identified Go builtins count?** The current Level 2 measure gives 76.80% and a source-only ceiling of 89.33%. Crediting the 63,935 recorded builtin links would give 80.05% and a ceiling of 92.57%.
If the estimated 2,410 additional intrinsic calls were also identified, the ceiling would be 92.70%.

### Rust

**Level 2 31.47%** · Level 1 31.50% · Strict-inside 26.80% · Raw 24.13%.
**If verified closed sets count** 31.51%. Crediting every ambiguous link would give an arithmetic upper bound of 31.54%.

| Support item | Kind | Links | Repositories | Points | Running total | Examples | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Identify Rust prelude and dependency symbols by their final paths | Library target | 117,269 | ≥16 | 8.68 pp | 40.15% | helix-editor/helix ` helix-stdx/src/faccess.rs:407 ` ` if unsafe { IsValidAcl(sd.dacl) } != 0 { `<br>ratatui/ratatui ` ratatui-termion/src/lib.rs:276 ` ` let terminal = termion::terminal_size()?; ` | open |
| Link Rust references and patterns to their local bindings | Inside target | 85,733 | ≥13 | 6.34 pp | 46.49% | cberner/redb ` src/tree_store/btree_cursor.rs:1973 ` ` let result = operation(&mut cursor); `<br>helix-editor/helix ` helix-core/src/transaction.rs:679 ` ` if last > to { ` | open |
| Find the declaring owner of a Rust library method | Library target | 74,940 | ≥15 | 5.54 pp | 52.04% | clap-rs/clap ` clap_complete/tests/testsuite/engine.rs:549 ` ` fs::write(testdir_path.join("b_file"), "").unwrap(); `<br>crossbeam-rs/crossbeam ` crossbeam-deque/tests/fifo.rs:257 ` ` done.store(true, SeqCst); ` | open |
| Carry a checked-in Rust type through chained calls and indexed values | Inside target | 36,926 | ≥12 | 2.73 pp | 54.77% | fjall-rs/fjall ` examples/rolling-log/src/main.rs:9 ` ` let db = Database::builder(path).temporary(true).open()?; `<br>ratatui/ratatui ` ratatui-widgets/examples/chart.rs:106 ` ` frame.render_widget(chart, area); ` | open |
| Infer inside receiver types from local bindings and constructors | Inside target | 27,708 | ≥8 | 2.05 pp | 56.82% | clap-rs/clap ` clap_builder/src/builder/debug_asserts.rs:662 ` ` p.get_index() `<br>cberner/redb ` tests/integration_tests.rs:5008 ` ` let id = txn.persistent_savepoint().unwrap(); ` | open |
| Resolve associated names through checked-in Rust types, traits and impls | Inside target | 24,259 | ≥8 | 1.79 pp | 58.61% | cberner/redb ` src/tree_store/btree_base.rs:2553 ` ` let accessor2 = BranchAccessor::new(&page2, u64::fixed_width()); `<br>clap-rs/clap ` tests/derive/subcommands.rs:83 ` ` let result = Opt::try_parse_from(["test", "badcmd", "-i", "-v"]); ` | open |
| Bind Rust type and const parameters in signatures and constraints | Inside target | 20,821 | ≥8 | 1.54 pp | 60.15% | actix/actix-web ` actix-web/src/test/test_utils.rs:59 ` ` R: IntoServiceFactory<S, Request>, `<br>tree-sitter/tree-sitter ` crates/generate/src/quickjs.rs:23 ` ` fn or_js_error(self, ctx: &Ctx) -> JSResult<T> { ` | open |
| Resolve Rust names through local modules, imports and re-exports | Inside target | 16,110 | ≥7 | 1.19 pp | 61.35% | alacritty/alacritty ` alacritty_terminal/src/event.rs:7 ` ` use crate::vte::ansi::Rgb; `<br>ratatui/ratatui ` ratatui-core/src/layout/rect/ops.rs:109 ` ` fn sub_offset(#[case] rect: Rect, #[case] offset: Offset, #[case] expected: Rect) { ` | open |
| Resolve checked-in macros and names generated by them | Inside target | 10,743 | ≥7 | 0.79 pp | 62.14% | tauri-apps/tauri ` examples/state/main.rs:42 ` ` .invoke_handler(tauri::generate_handler![increment, decrement, reset, get]) `<br>RustCrypto/hashes ` sha1/src/compress/x86_sha.rs:61 ` ` h0 = rounds4!(h1, h0, w3, 0); ` | open |
| Keep independent Rust links resolvable after a different file fails | Both | 280,215 exact L2 misses | 3 | 0.65 pp | 62.79% | alacritty/alacritty ` alacritty/src/input/mod.rs:1426 ` ` window_id: WindowId::dummy(), `<br>alacritty/alacritty ` alacritty/src/display/mod.rs:1441 ` ` / self ` | open |
| Link calls to checked-in Rust functions brought into scope by use | Inside target | 5,979 | ≥5 | 0.44 pp | 63.23% | actix/actix-web ` actix-web/src/resource.rs:816 ` ` App::new().service(web::resource("/test").route(web::query().to(HttpResponse::Ok))), `<br>crossbeam-rs/crossbeam ` crossbeam-channel/tests/array.rs:127 ` ` let (s, r) = bounded::<i32>(100); ` | open |
| Link Rust methods on explicitly typed checkout receivers | Inside target | 4,113 | ≥3 | 0.30 pp | 63.54% | tauri-apps/tauri ` crates/tauri/src/webview/mod.rs:871 ` ` let webview = match &mut window.runtime() { `<br>helix-editor/helix ` helix-term/src/ui/editor.rs:890 ` ` .or_else(\|\| theme.try_get_exact("ui.cursorcolumn")) ` | open |
| Resolve checkout names brought into scope by Rust glob imports | Inside target | 3,204 | ≥3 | 0.24 pp | 63.77% | ratatui/ratatui ` ratatui-core/src/backend/test.rs:1119 ` ` let mut backend = TestBackend::with_lines(initial_screen); `<br>actix/actix-web ` actix-web/src/rmap.rs:419 ` ` ResourceMap::finish(&root); ` | open |
| Resolve Self and self method calls through checked-in trait implementations | Inside target | 2,029 | ≥2 | 0.15 pp | 63.92% | BurntSushi/ripgrep ` crates/printer/src/standard.rs:802 ` ` self.record_matches(searcher, ctx.bytes(), 0..ctx.bytes().len())?; `<br>cberner/redb ` src/types.rs:942 ` ` Self::from_bytes(data1).cmp(&Self::from_bytes(data2)) ` | open |
| Make Rust library targets first-class graph nodes | Library target | 99,556 named links | 16 | 0.00 pp | 63.92% | BurntSushi/ripgrep ` crates/ignore/src/gitignore.rs:670 ` ` use regex_automata::{meta::Regex, util::syntax}; `<br>clap-rs/clap ` clap_builder/src/builder/range.rs:192 ` ` impl std::fmt::Display for ValueRange { ` | open |
| Parse Rust attributes on function and closure parameters | Inside target | ~495 missing | 2 | 0.00 pp | 63.92% | alacritty/alacritty ` alacritty/src/display/window.rs:136 ` ` #[rustfmt::skip] `<br>tauri-apps/tauri ` examples/file-associations/src-tauri/src/main.rs:52 ` ` .setup(\|#[allow(unused_variables)] app\| { ` | open |
| Parse Rust snapshot macros with nested bracket token trees | Inside target | ~11,608 missing | 2 | 0.00 pp | 63.92% | clap-rs/clap ` tests/builder/cargo.rs:36 ` ` utils::assert_error(err, ErrorKind::DisplayHelp, str![[r#" `<br>rust-lang/mdBook ` tests/testsuite/build.rs:12 ` ` cmd.expect_stderr(str![[r#" ` | open |
| Recognize unrendered source templates and documentation snippets | Inside target | ~158 missing | 2 | 0.00 pp | 63.92% | rust-lang/mdBook ` guide/src/format/example.rs:3 ` ` # `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/__example-api/tauri-app/src-tauri/src/lib.rs:11 ` ` .plugin(tauri_plugin_{{ plugin_name_snake_case }}::init()) ` | open |

**31.47% baseline → 63.92% after the listed items (+32.45 pp) → 98.72% source-only ceiling.** 469,757 unresolved links remain unexplained (66.16% of links estimated inside or still unclassified). 3,599 estimated links have valid alternatives, 351 name a unit only by design, and 1,068 are language intrinsics without a library symbol.
About 12,315 links need dependency information (5,612–46,417 from the sample and exact gaps). The 99.63% ceiling assumes all of those misses are recovered.
212 proved outside links also lack an identified support shape.
The previous strict-inside plan assigned about 22 pp to local binding anchors and source-only local receiver inference. Those choices account for 8.39 pp on this denominator. The library receiver item requires the declaring owner. A checkout trait declaring the same method or a local type shadowing the imported name must be ruled out before taking library credit from a receiver.

### TypeScript / JS

**Level 2 47.83%** · Level 1 49.39% · Strict-inside 44.82% · Raw 35.24%.
**If verified closed sets count** 47.87%. Crediting every ambiguous link would give an arithmetic upper bound of 48.10%.

**Bundle scope** 47.83% including bundles and 51.38% without them. Should checked-in minified bundles count toward the release target?

| Support item | Kind | Links | Repositories | Points | Running total | Examples | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Identify JavaScript standard and DOM symbols | Library target | 226,704 | ≥32 | 14.20 pp | 62.03% | vitest-dev/vitest ` packages/vitest/src/node/pools/browser.ts:571 ` ` this.openingSessions.delete(sessionId) `<br>trpc/trpc ` www/build/og-cards.ts:142 ` ` ...cloudModules.map((file) => path.join(www, file)), ` | open |
| Identify Node and third-party symbols through aliases and globals | Library target | 81,193 | ≥12 | 5.08 pp | 67.11% | trpc/trpc ` packages/react-query/test/useUtils.test.tsx:106 ` ` test('client query sad path', async () => { `<br>reduxjs/redux-toolkit ` packages/toolkit/src/query/tests/buildHooks.test.tsx:3207 ` ` test('useMutation hook callback returns various properties to handle the result', async () => { ` | open |
| Identify library members through TypeScript return types and re-exports | Library target | 55,943 | ≥14 | 3.50 pp | 70.61% | react-hook-form/react-hook-form ` e2e/basicSchemaValidation.spec.ts:37 ` ` await type(page.locator('input[name="lastName"]'), 'luo'); `<br>nestjs/nest ` integration/cookies/e2e/cookies.spec.ts:304 ` ` expect(setCookieHeaders(res)).toEqual([ ` | open |
| Link lexical TypeScript and JavaScript declarations and their call sites | Inside target | 51,767 | ≥15 | 3.24 pp | 73.86% | react-hook-form/react-hook-form ` examples/V6/typescript/SubmitHandler.tsx:12 ` ` const onSubmit: SubmitHandler<FormValues> = (data) => `<br>honojs/hono ` src/types.ts:2582 ` ` ? Prefix ` | open |
| Follow checked-in TypeScript types and return values through property chains | Inside target | 43,277 | ≥12 | 2.71 pp | 76.57% | mermaid-js/mermaid ` packages/mermaid/src/diagrams/flowchart/parser/flow-arrows.spec.js:76 ` ` const edges = flow.parser.yy.getEdges(); `<br>pingdotgg/t3code ` apps/server/src/vcs/GitVcsDriverCore.test.ts:283 ` ` yield* driver.removeWorktree({ cwd, path: worktreePath }); ` | open |
| Resolve imports and uses of sibling pnpm and workspace packages | Inside target | 41,982 | ≥3 | 2.63 pp | 79.20% | vitest-dev/vitest ` packages/browser-preview/src/locators.ts:21 ` ` } from '@vitest/browser/locators' `<br>withastro/astro ` packages/astro/src/core/routing/match-request.ts:1 ` ` import { prependForwardSlash, stripRequestBase } from '@astrojs/internal-helpers/path'; ` | open |
| Anchor functions declared inside React components and other functions | Inside target | 40,865 | ≥7 | 2.56 pp | 81.75% | pingdotgg/t3code ` apps/server/src/auth/Layers/SessionCredentialService.ts:476 ` ` yield* emitRemoved(sessionId); `<br>cli/cli ` evals/src/review-loop.test.ts:25 ` ` io, repo: "sandbox/run", workDir: "/unused", baseSha: "base", initialHead: head, pr: pull() }; ` | open |
| Link TypeScript references to their generic parameter declarations | Inside target | 36,380 | ≥10 | 2.28 pp | 84.03% | honojs/hono ` src/types.ts:659 ` ` I3 extends Input = I & I2, `<br>withastro/astro ` packages/astro/templates/content/types.d.ts:22 ` ` export type CollectionEntry<C extends CollectionKey> = Flatten<DataEntryMap[C]>; ` | open |
| Anchor recorded lexical declarations in checked-in bundles | Inside target | 34,951 | ≥3 | 2.19 pp | 86.22% | pocketbase/pocketbase ` ui/public/libs/tinymce/plugins/fullscreen/plugin.min.js:5 ` ` ew Error(null!=e?e:"Called getOrDie on None")}static from(e){return d(e)?b.some(e):b.none()}getOrNull(){return this.tag?this.value:null}getOrUndefined(){return this.value}each(e){this.tag&&e(this.value)}toArray(){return this.tag?[t `<br>pocketbase/pocketbase ` ui/dist/libs/tinymce/models/dom/model.min.js:1 ` ` e:g({nu:xe.fromTag,clone:e=>xe.fromDom(e.dom.cloneNode(!1)),text:xe.fromText}),query:g({comparePosition:(e,t)=>e.dom.compareDocumentPosition(t.dom),prevSibling:ze,nextSibling:Ae}),property:g({children:Le,name:ne,parent:Ne,document: ` | open |
| Bind TypeScript imports and re-exports to checked-in modules | Inside target | 12,419 | ≥8 | 0.78 pp | 87.00% | nestjs/nest ` packages/microservices/test/context/rpc-context-creator.spec.ts:23 ` ` import { RpcException } from '../../index'; `<br>colinhacks/zod ` packages/zod/src/v4/classic/tests/optional.test.ts:4 ` ` import * as z from "zod/v4"; ` | open |
| Follow checked-in bundle receivers with a visible terminal definition | Inside target | 6,807 | ≥1 | 0.43 pp | 87.43% | pocketbase/pocketbase ` ui/dist/libs/tinymce/plugins/fullscreen/plugin.min.js:5 ` ` e.ui.registry.addToggleMenuItem("fullscreen",{text:"Fullscreen",icon:"fullscreen" `<br>pocketbase/pocketbase ` ui/public/libs/tinymce/tinymce.min.js:13 ` ` ai(e,I.some(t)).fold((()=>{o.each((e=>{ ` | open |
| Link immediately invoked function expressions to their checked-in bodies | Inside target | 6,577 | ≥4 | 0.41 pp | 87.84% | excalidraw/excalidraw ` packages/element/src/selection.ts:123 ` ` export const isSomeElementSelected = (function () { `<br>honojs/hono ` src/utils/color.ts:44 ` ` ? await (async () => { ` | open |
| Link literal tag factories exposed by a checked-in browser script | Inside target | 6,347 | ≥1 | 0.40 pp | 88.23% | pocketbase/pocketbase ` ui/src/base/confirm.js:117 ` ` t.div( `<br>pocketbase/pocketbase ` ui/src/fields/relation/settings.js:168 ` ` t.div( ` | open |
| Recover local TypeScript links when a base configuration is missing | Inside target | 4,183 | ≥3 | 0.26 pp | 88.50% | withastro/astro ` packages/astro/test/fixtures/content-intellisense/src/content.config.ts:5 ` ` const blogCC = defineCollection({ `<br>vitest-dev/vitest ` packages/ui/client/components/views/ViewReport.spec.ts:4 ` ` import { page, render } from '~/test' ` | open |
| Recover checked-in TypeScript links when a package tsconfig preset is missing | Inside target | 3,607 | ≥2 | 0.23 pp | 88.72% | changesets/changesets ` packages/config/src/defaults.ts:1 ` ` import type { Config, WrittenConfig } from "@changesets/types"; `<br>withastro/astro ` packages/astro/e2e/fixtures/cloudflare/src/content.config.ts:83 ` ` description: z.string(), ` | open |
| Anchor members of checked-in TypeScript object types | Inside target | 712 | ≥1 | 0.04 pp | 88.77% | pocketbase/pocketbase ` plugins/jsvm/internal/types/generated/types.d.ts:12606 ` ` date: types.DateTime `<br>oclif/core ` src/util/find-root.ts:150 ` ` const childLocator = pnp.getLocator(name, referencish) ` | open |
| Make TypeScript library targets first-class graph nodes | Library target | 226,029 named links | 28 | 0.00 pp | 88.77% | puppeteer/puppeteer ` packages/puppeteer-core/src/bidi/Connection.ts:37 ` ` returnType: ChromiumBidi.Cdp.GetSessionResult; `<br>pingdotgg/t3code ` packages/effect-codex-app-server/src/_generated/schema.gen.ts:8697 ` ` lineEnd: Schema.Number.annotate({ format: "uint32" }) ` | open |
| Recognize deliberately broken fixture inputs and keep their failure local | Inside target | ~5,999 missing | 5 | 0.00 pp | 88.77% | puppeteer/puppeteer ` test/assets/syntax-error.js:3 ` ` const = ; `<br>vitejs/vite ` packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error.js:1 ` ` invalid code ` | open |
| Read TypeScript package manifests that start with a UTF-8 BOM | Inside target | ~1 missing | 1 | 0.00 pp | 88.77% | vitejs/vite ` playground/resolve/utf8-bom-package/package.json:1 ` ` ﻿{ `<br>vitejs/vite ` playground/resolve/utf8-bom-package/index.mjs:1 ` ` export const msg = '[success]' ` | open |
| Recognize unrendered source templates and documentation snippets | Inside target | ~6 missing | 1 | 0.00 pp | 88.77% | tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:1 ` ` {{#if license_header}} `<br>tauri-apps/tauri ` crates/tauri-cli/templates/plugin/guest-js/index.ts:7 ` ` return await invoke<{value?: string}>('plugin:{{ plugin_name }}\|ping', { ` | open |
| Recover readable TypeScript files under missing or malformed base configs | Inside target | ~201 missing | 2 | 0.00 pp | 88.77% | trpc/trpc ` examples/nuxt/tsconfig.json:3 ` ` "extends": "./.nuxt/tsconfig.json" `<br>trpc/trpc ` examples/nuxt/server/tsconfig.json:2 ` ` "extends": "../.nuxt/tsconfig.server.json" ` | open |

**47.83% baseline → 88.77% after the listed items (+40.94 pp) → 91.39% source-only ceiling.** 41,836 unresolved links remain unexplained (12.75% of links estimated inside or still unclassified). 17,243 estimated links have valid alternatives, 24,987 name a unit only by design, and 0 are language intrinsics without a library symbol.
About 95,302 links need dependency information (78,074–156,749 from the sample and exact gaps). The 97.36% ceiling assumes all of those misses are recovered.

<!-- sweep:coverage:end -->

Recompute the plan and scoreboard with the coverage script. For a subset
candidate run, overlay files from matching pins. A matched site follows its
current recorded reason bucket even when its outcome has not changed.
A disappeared site remains unconfirmed.
[Sweep commands and classification rules](../sweep/README.md)
