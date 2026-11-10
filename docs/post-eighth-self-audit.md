# Follow-ups after the eighth candidate freeze

The independent review uses `/tmp/pym-eighth-candidate-tgtvmswd`, which remains
unchanged. This page records additional main-workspace work; it is not evidence
that the frozen candidate already included these fixes.

## Code output navigation

A first-time user should not have to infer that History contains generated code.
Code now has its own view for stubs, interfaces and signature-comparison baselines.
History retains check snapshots and evidence export. Recipe shortcuts open Code.
The strict core/web build passes. Real browser checks are queued until the
independent review has finished its browser work.

## Concurrent withdrawal explanations

A real two-copy probe found that withdrawing one acknowledgement independently
for different reasons prevented history import. Both copies kept their own data,
but there was no useful way to bring the compatible decisions together.

The acknowledgement remains withdrawn and now retains both explanations in a
content-ordered set. Timestamps are recorded information, not winning clocks.
The original review identity/author/reason remain immutable. Duplicate archive
imports do not duplicate explanations. Conflicting original acknowledgement
identities are still refused. Explanation counts and transport pages are bounded;
Studio/MCP retrieve additional explanations separately from review-summary pages.

Evidence: `post-eighth/concurrent-withdrawals-before.json`, the `after.json`,
`concurrent-withdrawals-tests.txt`, and `withdrawal-mcp.txt`. Storage tests exercise
both import orders, repeated imports, paged summaries and malformed histories.
The 17 real MCP tests pass, including paged access to both explanations. GUI
verification is pending; no replacement 9.5 rating is claimed.

## First-import stability

The next probe found an order-dependent edge case: a new acknowledgement with a
duplicate explanation initially retained three entries, then the same archive
reimport reduced it to two. New records now use the same canonical merge as
existing records. The regression checks the first import, expected two distinct
explanations, and byte-equivalent exported history after reimport. Logs are
`post-eighth/canonical-withdrawals-before.txt` and `canonical-withdrawals-after.txt`.
All four branch-acknowledgement tests pass. The previously completed full local
run passed 306 tests; this additional regression has been checked separately.

## Read-only access to legacy review records

A v6 store retained review pairs but the new detailed view returned zero records,
leaving no visible review to withdraw until some unrelated action migrated the
workspace. Read-only access now projects these pairs into deterministic review
IDs without inventing author, reason or date. The same IDs are created by the
writable migration, so an intentional withdrawal can use the displayed record.

`branch-v6-readonly.test.mjs` checks an actual pair-only SQLite fixture, unchanged
database bytes and directory entries after read-only inspection, and subsequent
withdrawal under the same ID after migration. The captured failing and corrected
results are `post-eighth/legacy-review-before.txt` and `legacy-review-after.txt`.

The pending browser set is now explicit: updated Code-output journeys, the
concurrent-withdrawal journey in `studio-branches.browser.mjs`, and the new
`studio-legacy-review.browser.mjs` journey. None has been reported as passed
before its actual run. The frozen review candidate is still unchanged.

## Finding the review that still applies

Review history was sorted only by opaque IDs, so a still-active review could be
buried after pages of withdrawn records. Pages now put unwithdrawn reviews first,
then use stable IDs within each group. They do not infer sequence from timestamps.
A deterministic 31-record import with deliberately misleading IDs and dates
reproduces and verifies the fix, including complete pagination without duplicates.
Each visible review also names the revision it compared against. Core evidence:
`post-eighth/active-review-page-before.txt` and `active-review-page-after.txt`.
The new comparison label is included in the pending GUI assertions.

## Discovery in mixed-language repositories

Default discovery now skips Rust `target/` and Go `vendor/`, as it already skips
common Node output and historical evidence. Explicit include globs can opt these
folders in; explicitly selected sources and required imports still load. Include
patterns with a static directory prefix prune unrelated subtrees before listing
them. Patterns without a known static prefix remain conservative and do not
prune potentially eligible directories.

Source-inventory and glob-correspondence regressions pass. An inaccessible
unrelated directory establishes the pruning result without a speed threshold.
Before/after evidence is in `post-eighth/source-pruning-*.txt`.

## Executable discovery self-model

`examples/self/discovery.pym` distinguishes directory entries, directory-list
attempts and source parses. It models a root with one design source and a
1,000-source generated tree; `test/self-discovery.test.mjs` creates that actual
fixture and compares the model to instrumented loader counts. Broad discovery
visits 1,003 entries, lists 3 directories and parses 1,001 sources. A selected
source root visits 3 entries, lists 2 directories and parses 1 source. Both runs
type only the selected source. These are structural work counts, not CPU time
or a universal repository-size bound.

Captured model output is `post-eighth/self-discovery-report.json`; focused tests
are in `self-discovery-test.txt` and `self-discovery-regressions.txt`. Existing
source-file limits are not asserted to bound arbitrary non-source directory
contents. The report now records actual discovery entries and directory-list
attempts so this work is observable.

## Large agent-facing code outputs

A 1,000-type design could be checked but `emit_scaffold` failed at the 256 KiB
response limit, suggesting pagination without offering it. Large emissions now
return retained artifact handles; source, manifest and details are retrievable
in bounded exact-text pages. Small emission responses remain complete. Tests
reconstruct all three sections and verify whole-text hashes, source/symbol counts
and snapshot identity. A registered-emitter test verifies that page reads do not
execute it again. Unicode boundaries, eviction and shutdown release have separate
unit checks. This has no browser dependency and is separate from the frozen
review candidate.

The full local suite after the large-output changes passed 317/317 tests,
without failures or skips (`post-eighth/mcp-output-local-suite.txt`). Formatting
checks pass. New output-page tests additionally recheck edited source before
reading an older artifact, verifying that the original snapshot and exact text
remain attached to that artifact. GUI verification and independent review remain
outstanding; the earlier frozen candidate does not include these follow-ups.

## Eighth review remediation in progress

D1: bounded immutable project inventories are implemented; five inventory/MCP
checks pass including a 1,000-file real session and oversized Unicode name.
D2: selected verdicts and affected-consumer evidence are separate, with 22 focused
boundary checks and a real GUI rename journey. Unrelated declarations sharing a
caller file no longer decide the selected result. D3: broken-source baseline
publication is refused and preserves existing bytes; partial baselines remain
explicit and incomplete on comparison. D4: root-first inventories and caller
impact completeness have a real 10,002-file regression; eight related checks pass.

D5: conservative prose normalization now covers CRLF, trailing spaces and soft
wraps; code/HTML contexts remain sensitive. Comparisons show changed-line excerpts.
D8: three-way saved-form merging preserves independent current edits; conflicting
fields need explicit choices. A real browser journey exercised both paths. Its
screenshot exposed unreadable JSON choices, subsequently changed to signatures.

D6 now leaves an ambiguous moved heading unresolved when preserved heading content
appears at new paths alongside an old-path replacement. It lists candidate paths;
an actual GUI repair chooses a target while retaining old/new comparison text.
The detector is conservative: it does not claim arbitrary similarity-based identity.
D7 compares unique declaration kind/name across file moves and shows field deltas.
D10 preserves trailing comments with explicit previous-member context. Remaining
polish received readable errors, source-document counts and an automated planning
accessibility regression. Three rich native compiler tests validate recursive
records, outcomes and real arbitrary-precision dependency types; each rejects a
changed result while preserving implementation bytes.

Consolidated evidence: 336/336 local and 70/70 real integrations pass without skips.
All 49 registered GUI journeys and the temporary installed-package check passed.
The later parameter-order fix received focused GUI follow-up. Another independent
audit remains required before any new readiness rating. Earlier failing logs stay preserved.
