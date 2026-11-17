# SW-2 hand-checked samples

Each row is one link from a diff bucket's fixed-seed sample (seed 1, the
first ten per repository in sample order; `node scripts/compare/show.mjs
--bucket <name> --context 2` prints them). For each I opened the call site and
the target and judged the link:

- **true**: the source really calls or refers to that target;
- **false**: it calls or refers to something else (usually a same-named
  method on another type, or a library symbol);
- **arguable**: defensible but not what the source literally does, or the
  right target with the wrong kind of link.

"Only others" means at least one of CodeGraph (CG) or graphify (GF) has the link
and Pymtheg does not; "Pymtheg state" is what Pymtheg has at that site.
"Only Pymtheg" means neither other tool has it. Line numbers are at the pinned
commits in `scripts/compare/pilot-repos.json`.

## Go

### Only others (chi, cobra)

| # | Site | Link | Who | Pymtheg state | Verdict | Why |
|---|---|---|---|---|---|---|
| 1 | chi `mux.go:71` | `ServeHTTP` → `endpoints.Value` (`tree.go:139`) | CG exact-match 0.9 | no link | false | `r.Context().Value(...)` is `context.Context.Value` from the standard library |
| 2 | chi `tree_test.go:553` | `TestWalkInline…` → `Router.Use` (`chi.go:73`) | CG, GF | unresolved, no reason | true | `r` is the closure parameter `r Router`; the target is the interface method |
| 3 | chi `chi.go:21`/`mux.go:363` | `Routes.Middlewares` → `Mux.Middlewares` | CG `calls` (heuristic), GF `dispatches_to` | other target | arguable | `*Mux` implements `Routes`, so this is an implementation link, not a call; GF's kind is right, CG's is wrong |
| 4 | chi `mux_test.go:473` | `TestMuxNestedMethodNotAllowed` → `compressResponseWriter.Close` | CG instance-method 0.7 | unresolved | false | `ts` is `*httptest.Server` |
| 5 | chi `_examples/rest/main.go:187` | `UpdateArticle` → `endpoints.Value` | CG | no link | false | `context.Context.Value` again |
| 6 | chi `middleware/route_headers.go:93` | `HeaderRouter.Handler` → `HeaderRoute.IsMatch` | CG instance-method 0.7 | unresolved, no reason | true | `matcher` ranges over `[]HeaderRoute` from a `HeaderRouter` map |
| 7 | chi `context.go:26` | `RouteContext` → `endpoints.Value` | CG | unresolved | false | `ctx context.Context` |
| 8 | chi `tree.go:55` (map literal, key on line 61) | `reverseMethodMap` → `mPATCH` | CG value-ref | no link | true | map literal key; Pymtheg links the values in that literal but not the keys |
| 9 | chi `mux_test.go:1871` | `TestQueryHTTPMethod` → `compressResponseWriter.Close` | CG | unresolved | false | `ts` is `*httptest.Server` |
| 10 | chi `_examples/rest/main.go:82` | route `GET /search` → `SearchArticles` | CG framework route node | same target, other source | true (attribution only) | Pymtheg has the reference from the enclosing function; CG attributes it to a synthetic route node |
| 11 | cobra `command.go:1840` | `HasAvailableInheritedFlags` → `Command.HasAvailableFlags` | CG exact-match 0.9 | no link | false | `InheritedFlags()` returns `*pflag.FlagSet`; the callee is pflag's method |
| 12 | cobra `doc/md_docs.go:34` | `printOptions` → `Command.SetOutput` | CG instance-method 0.7 | unresolved | false | `flags` is `*pflag.FlagSet` |
| 13 | cobra `completions.go:175` | `RegisterFlagCompletionFunc` → `flagCompletionMutex` | CG value-ref | no link | true | `flagCompletionMutex.Lock()`: Pymtheg keeps the unresolved `Lock` call but records no reference to the package variable used as receiver |
| 14 | cobra `fish_completions_test.go:139` | `TestFailGenFishCompletionFile` → `Command.Name` | CG | unresolved | false | `f` is `*os.File` |
| 15 | cobra `cobra.go:38` | file → `Gt` | CG function-ref | same target, other source | true (attribution only) | Pymtheg links it from `templateFuncs` |
| 16 | cobra `doc/rest_docs.go:32` | `printOptionsReST` → `Command.SetOutput` | CG | unresolved | false | pflag again |
| 17 | cobra `completions.go:1009` | `configEnvVar` → `configEnvVarPrefixSubstRegexp` | CG value-ref | no link | true | package variable used as a method receiver, as in 13 |
| 18 | cobra `cobra.go:37` | file → `rpad` | CG function-ref | same target, other source | true (attribution only) | as 15 |
| 19 | cobra `command.go:1807` | `HasPersistentFlags` → `Command.HasFlags` | CG exact-match 0.9 | no link | false | `PersistentFlags()` returns `*pflag.FlagSet` |
| 20 | cobra `command.go:1817` | `HasInheritedFlags` → `Command.HasFlags` | CG exact-match 0.9 | no link | false | as 19 |

Go, only others: **9 true** (3 of them only attributed to a different
source, so not misses), **1 arguable**, **10 false**. Every false one is
CodeGraph linking a method call to a same-named method in the project when
the receiver is a standard-library or dependency type. Real Pymtheg misses: a
call on an interface-typed parameter (2), a range variable over a map of
slices (6), map-literal keys (8), and package variables used as method
receivers (13, 17).

### Only Pymtheg (chi, cobra)

| # | Site | Link | Pymtheg | Verdict | Why |
|---|---|---|---|---|---|
| 1 | chi `mux_test.go:1661` | `TestMuxRegexp3` → `Mux.Delete` | definite | true | `r := NewRouter()` returns `*Mux`; CG left it unresolved |
| 2 | chi `_examples/rest/main.go:485` | `dbGetArticleBySlug` → var `articles` | definite | true | package variable read |
| 3 | chi `middleware/compress.go:347` | `writer` → field `compressible` | definite | true | field read |
| 4 | chi `middleware/middleware_test.go:42` | `TestNew` → `chi.NewRouter` | definite | true | cross-package call; CG unresolved |
| 5 | chi `middleware/wrap_writer.go:167` | `Hijack` → embedded field `basicWriter.ResponseWriter` | definite | true | embedded field selector |
| 6 | chi `middleware/wrap_writer.go:135` | `BytesWritten` → field `bytes` | definite | true | field read |
| 7 | chi `middleware/wrap_writer.go:223` | `ReadFrom` → field `wroteHeader` | definite | true | field through an embedded struct |
| 8 | chi `middleware/compress_test.go:17` | `TestCompressor` → `chi.NewRouter` | definite | true | cross-package call |
| 9 | chi `tree_test.go:586` | `TestWalkRoute…` → `Mux.Route` | definite | true | `r := NewRouter()`; CG and GF pick the interface method `Router.Route` instead |
| 10 | chi `middleware/strip_test.go:107` | `TestRedirectSlashes` → `RedirectSlashes` | definite | true | function value passed to `Use` |
| 11 | cobra `completions_test.go:852` | test → type `ShellCompDirective` | definite | true | type in a function literal's result |
| 12 | cobra `bash_completions.go:401` | `writePreamble` → const `ShellCompDirectiveFilterDirs` | definite | true | constant argument |
| 13 | cobra `command.go:1239` | `InitDefaultVersionFlag` → field `Version` | definite | true | field read |
| 14 | cobra `completions_test.go:3144` | test → const `ShellCompNoDescRequestCmd` | definite | true | constant |
| 15 | cobra `doc/yaml_docs_test.go:35` | `TestGenYamlDoc` → field `Command.Long` | definite | true | `echoCmd` is a `*cobra.Command` |
| 16 | cobra `completions_test.go:2528` | test → const `ShellCompNoDescRequestCmd` | definite | true | constant |
| 17 | cobra `command.go:1366` | `AddCommand` → field `commandsAreSorted` | definite | true | field write |
| 18 | cobra `completions_test.go:2807` | test → field `DisableFlagParsing` | definite | true | field write |
| 19 | cobra `command.go:1650` | `HasHelpSubCommands` → field `commands` | definite | true | field read |
| 20 | cobra `cobra.go:106` | `OnFinalize` → var `finalizers` | definite | true | package variable |

Go, only Pymtheg: **20 true**. Mostly field and constant references (the other
tools have no field symbols and CodeGraph records few constant reads), and
calls through a typed local (`r := NewRouter()`) or across packages that
CodeGraph leaves unresolved.

## Rust

### Only others (fd, just)

| # | Site | Link | Who | Pymtheg state | Verdict | Why |
|---|---|---|---|---|---|---|
| 1 | fd `src/dir_entry.rs:13` | `DirEntryInner` → struct `DirEntry` | GF | unresolved | false | the variant holds `ignore::DirEntry`, the crate's type, not fd's |
| 2 | fd `tests/tests.rs:2811` | `test_max_results` → `TestEnv.assert_success_and_get_output` | CG instance-method 0.7 | unresolved: receiver type unverified | true | `te` is a `TestEnv` from `TestEnv::new` |
| 3 | fd `src/cli.rs:898` | `Exec.update_from_arg_matches` → `Exec.from_arg_matches` | CG, GF | unresolved: trait dispatch | true | `Self::from_arg_matches` inside the same `impl FromArgMatches for Exec` |
| 4 | fd `src/fmt/mod.rs:270` | test → `FormatTemplate.generate` | GF | unresolved: receiver type unverified | true | `templ` is built as a `FormatTemplate` |
| 5 | fd `tests/tests.rs:896` | test → `TestEnv.assert_output` | CG | unresolved: receiver type unverified | true | as 2 |
| 6 | fd `tests/tests.rs:2952` | test → `TestEnv.assert_output` | CG | same | true | as 2 |
| 7 | fd `tests/tests.rs:1827` | test → `TestEnv.system_root` | CG | same | true | `te` comes from a tuple returned by a project function |
| 8 | fd `src/fmt/mod.rs:130` | `FormatTemplate.generate` → `dirname` | CG, GF | unresolved: namespace binding unverified | true | `dirname` imported from `input` |
| 9 | fd `src/main.rs:92` | `run` → `Opts.search_paths` | CG instance-method 0.8 | unresolved: receiver type unverified | true | `opts: Opts` |
| 10 | fd `tests/tests.rs:499` | test → `TestEnv.assert_output` | CG | same | true | as 2 |
| 11 | just `tests/cache.rs:1293` | test → `Test.failure` | CG exact-match 0.9 | unresolved: receiver type unverified | true | builder chain `Test::new().….failure()`; each step returns `Self` |
| 12 | just `tests/completions.rs:494` | test → `Test.stdout_regex` | CG | same | true | as 11 |
| 13 | just `tests/lists.rs:749` | test → `Test.stdout` | CG | same | true | as 11 |
| 14 | just `tests/misc.rs:1050` | test → `Test.arg` | CG | same | true | as 11 |
| 15 | just `tests/lists.rs:935` | test → `Test.failure` | CG | same | true | as 11 |
| 16 | just `tests/init.rs:90` | `alternate_marker` → `Test.arg` | CG exact-match 0.9 | unresolved | false | `just()` returns `std::process::Command`; `.arg` is the standard library's |
| 17 | just `src/error.rs:530` | `Error.fmt` → `Color.message` | CG instance-method 0.9 | unresolved: receiver type unverified | true | `color: Color` |
| 18 | just `tests/choose.rs:341` | test → `Test.success` | CG | same | true | as 11 |
| 19 | just `src/recipe_resolver.rs:103` | `resolve_dependency` → `Keyword.lexeme` | CG exact-match 0.4 | no link | false | `recipe.last()` is a `Name`; `lexeme` is `Token`'s, reached through `Deref` |
| 20 | just `tests/constants.rs:55` | test → `Test.response` | CG | same | true | as 11 |

Rust, only others: **17 true**, **3 false**. The true ones are almost all one
class: Pymtheg does not carry the type of a local or a method-chain result
into the next method call (`receiver-type-unverified`), even when the type is
plain (`let te = TestEnv::new(…)`, a builder returning `Self`). Two smaller
classes: `Self::method` inside a trait impl (`trait-dispatch`), and a
function imported with `use` (`namespace-binding-unverified`).

### Only Pymtheg (fd, just)

| # | Site | Link | Pymtheg | Verdict | Why |
|---|---|---|---|---|---|
| 1 | fd `src/dir_entry.rs:149` | `file_name` → variant `DirEntryInner::BrokenSymlink` | definite (`patterns`) | true | match pattern |
| 2 | fd `src/fmt/input.rs:56` | file → `macro_rules! func_tests` | definite (`macros`) | true | local macro invocation |
| 3 | fd `src/exec/job.rs:54` | `batch` → variant `WorkerResult::Error` | definite | true | match pattern |
| 4 | fd `src/patterns.rs:120` | → variant `PatternType::Regex` | definite | true | match pattern |
| 5 | fd `src/dir_entry.rs:167` | `impl Colorable for DirEntry::metadata` → inherent `DirEntry::metadata` | definite | true | inherent method wins over the trait method of the same name; CG unresolved |
| 6 | fd `src/output.rs:31` | `print_entry` → `print_entry_uncolorized` | candidate (closed set of 2) | true | two `cfg` variants of the function; a set is the honest answer |
| 7 | fd `src/walk.rs:213` | → variant `ReceiverMode::Streaming` | definite | true | match pattern |
| 8 | fd `src/main.rs:234` | → variant `PatternType::Regex` | definite | true | value |
| 9 | fd `src/error.rs:37` | associated type → `SanitizedError` | definite | true | type reference |
| 10 | fd `src/filetypes.rs:88` | test → variant `FileType::File` | definite | true | value |
| 11 | just `src/resolution.rs:8` | `impl` → `Resolution` | definite (`types`) | true | impl self type |
| 12 | just `src/color.rs:158` | `heading` → `Color` | definite | true | `-> Self` in `impl Color` |
| 13 | just `src/node.rs:24` | `impl Node for Item` → `Item` | definite | true | impl self type |
| 14 | just `src/const_error.rs:10` | `impl` → `ConstError` | definite | true | impl self type |
| 15 | just `src/list_feature.rs:56` | `fmt` → variant `ListFeature::IfWithoutElse` | definite | true | `Self::IfWithoutElse` pattern |
| 16 | just `src/evaluator.rs:584` | `evaluate_value` → variant `Expression::Join` | definite | true | match pattern |
| 17 | just `src/shell_kind.rs:37` | `impl From<&Command> for ShellKind` → `ShellKind` | definite | true | impl self type |
| 18 | just `src/compiler.rs:78` | `compile` → variant `Item::Import` | definite | true | match pattern |
| 19 | just `src/hash.rs:29` | `impl Display for Hash` → `Hash` | definite | true | impl self type |
| 20 | just `src/list.rs:16` | `and` → `List` | definite | true | `-> Self` in `impl List` |

Rust, only Pymtheg: **20 true**. Enum variants in patterns and values, impl
self types and `Self`, local macros, and inherent-before-trait method choice.

## TypeScript

### Only others (ky)

| # | Site | Link | Who | Pymtheg state | Verdict | Why |
|---|---|---|---|---|---|---|
| 1 | ky `source/types/retry.ts:4` | `MutableRetryOptions` → type `HttpMethod` | CG import 0.9 | unresolved: `incomplete-config` | true | imported type |
| 2 | ky `test/hooks.ts:218` | test → `delay()` (`test/hooks.ts:127`) | GF | unresolved: `external-package` | false | `delay` is `setTimeout` imported from `node:timers/promises`; line 127 is an unrelated object-literal method |
| 3 | ky `source/core/Ky.ts:402` | `Ky.create` → `Ky.#getResponseRequest` | GF inferred 0.85 | unresolved: `incomplete-config` | true | private method on a `Ky` instance |
| 4 | ky `test-d/normalized-options.ts:35` | `ExpectedProgressCallbacks` → interface `Options` (same file) | CG exact-match 0.4 | unresolved: `incomplete-config` | true | same-file interface |
| 5 | ky `test/response-size.ts:271` | test → `ExtendedHttpTestServer.close` | CG instance-method 0.7 | unresolved: `external` | false | `controller` is a `ReadableStreamDefaultController` |
| 6 | ky `source/types/hooks.ts:45` | `BeforeRetryState` → type `KyRequest` | CG | unresolved: `incomplete-config` | true | imported type |
| 7 | ky `source/core/Ky.ts:1366` | `Ky.#limitResponseSize` → `limitResponseSize` | CG, GF | unresolved: `incomplete-config` | true | imported function |
| 8 | ky `test/hooks.ts:6265` | test → `shouldRetry` | CG function-ref | no link | true | shorthand property `{shouldRetry}` passes the local function |
| 9 | ky `test/main.ts:2494` | test → `KyInstance.head` | CG instance-method 0.7 | unresolved: `local` | true | `extended = ky.extend(…)` is a `KyInstance`; `head` is a member of that object type |
| 10 | ky `test/memory-leak.ts:27` | test → `isKyLeaking` | CG, GF | unresolved: `local` | true | function declared inside the test callback, called there |

ky, only others: **8 true**, **2 false**. Six of the eight are one cause:
`tsconfig.json` extends `@sindresorhus/tsconfig`, a package that is not installed
in a clean clone, so Pymtheg marks 52 of 98 files partial (`incomplete-config`)
and leaves their cross-file links unresolved, while the other tools link by
name. The rest: functions declared inside functions are not symbols in Pymtheg
(`local`), members of object types (`KyInstance.head`), and shorthand
properties that pass a function.

### Only others (T3 Code, own code)

From the run with the Node heap raised to 32 GB (Pymtheg does not finish T3
Code with the default heap), on the `t3code-first-party` entry: the pinned
commit without its vendored `.repos/` directory.

| # | Site | Link | Who | Pymtheg state | Verdict | Why |
|---|---|---|---|---|---|---|
| 1 | `apps/web/src/components/CommandPalette.tsx:2679` | `handleKeyDown` → `submitNewProject` | CG, GF | unresolved: `local` | true | function declared inside the component, called from a nested handler |
| 2 | `apps/server/src/terminal/Manager.ts:2688` | `stopProcess` → `cleanupProcessHandles` | CG | same target, other source | true (attribution only) | Pymtheg links it from the enclosing function |
| 3 | `apps/mobile/src/features/pull-requests/PullRequestRouteScreen.tsx:957` | JSX → `AppActivityIndicator` | GF | unresolved: `incomplete-config` | true | `apps/mobile/tsconfig.json` extends `expo/tsconfig.base.json`, not installed |
| 4 | `apps/desktop/src/backend/DesktopLocalEnvironmentAuth.test.ts:56` | `new Response(…)` → server's `Response` schema | CG exact-match 0.4 | unresolved: `external` | false | the global fetch `Response`; the file does not import the schema |
| 5 | `apps/mobile/src/features/pull-requests/pullRequestActions.ts:141` | → interface `ChangeRequestTerminology` | CG exact-match 0.9 | unresolved: `incomplete-config` | true | imported type, mobile app |
| 6 | `apps/server/src/preview/ServerBrowser.ts:2422` | `pointerFor` → interface `ServerTab` | CG | same target, other source | true (attribution only) | |
| 7 | `apps/mobile/src/features/projects/AddProjectScreen.tsx:1120` | → `getNewProjectPublishTargets` | CG, GF | unresolved: `incomplete-config` | true | imported from the `@t3tools/client-runtime` workspace package |
| 8 | `apps/desktop/src/preview/CdpRelay.ts:243` | `pageCommand` → `releaseHeldFramesWithoutHolders` | CG | unresolved: `local` | true | arrow function in a `const` inside the enclosing function |
| 9 | `apps/mobile/src/features/threads/new-task-flow-state.ts:165` | `pruneNewTaskFlowStates` → `appAtomRegistry` | CG `calls` | no link (partial file) | arguable | a reference to the registry object (`appAtomRegistry.get(…)`), not a call to it |
| 10 | `apps/server/src/mcp/OrchestratorMcpService.ts:226` | → `OrchestratorMcpThreadSendInput` (the `const`, `packages/contracts/src/orchestratorMcp.ts:550`) | CG exact-match 0.4 | unresolved: `external-package` | arguable | the parameter's type is the same-named `type` alias at line 563; CG points at the schema value. Pymtheg has neither: `@t3tools/contracts` is a pnpm workspace package and Pymtheg treats it as external |

T3 Code, only others: **7 true** (2 attribution only), **2 arguable**,
**1 false**. Classes: functions declared inside functions (`local`), the
mobile app's `tsconfig.json` extending an uninstalled `expo` preset (1,462 of
the app's files partial), and imports of sibling pnpm workspace packages,
which Pymtheg leaves `external-package` (a documented limit, but the largest
single cause in this repository).

### Only Pymtheg (ky)

| # | Site | Link | Pymtheg | Verdict | Why |
|---|---|---|---|---|---|
| 1 | ky `test/request-construction.ts:24` | test → `ky` (`source/index.ts:58`) | definite | true | default import of `const ky = createInstance()`; CG picks another target |
| 2 | ky `test/retry-decisions.ts:284` | test → class `NonError` | definite | true | `as NonError` |
| 3 | ky `test/response-consumption.ts:18` | test → `ky` | definite | true | as 1; CG unresolved |
| 4 | ky `test/main.ts:2395` | test → class `HTTPError` | definite | true | type argument and `instanceOf` value |
| 5 | ky `test/http-metadata.ts:18` | test → `ky` | definite | true | as 1 |
| 6 | ky `test-d/normalized-options.ts:46` | → type `ExpectedProgressCallbacks` | definite | true | same-file type in `keyof` |
| 7 | ky `test/http-response-bodies.ts:37` | test → `ky` | definite | true | as 1 |
| 8 | ky `test/hooks.ts:125` | test → `ky` | definite | true | as 1 |
| 9 | ky `test/stream.ts:170` | test → `parseJsonBody` | definite | true | imported helper call |
| 10 | ky `test/resilience.ts:826` | `bodyCases` → `scriptedFetch` | definite | true | `ReturnType<typeof scriptedFetch>` |

ky, only Pymtheg: **10 true**. Calls through a default import of a `const`,
type positions (`as`, type arguments, `typeof`, `keyof`).

### Only Pymtheg (T3 Code, own code)

| # | Site | Link | Pymtheg | Verdict | Why |
|---|---|---|---|---|---|
| 1 | `packages/client-runtime/src/connection/model.ts:34` | `SshConnectionTarget` → itself | definite | true | `Schema.TaggedClass<SshConnectionTarget>()`: the class names itself as a type argument |
| 2 | `packages/effect-codex-app-server/src/_generated/meta.gen.ts:366` | → type `V2ThreadInjectItemsResponse` | definite | true | namespace-qualified type in a generated file; CG unresolved |
| 3 | `packages/issue-tracker-linear/schema/linear.graphql.ts:3140` | → interface `NullableUserFilter` | definite | true | property type; CG points at another same-named symbol |
| 4 | `scripts/dev-runner.ts:195` | `DevRunnerBuiltNeedsShareError` → itself | definite | true | as 1 |
| 5 | `apps/server/src/orchestration-v2/CommandPolicy.ts:297` | `ensureInterrupt` → interface `CommandPolicyV2Shape` | definite | true | indexed access type `CommandPolicyV2Shape["ensureInterrupt"]` |
| 6 | `packages/issue-tracker-linear/schema/linear.graphql.ts:4294` | → interface `BooleanComparator` | definite | true | as 3 |
| 7 | `apps/server/src/cli/project.ts:148` | `ProjectAlreadyExistsError` → itself | definite | true | as 1 |
| 8 | `packages/issue-tracker-linear/schema/linear.graphql.ts:2856` | → interface `NullableDateComparator` | definite | true | as 3 |
| 9 | `apps/server/src/provider/antigravityAuthSupport.ts:235` | `AntigravitySkillLinkError` → itself | definite | true | as 1 |
| 10 | `apps/desktop/src/snapShot/PortalCaptureShortcut.test.ts:105` | `FakeBus.call` → type `Shortcut` | definite | true | `as Shortcut[]` |

T3 Code, only Pymtheg: **10 true**, though four are a class naming itself in
`Schema.TaggedClass<Self>()`, which is true but of little use. The useful ones
are type positions the others skip (indexed access, `as`, namespace-qualified
types) and same-named type/value pairs where CodeGraph picks the value.
