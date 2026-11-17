# SW-2: Pymtheg against other code-graph tools, pilot

Pymtheg 0.1.0 (the released package), CodeGraph 1.6.2 and graphify 0.9.112 were
run on the same six public repositories, two per language, on the dev server.
Every tool's symbols and links were put into one shape and matched. Then I
hand-checked 40 links per language: 20 that only the other tools have and 20
that only Pymtheg has. Harness: [`scripts/compare/`](../../scripts/compare/README.md).
Raw tables: [`results.md`](results.md). The hand-checked rows:
[`hand-check.md`](hand-check.md).

Nothing in Pymtheg was changed. Findings are listed for later chunks.

## Short answer

- **What the others catch that Pymtheg misses comes down to a few classes.**
  TypeScript: imports of sibling pnpm workspace packages (treated as external),
  functions declared inside functions (not symbols), and a `tsconfig.json`
  that extends a preset package that is not installed (most cross-file links
  then unresolved). Rust: method calls on a local or a method-chain result
  whose type Pymtheg does not carry forward, and files that use glob imports
  (`use super::*`). Go: very little that is real (interface-typed receivers,
  range variables, map-literal keys, package variables used as receivers).
- **What Pymtheg catches that they miss** is real every time I looked
  (60 of 60): fields, constants and enum variants, impl and `Self` types, type
  positions in TypeScript, cross-package Go calls, and candidate sets where
  there is more than one possible target.
- **CodeGraph is often wrong when it is the only one to see a link.** In Go,
  10 of the 20 sampled links that only the other tools had were false, all of
  them CodeGraph's: it links a method call to a same-named project method when
  the receiver is a standard-library or dependency type (`ctx.Value` → chi's
  `endpoints.Value`). Its confidence
  number does not separate these (0.9 on false links). In Rust and TypeScript
  the others were right more often (17 of 20, and 15 of 20 with 2 arguable).
- **Pymtheg could not index T3 Code as installed.** It ran out of Node's
  default heap (about 4 GB) both on the whole repository and on its own code
  without the vendored trees. CodeGraph and graphify finished both. With the
  heap raised to 32 GB it finished T3 Code's own code in 22 minutes at 11.9 GB
  peak, which is the run the T3 Code comparison uses.
- **Recommendation:** run CodeGraph on all 60; run graphify too only because it
  is cheap and adds a second opinion; treat "only they found it" as leads to
  check, never as truth.

## Tools: what installed and what ran

| Tool | Version, licence | Installed from | What ran | Network, models |
|---|---|---|---|---|
| Pymtheg | 0.1.0, MIT | npm `pymtheg@0.1.0` into a scratch prefix | `pymtheg init`, `pymtheg graph index --json`, source only (the Go toolchain route is off by default and stayed off) | none |
| CodeGraph | 1.6.2, MIT | npm `@colbymchenry/codegraph@1.6.2` into a scratch prefix | `codegraph init -y` with telemetry off (`CODEGRAPH_TELEMETRY=0`) | none |
| graphify | 0.9.112, Apache-2.0 (some older parts MIT, per its NOTICE) | PyPI `graphifyy` (the real project, `Graphify-Labs/graphify`, formerly `safishamsi/graphify`; not the unrelated npm `graphify`) into a virtual environment made with uv's standalone binary, since the server has no pip | `graphify extract --code-only --no-cluster --max-workers 4`: its local tree-sitter extraction only | none |

All three ran in their own copy of each checkout, with a scratch `HOME`, no API
keys in the environment and no network (`unshare -rn`; the harness checks
this works before using it). None of them ran the project's toolchain, install
scripts, builds or tests in these modes.

**Left out of graphify:** the semantic pass over documents, papers and images
(it needs a language model and an API key), community detection and its
model-written labels, and everything that talks to a service (`clone`, `add`,
`prs`, cloud). `--code-only` skips the documents; `--no-cluster` skips the
clustering. Its package does not even install a model SDK by default, and the
run had no network, so no model call could have happened.

**Extra tools considered and rejected** (the brief allowed up to two more):

| Tool | Why not now |
|---|---|
| Sourcegraph SCIP indexers (`scip-typescript`, `scip-go`, `rust-analyzer scip`) | The strongest candidates and well known, but they are compiler front ends: accurate types need the dependencies installed (`node_modules`, Go module download, `cargo metadata`), and `rust-analyzer` runs build scripts and proc macros (project code) unless both are turned off. That is a sandboxing job, not a quick add. They would make a good referee later (see the recommendation). |
| universal-ctags | Symbols only, no call or reference edges. |
| GitHub stack graphs | Archived by GitHub in September 2025 and flagged unmaintained (RUSTSEC-2026-0303); only a few languages. |
| tree-sitter `tags` queries (as used by repo maps) | Name-level references with no resolution; adds nothing that graphify does not. |

## How links are matched

Only in-project symbol-to-symbol links are compared (calls, references,
heritage), with both ends in a TypeScript/JavaScript, Go or Rust file.
Imports are counted, not matched: the tools model them at different levels.
Two tools have the same link when the source and target files and names match
(names normalised: `.Get()` = `Get`, generics dropped, qualified names keep the
last part) and both declaration lines are within 3 lines; the container
(receiver, class, impl type) only breaks ties. A second pass joins links that
the tools attribute to different enclosing symbols but write at the same call
site (within 1 line). Kinds are not part of the match. Pymtheg's candidate sets
stay candidate sets: a set member counts as "Pymtheg has it, as a candidate",
never as definite. The rule is deterministic; the full statement is in
[`scripts/compare/README.md`](../../scripts/compare/README.md#the-matching-rule).

## Per repository

Wall time and peak memory are observations on a shared machine (peak memory is
the largest single process). "Compared" is the number of distinct
symbol-to-symbol links that enter the match; "Unresolved" counts links with
no target (graphify keeps none). Outcomes: `incomplete (exit 2)` is Pymtheg's
normal exit when some files are partial; `partial (exit 134)` is Pymtheg
aborting with "JavaScript heap out of memory", and such a run is left out of
the diff. "Only others" means CodeGraph or graphify has the link and Pymtheg
does not. Full tables with every bucket: [`results.md`](results.md).

### Default run (what a user gets)

**t3code** (typescript, `b387e3a179d7`, Go 0, Rust 10, TS/JS 27468 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | partial (exit 134) | 1670.7 | 4706.1 | 345 | 0 | 0 | 4312 | – |
| codegraph | ok | 922.3 | 12328.1 | 310790 | 543056 | 252687 | 1504752 | 438870 |
| graphify | ok | 1263.7 | 1902.1 | 249946 | 158821 | 9467 | 0 | 162057 |

Pymtheg left out of the diff (partial (exit 134)). Links: CodeGraph and graphify both 146478; only CodeGraph 292392; only graphify 15579.

**t3code-first-party** (typescript, `b387e3a179d7`, Go 0, Rust 10, TS/JS 7204 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | partial (exit 134) | 1374.4 | 5687.8 | 94855 | 215 | 352 | 1148100 | – |
| codegraph | ok | 450.1 | 6274.1 | 113355 | 181826 | 82507 | 669273 | 161339 |
| graphify | ok | 395.9 | 689.4 | 73679 | 62792 | 6890 | 0 | 61387 |

Pymtheg left out of the diff (partial (exit 134)). Links: CodeGraph and graphify both 58485; only CodeGraph 102854; only graphify 2902.

**ky** (typescript, `3541888878c4`, Go 0, Rust 0, TS/JS 98 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | incomplete (exit 2) | 27.5 | 664 | 570 | 2224 | 216 | 14441 | 437 |
| codegraph | ok | 17.6 | 492.8 | 827 | 3179 | 398 | 12310 | 847 |
| graphify | ok | 4.7 | 69.9 | 721 | 361 | 21 | 0 | 390 |

Links: all three 204; only Pymtheg 47 (definite 47, candidate 0); only others 496 (only CodeGraph 317, only graphify 32); Pymtheg candidate where others claim one target 0.

**chi** (go, `c64ed7d6635f`, Go 90, Rust 0, TS/JS 0 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | ok | 23.7 | 393.9 | 834 | 1362 | 1371 | 5641 | 1650 |
| codegraph | ok | 4 | 350.7 | 905 | 1339 | 253 | 4445 | 1046 |
| graphify | ok | 2.1 | 47.4 | 656 | 498 | 553 | 0 | 626 |

Links: all three 532; only Pymtheg 847 (definite 819, candidate 28); only others 282 (only CodeGraph 226, only graphify 1); Pymtheg candidate where others claim one target 5.

**cobra** (go, `adbc8813901b`, Go 36, Rust 0, TS/JS 0 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | ok | 20.8 | 430.7 | 832 | 2221 | 2326 | 3238 | 2918 |
| codegraph | ok | 3.1 | 354 | 720 | 2671 | 315 | 3033 | 2126 |
| graphify | ok | 1.6 | 49.5 | 757 | 1410 | 532 | 0 | 1532 |

Links: all three 1507; only Pymtheg 801 (definite 800, candidate 1); only others 34 (only CodeGraph 33, only graphify 1); Pymtheg candidate where others claim one target 1.

**fd** (rust, `6cf330283cfd`, Go 0, Rust 25, TS/JS 0 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | ok | 16.4 | 401.8 | 638 | 449 | 535 | 3914 | 866 |
| codegraph | ok | 3.2 | 359.9 | 544 | 810 | 285 | 1999 | 815 |
| graphify | ok | 1.5 | 50.9 | 678 | 234 | 245 | 0 | 382 |

Links: all three 236; only Pymtheg 221 (definite 219, candidate 2); only others 278 (only CodeGraph 221, only graphify 19); Pymtheg candidate where others claim one target 4.

**just** (rust, `62784c2a6e16`, Go 0, Rust 277, TS/JS 0 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | ok | 221.7 | 1204.2 | 4666 | 4093 | 2013 | 27103 | 4733 |
| codegraph | ok | 5.8 | 516.5 | 4123 | 13118 | 1294 | 6964 | 12750 |
| graphify | ok | 4.5 | 55.3 | 4224 | 1281 | 1683 | 0 | 2632 |

Links: all three 1262; only Pymtheg 1224 (definite 1224, candidate 0); only others 9791 (only CodeGraph 8531, only graphify 440); Pymtheg candidate where others claim one target 0.

### T3 Code with the Node heap raised to 32 GB

`--node-heap 32768`, applied to Pymtheg and CodeGraph; graphify is Python and
unchanged. Used for the T3 Code hand-check.

**t3code-first-party** (typescript, `b387e3a179d7`, Go 0, Rust 10, TS/JS 7204 source files)

| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pymtheg | incomplete (exit 2) | 1338.9 | 11860.5 | 94855 | 117731 | 40126 | 849960 | 82916 |
| codegraph | ok | 434.8 | 6233.6 | 113355 | 181826 | 82507 | 669273 | 161339 |
| graphify | ok | 392.5 | 687.6 | 73679 | 62792 | 6890 | 0 | 61387 |

Links: all three 42895; only Pymtheg 13308 (definite 13308, candidate 0); only others 94627 (only CodeGraph 76796, only graphify 2235); Pymtheg candidate where others claim one target 0.

**t3code** (whole repository, raised heap): CodeGraph finished in 891 s and
graphify in 1,184 s. Pymtheg had not finished after 50 minutes (about 10 GB
resident and steady) when this was written; its outcome is not part of this
comparison.

## Hand-checked samples

40 per language: the first ten links in each bucket's fixed-seed sample from
each of the two repositories (for TypeScript, `ky` and T3 Code's own code from
the raised-heap run, since the default run of Pymtheg did not finish T3 Code). All rows: [`hand-check.md`](hand-check.md).

| Language | Bucket | True | Arguable | False |
|---|---|---:|---:|---:|
| Go | only others | 9 (3 only attributed to another enclosing symbol) | 1 | 10 |
| Go | only Pymtheg | 20 | 0 | 0 |
| Rust | only others | 17 | 0 | 3 |
| Rust | only Pymtheg | 20 | 0 | 0 |
| TypeScript | only others | 15 (2 only attributed to another enclosing symbol) | 2 | 3 |
| TypeScript | only Pymtheg | 20 | 0 | 0 |

Every false link in the samples came from a tool linking by name: a method
call to a same-named project method when the receiver is a library type, or a
library type to a same-named project type.

## What the others catch that Pymtheg misses (ranked)

Only classes the hand-check found true. Ranked by the number of pilot sites
where another tool has an in-project link and Pymtheg's state there is that
class (from each diff's `byAbsentState`). The counts are upper bounds, since
some of the others' links at those sites are false (2 to 5 in 20 in the
samples), and T3 Code, the largest repository, dominates the TypeScript counts.

1. **TypeScript: imports of sibling workspace packages in a pnpm monorepo are
   treated as external** (`external-package`; 22,379 sites, all in T3 Code).
   Pymtheg documents pnpm-only workspaces as unresolved; T3 Code is one.
   Example: T3 Code `apps/server/src/mcp/OrchestratorMcpService.ts:226` (a type
   from `@t3tools/contracts`). Expect it in most TypeScript monorepos in the
   sweep.
2. **TypeScript: functions declared inside functions are not symbols**
   (`local`; 16,221 sites in T3 Code, 53 in `ky`). React components and Effect
   generators declare most of their helpers this way. Examples: T3 Code
   `apps/web/src/components/CommandPalette.tsx:2679` (`submitNewProject`),
   `apps/desktop/src/preview/CdpRelay.ts:243`, `ky` `test/memory-leak.ts:27`.
3. **TypeScript: a `tsconfig.json` that extends a package preset that is not
   installed** (`incomplete-config`; 10,453 sites in T3 Code, 251 in `ky`). In
   a clean clone (nothing installed, as in the sweep) Pymtheg marks the files
   partial and leaves their cross-file links unresolved, even plain relative
   imports. `ky` extends `@sindresorhus/tsconfig`: 52 of 98 files partial.
   T3 Code's mobile app extends `expo/tsconfig.base.json`: 1,462 of its 1,464
   files partial. Examples: `ky` `source/core/Ky.ts:1366` (the imported
   `limitResponseSize`), `source/types/hooks.ts:45` (imported type
   `KyRequest`), T3 Code `apps/mobile/src/features/projects/AddProjectScreen.tsx:1120`.
4. **Rust: the receiver type of a method call is not carried from a local or
   from a method chain** (`receiver-type-unverified`; 7,182 sites in `just`,
   211 in `fd`, and 15 of the 20 Rust samples). The types are plain:
   `let te = TestEnv::new(…)`, a tuple returned by a project function, a
   builder whose methods return `Self`. Examples: `just` `tests/cache.rs:1293`
   (`Test::new()….failure()`), `fd` `tests/tests.rs:2811`
   (`te.assert_success_and_get_output`), `just` `src/error.rs:530`
   (`color.message()` with `color: Color`), `fd` `src/main.rs:92`
   (`opts.search_paths()`).
5. **Rust: glob imports make names opaque** (`opaque-item-may-shadow-name`,
   `namespace/import/alias structure is unknown`; 987 and 361 sites in `just`,
   which uses `use super::*` in nearly every file). Struct fields, enum
   variants and `impl` targets that name crate types are left unresolved.
   Examples: `just` `src/attribute.rs:451` (`CompileErrorKind::ArgumentCountParse`),
   `src/analyzer.rs:155` (`Table::default()`), `src/recipe.rs:6`
   (field type `AttributeSet`).
6. **Go: calls on interface-typed values and on range variables** are left
   unresolved with no reason recorded (160 sites: 147 in chi, 13 in cobra),
   instead of linking to the interface method (or a candidate set of
   implementations) or typing the range variable. Examples: `chi`
   `tree_test.go:553` (`r.Use(mw)` with `r Router`),
   `middleware/route_headers.go:93` (`matcher.IsMatch` over a map of
   `[]HeaderRoute`).
7. **Rust: `Self::method` and `self.method()` that go through a trait impl**
   (`trait-dispatch`, `later-probe-step`, `inherent-applicability-unverified`;
   about 110 sites in the two repositories). Examples: `fd` `src/cli.rs:898`
   (`Self::from_arg_matches` inside `impl FromArgMatches for Exec`),
   `fd` `src/dir_entry.rs:130` (`self.cmp(other)` in `impl PartialOrd`),
   `fd` `tests/testenv/mod.rs:204` (`self.test_root()`).
8. **Rust: functions brought in with `use`** (`namespace-binding-unverified`;
   9 sites in `fd`, a few dozen more in combination with other reasons in
   `just`). Example: `fd` `src/fmt/mod.rs:130` (`dirname`, imported from
   `input`).
9. **TypeScript: members of object types are not link targets**, and
   shorthand properties that pass a function get no reference (both inside the
   "no link at site" counts). Examples: `ky` `test/main.ts:2494`
   (`extended.head`, a member of `KyInstance`), `test/hooks.ts:6265`
   (`{shouldRetry}`).
10. **Go: small reference gaps** (inside the "no link at site" counts). A
    package variable used as a method receiver gets no reference (`cobra`
    `completions.go:175` `flagCompletionMutex.Lock()`, `completions.go:1009`);
    map-literal keys get none while values do (`chi` `tree.go:61`).

Not classified: sites where Pymtheg has no link of any kind (28,609 in T3
Code's own code, 775 in `just`, 86 in chi, 72 in `ky` plus 57 in its partial
files, fewer elsewhere). Items 9 and 10 are among
them; the samples held too few of the rest to name a class. Worth a targeted
look in the full run.

Not a link class, but it decides what the full comparison can cover:
**Pymtheg could not index T3 Code with Node's default heap** (about 4 GB). It
ran out of memory during TypeScript analysis after 28 minutes on the whole
repository (27,468 JS/TS files) and 23 minutes on its own code (7,438 files).
CodeGraph took 15 and 7.5 minutes (12.3 and 6.3 GB peak), graphify 21 and 6.6
minutes. With the heap raised to 32 GB, Pymtheg finished T3 Code's own code in
22 minutes at 11.9 GB peak. On the whole repository it had not finished after 50 minutes. On `just` (277 Rust files) Pymtheg
took 222 s against CodeGraph's 6 s. SW-1 measures speed and memory across the
60.

Not counted as misses: CodeGraph's synthetic route nodes (`GET /search` →
`SearchArticles`) and file-level attributions that Pymtheg has from another
enclosing symbol (`same-target-other-source`).

## What Pymtheg catches that they miss

All 60 sampled links were true.

- **Fields and properties**, read and written (Go: 281 of chi's and 338 of
  cobra's Pymtheg-only links; Rust: 109 in `fd`, 645 in `just`). Neither other
  tool has field symbols for Go, and CodeGraph has few elsewhere.
- **Constants, package variables and enum variants** in values and patterns
  (`cobra` `bash_completions.go:401`, `fd` `src/patterns.rs:120`).
- **Rust impl self types, `Self` and local macros** (`just` `src/node.rs:24`,
  `src/color.rs:158`, `fd` `src/fmt/input.rs:56`), and the inherent method
  chosen over a trait method of the same name (`fd` `src/dir_entry.rs:167`).
- **Go calls through a typed local or across packages** that CodeGraph leaves
  unresolved or sends to the interface: `chi` `mux_test.go:1661`
  (`r.Delete` on `*Mux`), `middleware/middleware_test.go:42` (`chi.NewRouter`).
- **TypeScript type positions and default imports**: `as`, type arguments,
  `typeof`, `keyof`, and calls through `import ky from …` of a `const`
  (`ky` `test/retry-decisions.ts:284`, `test/request-construction.ts:24`).
- **Candidate sets instead of guesses** where two targets are possible
  (`fd` `src/output.rs:31`: two `cfg` variants of `print_entry_uncolorized`).
  The others either pick one or skip it.
- **Unresolved links with a reason.** CodeGraph keeps unresolved references
  without a reason; graphify keeps none, so a missing link and a link it never
  saw look the same.

## Where the other tools are simply wrong

- **CodeGraph links by method name across types.** `ctx.Value(…)` and
  `r.Context().Value(…)` → chi's `endpoints.Value` (`chi` `context.go:26`,
  `mux.go:71`); `ts.Close()` on an `*httptest.Server` → chi's
  `compressResponseWriter.Close` (`mux_test.go:473`); pflag's
  `FlagSet.HasFlags`/`SetOutput` → cobra's `Command` methods
  (`command.go:1807`, `doc/md_docs.go:34`); `f.Name()` on an `*os.File` →
  `Command.Name`; `std::process::Command::arg` → `just`'s `Test::arg`
  (`tests/init.rs:90`); `Name::lexeme` → `Keyword::lexeme` (confidence 0.4);
  `ReadableStreamDefaultController.close` → a test server's `close`
  (`ky` `test/response-size.ts:271`). Its confidence (0.7 to 0.9 on these) is
  not a usable filter.
- **CodeGraph calls an interface-to-implementation relation a call**
  (`Routes.Middlewares` → `Mux.Middlewares`).
- **graphify links library names to same-named project symbols**:
  `ignore::DirEntry` → `fd`'s own `DirEntry` (`src/dir_entry.rs:13`), and an
  imported `delay` (`setTimeout` from `node:timers/promises`) → an unrelated
  object-literal method `delay()` (`ky` `test/hooks.ts:218`).
- **graphify's Go imports fan out** to every file of the imported package
  (1,283 import edges in chi against 48 package imports in Pymtheg); not wrong
  as such, but not comparable.

## Recommendation

- **Run CodeGraph on all 60.** It finds most of the true Pymtheg misses
  (every class above), and it is fast on small and medium repositories. Its
  "only CodeGraph" links are leads: in Go about half are false, so each class
  needs a hand-check before it becomes a chunk. Expect up to 12 GB per run on
  a large monorepo.
- **Run graphify as well, but only because it is cheap** (seconds, under
  100 MB on the pilot except T3 Code). Its links are mostly a subset of
  CodeGraph's; on its own it found little that was new (1 to 32 links on each
  of the four small repositories, 440 in `just`, mostly the glob-import class,
  and 2,235 in T3 Code's own code).
- **Add a compiler-backed referee later** (a SCIP indexer or
  `rust-analyzer`, sandboxed with dependencies fetched and build scripts and
  proc macros off) if the owner wants "who is right" at the scale of 60
  repositories rather than by hand. That is its own chunk.
- **Reuse.** Both licences allow reuse with notices (CodeGraph MIT: keep the
  copyright and licence; graphify Apache-2.0: keep the licence and NOTICE and
  mark changes). Nothing seen is worth copying as code: both resolve by name
  and give no certainty that Pymtheg could keep. Two ideas are worth taking:
  CodeGraph stores each function's declared return type to type the receiver
  of the next call (its `nodes.return_type`), which is what Pymtheg's Rust
  module lacks for class 1; and treating an uninstalled `extends` preset as
  "use the compiler's defaults and keep resolving project files" (both other
  tools resolve those files regardless), for class 2. Both would have to keep
  Pymtheg's rule that a guess is never shown as definite.

## Reproduce

On the dev server, after installing the tools as in
[`scripts/compare/README.md`](../../scripts/compare/README.md):

```sh
pymtheg-dev --name sw2 -- node --max-old-space-size=32768 scripts/compare/run.mjs \
  --repos scripts/compare/pilot-repos.json --out "$PYM_SCRATCH/compare" \
  --tools-dir "$PYM_SCRATCH/tools" --jobs 9 --keep
node scripts/compare/show.mjs --out "$PYM_SCRATCH/compare" --repo chi --bucket others-not-pymtheg --context 2
```

The raised-heap T3 Code run added `--node-heap 32768 --timeout 7200 --only
t3code,t3code-first-party` with its own `--out`.
