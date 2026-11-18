# TP-3: prune tests that guard no behaviour (everything else)

Slice: every file in `test/` whose name does not start with `studio`, `mcp`,
`browser`, `graph`, `implementation` or `architecture`, plus the shared
`test/fixtures/` folder (read only; nothing in it changed).

Each test was read and judged against one question: does it depend on
behaviour that Pymtheg promises? It goes if it depends on the past (code that
no longer exists), on nothing (no change to the product can fail it) or on the
implementation (it changes when the code changes even though behaviour did
not), or if another test already guards the same behaviour. Where a pruned
test also covered behaviour that matters, it was rewritten against that
behaviour instead.

## Counts

| | Before | After |
| --- | ---: | ---: |
| Files in the slice | 194 | 194 |
| Unit test files (`*.test.mjs`, run by `npm test`) | 176 | 176 |
| Backend test files (`*.integration.mjs`) | 12 | 12 |
| Helpers and scripts (`bench.mjs`, `capture.mjs`, `capture-supervisor-observer.mjs`, `controlled-clock.mjs`, `process-safety.mjs`, `recovery-ack.mjs`) | 6 | 6 |
| Tests run by the unit files (as counted by `node --test`) | 747 | 744 |

744 = 747 − 4 deleted + 1 added (the storage writer-wait test, added after
review; see below). No whole file was deleted, so no fixture or helper became
unused. The backend files were read but needed no change.

## Deleted tests

| File | Test | Rule | Why |
| --- | --- | --- | --- |
| `test/contracts-1.test.mjs` | caller and branch facts discharge scalar preconditions | duplicate of `contract-candidate.test.mjs` "guarded calls stay established and definite violations retain their existing error" | Both check that `if x > 0 { call f(x); }` establishes the callee's `x > 0` precondition; the other test also checks the unguarded and literal cases. The deleted test used `Int`, the survivor `Nat`, so after review the survivor now runs for both (see Rewritten tests). |
| `test/core.test.mjs` | a newly added error variant breaks a previously exhaustive source consumer | duplicate of `core.test.mjs` "outcome addition breaks consumer and valid propagation remains valid" | Both check that a `match` missing one error variant is reported as C002; the kept test also checks valid propagation and an unknown variant. The deleted test also showed that a complete `match` passes cleanly. That half is guarded by `core.test.mjs` "file success/error exits and cleanup correction" (the corrected `match` exits 0) and by `flow.test.mjs` "tagged outcomes and nested calls share source semantics" (a complete `match` type-checks with no errors). Those are the survivors. |
| `test/initial-domain.test.mjs` | initial constant comparison and event replay use the same scalar evaluator | implementation | It calls the evaluator directly to pin which helper both paths use. After review, the first test in the same file now checks the behaviour it stood for: the machine lowered from `= 3 - 1` starts at 2 (see Rewritten tests). |
| `test/storage-boundary.test.mjs` | SQLite connection constructors and runtime imports stay inside the storage boundary | implementation | It read `src/` text and failed when code outside `src/storage/` opened SQLite directly (the rule in `docs/support.md`, "All features open their SQLite databases through one storage boundary", and `docs/decisions.md`). The behaviour that rule protects is the 30-second writer wait `openDatabase` applies (`src/storage/local.ts`). The added behaviour test "every project database that waits for writers keeps the 30-second lock wait" now replaces it. Where stores live and how paths are refused stay checked by "initialization and all project stores use only .pymtheg" and "path reads create nothing and reject symlink directories and database sidecars". |

## Rewritten tests

| File | Old name → new name | Rule | Why, and what it now checks |
| --- | --- | --- | --- |
| `test/r1a-builtin-only.test.mjs` | the removed external-engine options are unknown → an unknown option is refused by name with exit 3 | past | It asserted that three options from removed engines (`--backend`, `--tlc-jar`, `--quint`) stay gone. Now it checks the behaviour users rely on: any unknown option is refused with exit 3 and named in the message. No other test covered this. |
| `test/emit.test.mjs` | emit names its one target instead of accepting the removed Quint target → emit refuses a target other than json and names the one it accepts | past | Same assertions, but with a neutral unsupported target (`xml`) instead of the removed Quint target. |
| `test/evidence-retention.test.mjs` | historical evidence keeps only needed target rows and still identifies changed contracts → evidence reviewed at many historical revisions is stale only where its target changed | implementation | It replaced `Map.prototype.set` and read the call stack for the name `StudioService.architectureWork` to count rows held in private maps. A rename or a different container would fail it, and a regression that held rows elsewhere would pass. It now checks only the result: of eight plans reviewed at eight earlier revisions, only the one whose type changed is stale evidence. |
| `test/impact-membership.test.mjs` | planning-heavy impact preserves every consumer without quadratic membership scans → planning-heavy impact lists every consumer exactly once | implementation | It replaced `Array.prototype.includes` to count lookups, which only sees that one helper (a slow loop or `indexOf` would pass). It now checks the result for 2,000 plans: every consumer listed, none twice, and no direct or transitive impact. |
| `test/output-layout.test.mjs` | large inline cycles use bounded graph work, without recursive host traversal → a ten-thousand-type inline cycle gets indirection on every edge without overflowing the stack | implementation | It asserted a `measurements` field that only repeated the input sizes (declarations and edges), so it measured no work. It now checks that the layout is marked recursive, plus the existing check that every edge of the 10,000-type cycle needs indirection. |
| `test/initial-domain.test.mjs` | out-of-range starting constants are located local design errors and block lowering (name unchanged) | review: lost guard | Added one assertion: the machine lowered from `state count: Int in 1..2 = 3 - 1` starts at the literal `2n`. Before, a wrong computed start value that stayed in range (1) passed. |
| `test/contract-candidate.test.mjs` | guarded calls stay established and definite violations retain their existing error (name unchanged) | review: lost guard | The guarded-call check now runs for both `Nat` and `Int` inputs, covering the signed input the deleted `contracts-1` test had. |
| `test/core.test.mjs` | alpha copies detected while different resolved rules and shared references stay distinct (name unchanged) | nothing | Removed `measurements.rulePairComparisons === 0`: the product always sets that value to a hard-coded 0, so it measures no work. The field stays, because it is part of the report output and `test/bench.mjs` reads it. |
| `test/format.test.mjs` | format preserves every token and comment and is idempotent across the language examples → shipped examples are already formatter-canonical and formatting is idempotent | nothing | Once the test establishes that formatted text equals the source, comparing their tokens and comments cannot fail. Those two comparisons are removed. Token and comment preservation on text that does change stays in the other tests in this file. |
| `test/package-contents.test.mjs` | the private-name patterns load from a file given by path and fire as written → the private-name scanner reads patterns from a file and reports lines, not text | nothing | It exercised only the test's own scanner on many synthetic inputs. Kept as one compact self-test next to the release check it supports, so that check cannot pass by matching nothing. The cases: a hit reported by line, not text; a case-insensitive (`/i`) pattern firing on mixed case; a case-sensitive pattern ignoring the lower-case word; an unreadable pattern file failing loudly; a missing pattern file meaning no patterns. |
| `test/package-contents.test.mjs` | the private network rules fire on each private form and allow public, loopback and documentation forms → the private network scanner fires on each rule and allows public forms | nothing | As above: one compact self-test next to the network release check. It fires for each rule: private IPv4 in both the `10/8` and `192.168/16` ranges, a text host name, devserver, a host in minified code, a first-party dist string, and a host after an interpolation in a first-party template literal. Four forms are allowed: loopback, documentation and version numbers; public addresses next to the private ranges (`172.32.0.1`); a member access in minified code; and an interpolation in first-party code. |
| `test/package-contents.test.mjs` | the owner's name is allowed only in licence texts and package.json's top-level author → the personal scanner allows only the top-level author and flags paths | nothing | As above: one compact self-test next to the personal release check. It covers the allowed author line, a top-level `author` object with a nested `name`, two duplicated top-level `author` keys (both the same value, and a later value overriding the first), the name in code and a home path. |

## Added test (after review)

| File | Test | Why |
| --- | --- | --- |
| `test/storage-boundary.test.mjs` | every project database that waits for writers keeps the 30-second lock wait | Replaces the deleted source scan with the behaviour it protected. It opens each store through the product's own entry point and reads `PRAGMA busy_timeout` on that connection, which must be 30000, not 0. The stores are the planning store (`ArchitectureStore.open`), the graph store (`openProjectGraph`) and the recent-run cache (`RecoveryStore.openOrCreate`). Concurrent writers rely on the wait; without it a second writer fails at once with "database is locked". The test reads each store's connection field directly, which the manager allowed. There are no sleeps or timing assertions. |

Every `openDatabase` caller in `src/`, and how the test treats it:

| Caller | Database | Covered |
| --- | --- | --- |
| `src/architecture/store.ts` | planning store (`.pymtheg/shared/`) | yes |
| `src/graph/store.ts` | code graph cache (`.pymtheg/rebuildable/`) | yes |
| `src/studio/recovery.ts` (`runs`) | recent-run cache (`.pymtheg/rebuildable/`) | yes |
| `src/studio/recovery.ts` (drafts) | unsaved-draft recovery store | no wait to guard: right after opening, the product itself sets `PRAGMA busy_timeout=0` on this connection (stale writers are refused through its revision check). A direct open would give the same 0, so no wait test can tell the two apart. |
| `src/project/doctor.ts` | in-memory probe (`:memory:`) | not a project database |

## Mutation checks (after review)

Each new assertion was run in a scratch copy on the dev server with the
reviewer's mutation applied:

| Point | Mutation | Result |
| --- | --- | --- |
| 1 | Integer subtraction returns its right operand (`src/shared/operators.ts`). | `initial-domain` fails: start value `1n`, expected `2n`. |
| 2 | Each store bypasses `openDatabase`: the graph store opens `DatabaseSync` directly (the second reviewer's mutation, `src/graph/store.ts`); the run cache does the same (`src/studio/recovery.ts`); the planning store opens with `timeout: 0` (`src/architecture/store.ts`). Each was run separately. | The new storage test fails under each one: `timeout: 0`, expected `30000`. |
| 3 | `>` refinement does nothing for an input without a lower bound, so `Int` inputs are not refined (`src/analysis/facts.ts`). | `contract-candidate` fails for `Int`: a C006 finding appears. The `Nat` case still passes, as the reviewer found. This mutation causes type errors, but `tsc` still emits the JavaScript the test runs. |

## Production code removed

| File | What | Why |
| --- | --- | --- |
| `src/contracts/layout.ts` | the `measurements` field returned by `recursiveLayout` | Only the old `output-layout.test.mjs` assertion read it; a search of `src/`, `web/` and `test/` found no other user. |

## Kept but doubtful

These stay because they guard something real, but they are not plain
behaviour tests. The manager may decide otherwise.

- `test/shipped-docs-names.test.mjs`, "every MCP tool a shipped doc names is in
  tools/list": its last assertions test the test's own name-matcher on sample
  sentences, so the doc check cannot pass by matching nothing.
- `test/contracts-regeneration.integration.mjs`, "unavailableReason names the
  spawned tool and the missing crate": tests a helper in the test file that
  decides when a missing compiler is a skip rather than a failure.
- `test/grammar-vendored.test.mjs`, "every vendored language has a sample only
  its vendored build reads": checks the test's own sample table covers every
  vendored grammar, so a new grammar cannot pass the load test unchecked.
- `test/r1h-packaging.test.mjs`, "node:sqlite is loaded lazily, never by a
  static import in src": a source-text scan. The warning it prevents only
  prints on Node 24.0 and 25.2, so a behaviour test (no warning on stderr)
  would pass vacuously on the Node versions the suite normally runs on
  (24.21 on the dev server).
- `test/identity-rename.test.mjs`: swaps the CLI name and file suffix at run
  time and checks every consumer follows. It guards an internal "one
  definition" rule recorded in `docs/decisions.md` (Provisional names), not
  user behaviour, and the name is now released.
- `test/self-authoring.test.mjs`: compares an example self-model's cost answers
  with product constants (`guidedShapeLimits`), so it changes when those
  constants change.
- `test/unsaved-buffers.test.mjs`, "matching ten thousand cached sources does
  one path-index pass, independent of computer speed": counts exact reads of
  each input's `path` property. That is a work bound, but an exact one.
- `test/flow-lowering-pure.test.mjs`: the "leaves the IR unchanged" and "does
  not change its plan or graph" tests check that lowering does not mutate its
  inputs. They describe how the code behaves rather than what users see, but a
  mutation would cause real wrong answers later.
- `test/branch-ack.test.mjs` and `test/branch-v6-readonly.test.mjs` use a
  personal first name as a sample reviewer. That is not a pruning question,
  but it may matter under the rule that Git content is public.

## Possible duplicates in other slices

None found with confidence. The `block-*` tests drive the block document model
directly. Studio tests in the other slices may cover some of the same
edits through the browser or HTTP API, but that was not checked line by line.

## Checks

Run on the dev server with `pymtheg-dev` (Node 24.21.0):

- `npm run build`: passed.
- `npx tsc --noEmit -p .`: passed.
- All 176 unit test files in this slice: 743 tests, 743 passed.
- Backend files (`*.integration.mjs`) were not run: none was changed.
- Full `npm test` (all slices): 2919 tests, 2919 passed.
- Prettier check on the changed files: passed.

The figures above are from the first round. After review, only the touched files
were rerun (as the manager asked):

- `npx tsc --noEmit -p .`: passed.
- `contract-candidate`, `core`, `format`, `initial-domain`, `package-contents`
  and `storage-boundary` tests: 51 tests, 51 passed.
- Prettier check on the changed test files: passed.
- Mutation checks: see the table above.

After the second review, `npx tsc --noEmit -p .` passed and
`storage-boundary` passed 7 of 7. Prettier passed on the test file.
