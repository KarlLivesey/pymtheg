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
| Tests run by the unit files (as counted by `node --test`) | 747 | 743 |

No whole file was deleted, so no fixture or helper became unused. The backend
files were read but needed no change.

## Deleted tests

| File | Test | Rule | Why |
| --- | --- | --- | --- |
| `test/contracts-1.test.mjs` | caller and branch facts discharge scalar preconditions | duplicate of `contract-candidate.test.mjs` "guarded calls stay established and definite violations retain their existing error" | Both check that `if x > 0 { call f(x); }` establishes the callee's `x > 0` precondition; the other test also checks the unguarded and literal cases. |
| `test/core.test.mjs` | a newly added error variant breaks a previously exhaustive source consumer | duplicate of `core.test.mjs` "outcome addition breaks consumer and valid propagation remains valid" | Both check that a `match` missing one error variant is reported as C002; the kept test also checks valid propagation and an unknown variant. |
| `test/initial-domain.test.mjs` | initial constant comparison and event replay use the same scalar evaluator | implementation | It calls the evaluator directly to pin which helper both paths use. The behaviour (a `3 - 1` start value is accepted in `1..2`) is already checked by the first test in the same file. |
| `test/storage-boundary.test.mjs` | SQLite connection constructors and runtime imports stay inside the storage boundary | implementation | It reads `src/` text and fails whenever a module moves, whatever the behaviour. Where stores live and how paths are refused are checked by "initialization and all project stores use only .pymtheg" and "path reads create nothing and reject symlink directories and database sidecars". |

## Rewritten tests

| File | Old name → new name | Rule | Why, and what it now checks |
| --- | --- | --- | --- |
| `test/r1a-builtin-only.test.mjs` | the removed external-engine options are unknown → an unknown option is refused by name with exit 3 | past | It asserted that three options from removed engines (`--backend`, `--tlc-jar`, `--quint`) stay gone. Now it checks the behaviour users rely on: any unknown option is refused with exit 3 and named in the message. No other test covered this. |
| `test/emit.test.mjs` | emit names its one target instead of accepting the removed Quint target → emit refuses a target other than json and names the one it accepts | past | Same assertions, but with a neutral unsupported target (`xml`) instead of the removed Quint target. |
| `test/evidence-retention.test.mjs` | historical evidence keeps only needed target rows and still identifies changed contracts → evidence reviewed at many historical revisions is stale only where its target changed | implementation | It replaced `Map.prototype.set` and read the call stack for the name `StudioService.architectureWork` to count rows held in private maps. A rename or a different container would fail it, and a regression that held rows elsewhere would pass. It now checks only the result: of eight plans reviewed at eight earlier revisions, only the one whose type changed is stale evidence. |
| `test/impact-membership.test.mjs` | planning-heavy impact preserves every consumer without quadratic membership scans → planning-heavy impact lists every consumer exactly once | implementation | It replaced `Array.prototype.includes` to count lookups, which only sees that one helper (a slow loop or `indexOf` would pass). It now checks the result for 2,000 plans: every consumer listed, none twice, and no direct or transitive impact. |
| `test/output-layout.test.mjs` | large inline cycles use bounded graph work, without recursive host traversal → a ten-thousand-type inline cycle gets indirection on every edge without overflowing the stack | implementation | It asserted a `measurements` field that only repeated the input sizes (declarations and edges), so it measured no work. It now checks that the layout is marked recursive, plus the existing check that every edge of the 10,000-type cycle needs indirection. |

## Production code removed

| File | What | Why |
| --- | --- | --- |
| `src/contracts/layout.ts` | the `measurements` field returned by `recursiveLayout` | Only the old `output-layout.test.mjs` assertion read it; a search of `src/`, `web/` and `test/` found no other user. |

## Kept but doubtful

These stay because they guard something real, but they are not plain
behaviour tests. The manager may decide otherwise.

- `test/package-contents.test.mjs`: "the private-name patterns load from a
  file given by path and fire as written", "the private network rules fire on
  each private form and allow public, loopback and documentation forms" and
  "the owner's name is allowed only in licence texts and package.json's
  top-level author". They test the scanners in the test file, not the product.
  No product change can fail them, but they stop the release-safety scan from
  quietly weakening.
- `test/shipped-docs-names.test.mjs`, "every MCP tool a shipped doc names is in
  tools/list": its last assertions test the test's own name-matcher on sample
  sentences, for the same reason.
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
- Full `npm test`: results are in the pull request description.
