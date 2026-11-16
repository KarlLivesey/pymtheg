# W2-Z: fold the documentation fragments

Build-plan Rule 5. Documentation only: no source, test, build-plan, mega-plan or
per-chunk change note was edited. Base: `origin/main` at `8e63a009`, then
`origin/main` at `93ffca8e` merged in round 1 and at `27a4de90` in round 2.
Folded: the merged chunks in the build-plan ledger (W0-2, W1-A–F, W2-A–L, W2-B2,
W2-C2, W2-K2, W2-M, W2-P, W2-Q, W2-S, W2-T, W2-U). Chunks still open (W2-C3, W2-V)
are not described.

Every added claim was checked against the code on this base or by running the
built tool (`npm ci --ignore-scripts && npm run build`). Probe outputs are in
`evidence/w2-z/`; absolute paths there are replaced by `<repo>` and `<scratch>`.

## Changes by document

### `docs/support.md`

- New section **Rebuild state: engines, storage and code graph** before
  "Architecture and interactive authoring", with subsections: built-in engines,
  `check` notices, project storage (layout, old-layout refusal, stable IDs and
  recorded history), document import, code graph (link outcomes, whole-file rule,
  internal errors, Go, Rust, TypeScript/JavaScript, not built yet).
- Matrix rows for flows, machines, MCP and Studio: engines named per surface (CLI
  built-in; MCP and Studio still TLC/Quint). "three durable runs" -> "three cached
  runs" (the run cache is rebuildable).
- Behaviour paragraph: the built-in search and sampler named beside TLC and Quint.
- `.pymtheg.json` -> `.pymtheg/settings.json` (source policy).
- num-bigint 0.4.6 -> 0.4.8.

### `docs/decisions.md`

- New section **Rebuild plan decisions (10–13 November 2026)**: built-in engines
  as CLI default (D2, in progress); single project folder (D5–D7); stable global
  IDs and recorded history, including the ruling that a key reappearing after
  removal gets a new UUID with a `previous` reference; a link's baseline is not a
  review (W2-H); D16; unreadable code is failed, the unit is the file (with the
  cause, propagation, certainty and internal-error rulings); candidate-set
  completeness (closed/open) and the "right for code that compiles" ruling; D17;
  D18 with its context and follow-up; E4 with its clarification and extension;
  own builds of tree-sitter grammars.
- Superseded notes added in place, not rewritten: `.pymtheg.json` location
  (line ~192), `.pymtheg-studio/` location (~259), "New links use the supplied
  source revision" (~542, per W2-H's own instruction), num-bigint version (~784).

### `docs/runtime-map.md`

- Component table: six rows (built-in engines, storage boundary, recorded history,
  graph core, language modules, vendored grammars); adapter row names the default
  built-in path.
- Lifecycle: built-in engine worker states.
- `.pymtheg-studio/` recovery paragraph -> the two databases under `.pymtheg/`.
- Linked-title review paragraph: `linkComparisonBase` order (W2-H; build-plan
  backlog item for `runtime-map.md:459`).
- New closing section **Rebuild components (merged through W2-U)**.

### `docs/project-init.md`

- `init` creates `.pymtheg/settings.json`, not `.pymtheg.json`.
- Local state and sharing: what `init` creates, a layout table (commit / shared /
  local / rebuildable), old-layout refusal (which commands refuse, which do not).

### `docs/studio.md`

- Recovery paragraph: drafts in `.pymtheg/shared/drafts.sqlite`, runs in
  `.pymtheg/rebuildable/runs.sqlite`, damaged run cache behaviour.
- Planning database: `.pymtheg/shared/architecture.sqlite`.

### `docs/output-plugins.md`

- num-bigint 0.4.6 -> 0.4.8.

### `README.md`

- False statements fixed only: the behavioural-exploration paragraph said
  `simulate`/`verify` translate to Quint/TLC; on `main` the CLI default is the
  built-in engines. Added the built-in `verify` example; the TLC instructions are
  now "to check with TLC instead"; Quint's version check applies "when selected".

## Sources for added claims

| Claim                                                                                                                                                                                                      | Source                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI `verify`/`simulate` default built-in; `--backend builtin\|tlc\|quint`                                                                                                                                  | `src/cli/main.ts:830-832`; `src/backends/adapter.ts:662`; `evidence/w2-z/cli-probe.txt`                                                                       |
| Per-invariant results, shortest trace, budget -> inconclusive, exit 2, `B108`, limit named                                                                                                                 | `evidence/w2-z/cli-probe.txt` (`two.pym`, `--state-budget 2`); `src/backends/adapter.ts:203-212`                                                              |
| Engine error same exit as budget run                                                                                                                                                                       | `src/backends/adapter.ts:210` (inconclusive like the budget case); build-plan W2-A review backlog                                                             |
| Sampler result `no_counterexample (simulation, complete)`; seed format                                                                                                                                     | `evidence/w2-z/cli-probe.txt`                                                                                                                                 |
| MCP and Studio still TLC/Quint                                                                                                                                                                             | `src/mcp/workspace.ts:185`; `src/studio/service.ts:3445`                                                                                                      |
| Worker lifecycle, timer before readiness, termination awaited                                                                                                                                              | `src/behaviour/explore-runner.ts:63-104`                                                                                                                      |
| `BEHAVIOUR NOT CHECKED` notice and Nat hint wording                                                                                                                                                        | `evidence/w2-z/cli-probe.txt` (`m.pym`, `ok.pym`); text-only / JSON scope from `docs/changes/W2-F.md` and `test/hints.test.mjs`                               |
| `.pymtheg/` layout                                                                                                                                                                                         | `src/storage/layout.ts`; `evidence/w2-z/init-layout-probe.txt`                                                                                                |
| `.pymtheg/.gitignore` ignores `shared/` and `rebuildable/`; `rebuildable/` and `local/` ignore themselves                                                                                                  | `src/project/workspace.ts:117-121`; `src/storage/local.ts:75-82`; `src/storage/writer.ts:34`                                                                  |
| Old-layout list and message                                                                                                                                                                                | `src/storage/local.ts:9-31`                                                                                                                                   |
| Refusing: `init`, `import-architecture`, `check --check-scope related\|project`, `--scenario`; working: file-scope `check`/`verify`/`simulate`/`emit`, `observe --list`, `fmt`, `doctor`; no files written | `evidence/w2-z/old-layout-probe.txt`                                                                                                                          |
| Refusing: `studio`, `mcp`, `scaffold`, `observe` captures                                                                                                                                                  | `docs/changes/W2-E.md`; path through `storagePath()` -> `assertCurrentLayout()` (`src/storage/local.ts:48-53`); not run by me (see "Not verified")            |
| Discovery stops at `.pymtheg/` or `.git`                                                                                                                                                                   | `src/storage/local.ts:34-46`                                                                                                                                  |
| Run cache: three runs, warning naming the path                                                                                                                                                             | `src/studio/recovery.ts:267,288,369`                                                                                                                          |
| UUID registrations, receipts, ordering, writer file                                                                                                                                                        | `src/storage/recorded-history.ts`, `src/storage/writer.ts`, `src/architecture/store.ts:3-8,85`; `test/storage-identity.test.mjs`; `docs/changes/W2-E2.md`     |
| Single-file and `.rst` import from the CLI; no include/exclude option                                                                                                                                      | `evidence/w2-z/import-probe.txt`; `grep -n -- --include src/cli/main.ts` (no match)                                                                           |
| Graph not used by any command; `openProjectGraph` path                                                                                                                                                     | only `src/storage/graph.ts` imports the graph outside `src/graph/`; `src/storage/layout.ts`                                                                   |
| `observe` still the old TypeScript/JavaScript reader                                                                                                                                                       | `evidence/w2-z/old-layout-probe.txt` (`observe ok.pym` message)                                                                                               |
| Schema 3, rebuild message                                                                                                                                                                                  | `src/graph/store.ts:44-50`                                                                                                                                    |
| Discovered modules and versions (`go@23`, `rust@23` after the round-1 merge; `rust@20` before, `typescript@16`), toy not offered                                                                           | `evidence/w2-z/graph-probe.txt`                                                                                                                               |
| Claims and context files per module                                                                                                                                                                        | `src/graph/languages/go/index.ts:286-293`; `rust/index.ts:13-14`; `typescript/index.ts:522-523`, `typescript/project.ts:436-439`                              |
| Whole-file rule, `invalid-code` with `data.cause` (Go/TS `reason`, Rust `uncertainty`), TS `no-unseen-declarations`                                                                                        | `evidence/w2-z/graph-probe.txt` ("broken" fixtures)                                                                                                           |
| Go: definite import/call/receiver; build-variant candidates; open interface dispatch; `implements` unresolved `structural-match-unverified`; stdlib unresolved                                             | `evidence/w2-z/graph-probe.txt`                                                                                                                               |
| Rust: `A::new` definite; written `impl Tr for A` definite; dot calls unresolved with would-be targets and reasons; first-probe definite (`p4(a: &A)`, annotated `let`); unannotated `let` not typed        | `evidence/w2-z/graph-probe.txt` (three `lib.rs` versions in `graph-fixtures/shapes/rs/src/`)                                                                  |
| TS: union receiver candidates; `node:fs` `external-package`                                                                                                                                                | `evidence/w2-z/graph-probe.txt`                                                                                                                               |
| (superseded by W2-M) ~~Failed files parsed again every index~~: now a content failure from `parse` is stored and not re-parsed while hash, module and version match; operational failures are retried      | was `src/graph/indexer.ts:189-195` before the round-2 merge; now `src/graph/indexer.ts:185-205`, `src/graph/store.ts:180-191`                                 |
| TS internal errors `failureKind: "transient"` and wording                                                                                                                                                  | `src/graph/languages/typescript/index.ts:298-306`; `test/graph-typescript-crash.test.mjs`                                                                     |
| Go grammar vendored, patches, sha256 test                                                                                                                                                                  | `grammars/README.md`, `grammars/go/manifest.json`, `src/graph/languages/go/index.ts:23-28`, `test/grammar-vendored.test.mjs`                                  |
| Go remaining gaps (`{; G() }`, chunk boundary)                                                                                                                                                             | `test/graph-go-grammar.test.mjs`; `docs/changes/W2-S.md`                                                                                                      |
| Rust grammar npm 0.24.0, gaps list                                                                                                                                                                         | `src/graph/languages/rust/parse.ts:272`; `docs/changes/W0-2.md`; `docs/changes/W2-P.md`; build-plan grammar-gap note                                          |
| (round 0, superseded by W2-C2) E4 on `main` was `derive`/`global_allocator` only                                                                                                                           | `src/graph/languages/rust/parse.ts:186`; `grep -n println src/graph/languages/rust/*.ts` (no match); known-limit test file `test/graph-rust-round12.test.mjs` |
| Walker skips `.codegraph`                                                                                                                                                                                  | `src/graph/indexer.ts:88`                                                                                                                                     |
| num-bigint 0.4.8                                                                                                                                                                                           | `test/fixtures/rust-rich/Cargo.toml:6`, `Cargo.lock`                                                                                                          |
| Decisions D16, D17, D18, whole-file rule, candidate-set rule, E4 + extension, grammar route, stable-ID ruling, compile-correctness ruling                                                                  | `docs/build-plan.md` section 10 notes (quoted); the mega plan (kept privately), section 2                                                                                |
| Per-module definite/candidate/limit lists not exercised by the probe                                                                                                                                       | the module's change note (`W2-B.md`, `W2-B2.md`, `W2-C.md`, `W2-D.md`, `W2-S.md`, `W2-U.md`), cited at the end of each subsection                             |

## Superseded statements in per-chunk notes (left as written)

- `W1-C.md:277`: "failed parses are retried" is superseded by W2-M's content-failure
  cache: a returned content failure from `parse` is stored and not re-parsed while
  hash, module and version match (operational failures are still retried).
- `W2-I.md:93`: "existing failed-file retries … remain mandatory" is superseded the
  same way (W2-M).
- `W1-C.md`: partial files whose recovered symbols are legal targets, and
  "partials can be cached"; superseded for the three production modules by the
  whole-file rule (Go and Rust have no `partial`; TypeScript `partial` means
  qualified facts, never a syntax error). Graph "schema version 2" is now 3
  (W2-I). The backlog about grammar `.wasm` files in a language folder is solved
  by top-level `grammars/` (W2-S).
- `W2-B.md`: "parsing uses the installed `tree-sitter-go` 0.25.0 WASM grammar"
  and "a user-declared `new` called with a non-type argument misparses, and the
  file fails" are superseded by the vendored grammar (W2-S). Module version is 23.
- `W2-C.md`: "Version 12"; the module is now version 23 (W2-C2). Its "General
  cross-file macro_rules resolution" backlog is partly done: child files inherit
  their parent's textual macros (W2-C2).
- `W2-D.md`: module version "now 12"; it is 16. Its statement that an internal
  extraction exception is an ordinary failed result is superseded by W2-U.
- `W2-A.md`: Studio wiring line `src/studio/service.ts:3392` is now line 3445
  (still not switched).
- `W2-E.md`: "All of 3.3 remains deferred" is partly superseded by W2-E2.
  Its listed old wording in `src/reporting/explain.ts:54` is already fixed on
  `main` (it names `.pymtheg/settings.json`).
- The mega plan's (since kept privately) Stage 4 "Libraries (… installed through npm, nothing to
  compile)" is no longer true for Go (vendored, built by Pymtheg; still nothing to
  compile at install). The mega-plan line on rust-analyzer is superseded by D16
  (recorded in `decisions.md`).

## Found false outside my owned paths (not edited)

- The architecture workspace plan (since kept privately): "The local `.pymtheg-architecture/`
  database"; now `.pymtheg/shared/architecture.sqlite`.
- `docs/seventh-review-work.md:12`: "`.pymtheg.json` accepts `sources.include`";
  now `.pymtheg/settings.json`. Both are historical documents; a one-line
  "superseded" note would do.
- The mega plan's Stage 4 libraries line (above).
- `pymtheg doctor` still reports Quint, Java and TLC readiness and says "Set
  PYM_TLC_JAR", which is accurate for MCP and Studio but reads as required; it
  changes with the TLC/Quint removal chunk.

## Not verified (left out or stated only as the chunk note's claim)

- `studio`, `mcp`, `scaffold` and `observe` captures refusing an old layout: stated
  from W2-E and the shared `storagePath()` check; I did not run them.
- Toolchain-route measurements (W2-K, W2-L percentages) are not restated in the
  shared documents; only the decisions they led to are.
- Corpus figures (Vector 11 failed files, 11,730 links for E4, restic numbers)
  are quoted from the build plan and change notes, not re-measured.
- Per-module behaviour the probe did not exercise (for example Go `replace`
  handling, Rust cfg comparison, TypeScript tied configs and workspaces) is
  summarised from the module's change note.

## Will be stale again when open pull requests merge

- **W2-C3, W2-V** (started per the ledger, no PR described here): any further
  Rust or other module change makes the module versions and the Rust "Macros"
  bullet stale.
- A later fix for links into a file that failed internally (W2-U further work)
  makes the `support.md` "unresolved with no reason" sentence stale.
- The TLC/Quint removal chunk (Wave 3) will make the engine rows, README TLC
  section, `runtime-map.md` adapter and lifecycle text, and the D2 entry stale.

## Round 1 review fixes

Reviewer findings (PR 30 round 1), each re-verified by my own run:

1. **Non-builtin attributes** (`support.md` Rust): the old "not definite: anything
   under a non-builtin attribute" was false. Now: a link whose target is an item
   under, or inside an item with, a non-builtin attribute is withheld, and so are
   `use` and `mod` under one; links written inside such an item resolve as
   written. Run: `evidence/w2-z/round1-attribute-probe.txt` (inside
   `#[tokio::main] fn f`, `helper()`, `m::g()` and `a.own()` resolve; a call of
   `#[my::attr] fn hidden`, `#[my::attr] use m::g as g2` and `#[my::attr] mod gm;`
   are `item-under-opaque-attribute`). Code: `src/graph/languages/rust/resolve.ts`
   (`itemPresence`).
2. **Parameter attributes** (`support.md` Rust grammar): a single attribute on a
   function or method parameter parses; two or more on one parameter, or one on a
   closure parameter, fail the file. Run: same probe (`two.rs`, `clos.rs` failed;
   `params`, `S::meth` read). Matches `docs/changes/W2-P.md:59`.
3. **Go chunk boundary** (`support.md` Go): applies to a non-BMP character in an
   identifier. Run: `evidence/w2-z/round1-go-chunk-boundary-probe.txt` — with
   U+1D465 starting at UTF-16 offset 5118 (straddling the first 5,119-unit
   chunk), the identifier file fails and the comment and string files are read.
   (At offsets 5117, 5119 and 5120 the identifier file is read.)
4. **D16 quotation** (`decisions.md`): the quoted text was the mega-plan's D16
   row, not Karl's recorded words. Quotation marks removed and the text cited as
   the mega-plan entry. Every quotation in the section was then checked against
   `docs/build-plan.md` (`evidence/w2-z/round1-quote-audit.txt`): only text the
   build plan shows in quotation marks is quoted; also removed: "unreadable code
   is invalid code…" (unquoted in the build plan), "I trust this project enough
   to build it" (mega-plan row), the rust-analyzer line; "Probably this,
   unverified" is now cited as the build plan's words with its exact casing.
5. **Owner/manager attribution** (`decisions.md`): every ruling under the
   whole-file entry now names its author and round (cause propagation: manager,
   W2-B round 14; certain causes only: manager, W2-B round 16; TypeScript
   `no-unseen-declarations`: manager, ruling on W2-D; surface wording: manager,
   W2-C round 6; internal errors: W2-U, cut by the manager). Rechecked every
   entry: D2/D5–D7 now separate Karl's decision from the chunk's implementation;
   D16's consequences, D17's "why", D18's systems-idiom reading and the D18
   lesson are labelled manager; the candidate-set rule and grammar route are
   labelled manager; E4 says the build plan names no author (W2-C's note calls it
   owner-selected) and its extension is the manager's.
6. **Small:** `decisions.md` heading-identities passage marked superseded (the name
   is now a logical document key inside the planning database:
   `src/architecture/heading-identities.ts:50`). `support.md` adds that an
   annotated `let b: A = A; b.r()` (`&self` method) stays unresolved
   (`later-probe-step`; same probe).
7. **Merged `origin/main`** (`93ffca8e`, normal merge). Newly merged since the
   first base: W2-C2 (PR 22). Folded, verified by
   `evidence/w2-z/round1-rust-macro-probe.txt` and the code: Rust module version
   23 (`src/graph/languages/rust/index.ts:12`); a `println!` statement no longer
   withholds links while an unknown macro statement (`tracing::info!`) does
   (corrected in rounds 2 and 3: only in the block the macro is a direct child
   of, as a statement or the block's tail);
   a child file resolves a macro from its parent's `#[macro_use] mod macros;`;
   macro arguments get no links. The twenty standard macro names and the extended
   E4 known limit are from `docs/changes/W2-C2.md` (names) and its tests
   (`test/graph-rust-macro-recall*.test.mjs`). The E4 decision entry's "open pull
   request" parenthesis is removed. PRs 28 and 29 were already covered.

## Round 2 review fixes

1. **Unknown macros** (`support.md` Rust "Macros"; this note's round-1 item 7):
   "a function body that invokes an unknown macro withholds the links in it"
   overstated it. An unknown macro invoked as a statement withholds the links in
   its enclosing block (`opaque-item-may-shadow-name`); one used as an expression
   withholds nothing. (Round 3 corrects this further: a macro in a block's tail
   position also withholds; see below.) Run: `evidence/w2-z/round2-macro-position-probe.txt`
   (inner-block statement: the two calls outside the inner block resolve, the one
   inside is withheld; `let _x = m!();` and `helper() + m!()`: all calls resolve).
2. **Chunk boundary** (`support.md` Go): "first" dropped. Run: an identifier
   straddling the second boundary (offset 10,237) also fails the file
   (appended to `round1-go-chunk-boundary-probe.txt`).
3. **Merged `origin/main`** (`27a4de90`, normal merge): W2-M (PR 23) and W2-T
   (PR 27) folded.
   - W2-M, verified by `evidence/w2-z/round2-failure-cache-probe.txt` (each broken
     fixture indexed twice with the store reopened: Go and Rust `indexed 0` on the
     second run, TypeScript `indexed 1`; `failedFiles()` output) and the code:
     `src/graph/indexer.ts:185-205` (cache check, `cacheableFailures` only from
     `parse`), `:296-303` (analysis failures never marked), `:334`
     (`structuredClone` for `resolve`); `src/graph/store.ts:54`
     (`graph_parse_failures`), `:180-191` (`isParseFailure` joins hash, module,
     version and content kind), `:193-210` (`failedFiles()`), `:424,430` (per-link
     comparison). Added to `support.md` (failure caching and the broken-file
     report), `runtime-map.md` (graph indexing) and `decisions.md` (a ruling under
     the whole-file entry); "Failed files are parsed again on every index" removed.
   - W2-T, verified against `test/process-safety.mjs` (60-second `within` budget
     reporting unresolved evidence; `/proc/<pid>/stat`),
     `test/implementation-process.test.mjs:168` and
     `test/capture-supervisor-observer.mjs` (preload and Unix socket). Added to
     the `support.md` correctness-tests paragraph. No production behaviour
     changed, so nothing else was folded.

## Round 3 review fixes

1. **Unknown macros** (`support.md` Rust "Macros"): round 2's "one used as an
   expression withholds nothing" was false for a macro in a block's tail
   position. `src/graph/languages/rust/parse.ts:1128-1129` makes any
   `macro_invocation` that is a direct child of a block opaque. Now stated
   exactly, each shape probed on main (`evidence/w2-z/round3-macro-position-probe.txt`,
   input in `round3-fixtures/rust-macro-positions/`):
   - statement `m!();` and `m! { x }`, block tail `{ helper(); m!() }`,
     `if c { helper(); bail!("x") }` and a function ending in `json!({…})`:
     `helper()` in that block is `opaque-item-may-shadow-name`, as are calls in a
     nested block and a closure inside it; the `helper()` after the `if` block
     resolves;
   - `crate::helper()`, `self::helper()`, `crate::m::g()`, `Self::new()` and
     `super::helper()` resolve beside `m!();`; `A::new()` is withheld;
   - `let _x = m!();`, `helper() + m!()`, `Some(m!())` and a match arm value
     withhold nothing.
     The text says the tail case is conservative (rustc reads a tail macro as an
     expression, which cannot define an item): links lost, never wrong.
2. **Sources table** (this note): the "Failed files parsed again every index" row
   is marked superseded by W2-M. A grep of this note and the eight folded
   documents for the old retry-all wording (`parsed again`, `re-parse`,
   `previously failed`, `failed parses are retried`, `ignores the field`,
   `unless their last result failed`) finds only statements of the new behaviour
   and the superseded-note entries for `W1-C.md:277` and `W2-I.md:93`.

## Checks

See `evidence/w2-z/checks.md`.
