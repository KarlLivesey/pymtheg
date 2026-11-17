# TP-2: prune tests that guard no behaviour (graph, implementation, architecture)

Slice: every file in `test/` whose name starts with `graph`, `implementation`
or `architecture`. Each test was judged against the owner's rules: keep a
test only if it changes when the intended behaviour changes and fails only
when that behaviour regresses.

Most of the slice checks real answers on fixtures: graph links, candidate
sets and failure causes for Go, Rust and TypeScript; architecture import,
history and planning-link outcomes; code-observation results; CLI and MCP
outputs; read-only and cancellation safety. Those stay. The slice has
almost no tests that read source text or assert that removed things are
absent. What was pruned is listed below.

## Counts

| | Before | After |
| --- | --- | --- |
| Files in the slice | 139 | 139 |
| `test(...)` declarations in the slice | 1101 | 1098 |
| Tests run by `node --test` on the slice's `*.test.mjs` files | 2101 | 2100 |

The second row counts `test(` calls in the source; some sit in loops, so the
runner count in the third row is higher. It was 2098 after the first round;
review round 1 added two locale subtests to A8. `implementation-check.integration.mjs`
is in the slice but is not part of `npm test` and was not changed.

## Deleted or rewritten tests

| File | Test | Action | Rule | Why |
| --- | --- | --- | --- | --- |
| `graph-go-review15.test.mjs` | round 16 Sol 4: the one combining function merges every field | deleted | implementation | Called the internal `combine` helper directly and pinned its internal record shape; the behaviour (a combined link keeps every reason, candidate and failure of its parts) is guarded end to end by "round 16 Sol 4: combined decisions keep every property of every part" in the same file. Review round 1 found that test did not guard the dispatch cap; it now also asserts the literal 25 candidates of a reassigned method value over 24 implementations (see below). |
| `graph-go.test.mjs` | Go sample covers every listed hard case | deleted | nothing | Asserted only over `fixtures/graph-go/expected.mjs`, the test's own expected data; no change to the code could make it fail. The conformance-kit test in the same file already checks the module against every one of those expected facts. In review round 1 that test's check that the fixture text contains an emoji was also removed, for the same reason. |
| `graph-core-equivalence.test.mjs` | fixed-seed edit sequences match the frozen pre-W2-I indexer, resolution and complete store | deleted | implementation (and past) | Expected values came from a frozen copy of the pre-W2-I production indexer and store, so a bug the two share still passes, and any intended indexer change needs the copy edited. The refactor it protected is finished. Edits, deletions, parser, analysis and resolver failures, and invalid or duplicate resolutions are guarded with literal outcomes in `graph.test.mjs` and `graph-core-robustness*.test.mjs`; what is lost is the breadth of 24 generated edit sequences. File removal is still guarded: A5 in `graph-review.test.mjs` calls `removeFile` directly, and the toy re-index test in `graph.test.mjs` fails when file removal is disabled. |
| `graph-core-equivalence.test.mjs` | direct partial and failed replacements invalidate incoming definite and derived-candidate links | rewritten | implementation | Every step was compared against the frozen reference store. Now it keeps only its literal outcomes: after a direct partial replacement the incoming call link reports the target as partial, and the caller's candidate link survives with its four literal candidate IDs, the target and its sibling marked partial and the other two clean; after a failed one the target has no incoming links and the caller's link is unresolved. The test module it uses was trimmed to the one path the test runs. |
| `graph-review.test.mjs` | A8: ordering never invokes localeCompare and is stable across locale environments | rewritten (now "A8: ordering is stable across locale environments") | implementation | Replaced `String.prototype.localeCompare` with a thrower to assert which helper is not called. Kept the behaviour: re-indexing Unicode-named files gives a byte-identical index, and registry order is the same under the `C` and `sv_SE.UTF-8` locales. Added in review round 1: graph output lists `ä.toy`, `z.toy`, `a.toy`, `Z.toy` in the literal code-unit order `Z, a, z, ä` under both locales, as two subtests; a subtest is skipped, with the reason, if Node does not resolve that locale. |
| `graph-core-robustness-hardening.test.mjs` | legacy path-only failure markers upgrade as misses, then acquire verified provenance | rewritten | implementation | Dropped the `PRAGMA table_info(graph_parse_failures)` column-list assertion (private table layout). Kept the behaviour: an old marker is not trusted, the file is parsed again, then the new marker is trusted and the next run does not parse. |
| `graph-core-robustness-hardening.test.mjs` | transient analysis clears content provenance at both the coordinator and store boundaries | rewritten (now "transient analysis clears content provenance, even when the store is asked to cache it") | implementation | Dropped the mock of `store.replaceFile` that asserted the call count and the internal "cache" argument the indexer passes, and the row count of the private `graph_parse_failures` table. Kept the behaviour: after transient analysis the file is not a cached failure, the store refuses to cache transient provenance when asked directly, and after reopening the file is parsed again. |
| `graph.test.mjs` | convention discovery needs no language list or core edits | rewritten | implementation | Dropped the scan of `src/graph/*.ts` source text for the word "toy". Kept the behaviour: production discovery does not claim `.toy`, test-mode discovery does, and a newly added language folder is discovered and claims its extension with no other change. |

## Fixtures and production code removed

- `test/fixtures/graph-core/reference/` (`README.md`, `analysis.mjs`,
  `indexer.mjs`, `store.mjs`): the frozen pre-W2-I implementation. Its only
  users were the two equivalence tests above; a repository-wide search found
  no other import (the benchmark does not use it, despite its README).
- `src/graph/languages/go/resolve.ts`: `combine` is no longer exported. The
  export existed only for the deleted test; the function itself is still used
  inside the module.

Historical change notes (`docs/changes/W2-I.md`, `docs/changes/LIC-2.md`)
still mention the reference fixtures; they are records of past work and were
left as they are.

## Kept but doubtful

- `graph-command.test.mjs`, "warm queries use no full graph snapshot APIs, do
  not parse, and preserve index bytes", and `graph-core-equivalence.test.mjs`,
  "decoded snapshots are isolated, cold queries avoid source records, and
  external replacements are visible": both replace store methods with
  throwers to prove a query does not load whole snapshots or source records.
  That pins which methods are called, but it is the deterministic
  operation-count check AGENTS.md asks for in place of timing, guarding the
  index-speed promise. Kept.
- `graph-core-scaling.test.mjs` (all three tests) and the parse counters in
  `graph-core-robustness*.test.mjs` and `graph-stable-failures.test.mjs`:
  counts of parses, writes and decodes. Same reason; kept.
- `graph-go-toolchain-review.test.mjs`, "G: forged facts: the toolchain's
  target is preferred, both recorded, a withdrawal": forges the internal `tc`
  fact format and reads the internal `linkNotes` result. The neighbouring
  "G: a disagreement is recorded…" test covers the preferred-target case end
  to end with real Go; the forged test is the only one covering the
  withdrawal-to-external case, which would need a new real-toolchain fixture
  to rewrite. Kept.
- `graph-link-index.test.mjs`, "read-only stores without the file-status
  index read identical links", and `graph-command-review.test.mjs`, "main
  schema-3 status and no-sync queries are byte-identical read-only
  operations": both build an older database layout. They guard that an index
  written by an earlier build is still read correctly and not modified, which
  users with an existing index rely on. Kept.
- `graph-core-robustness-hardening.test.mjs`, "Tree-sitter no-tree result is
  transient and is never cached": mocks `Parser.prototype.parse` (a
  dependency, not the unit under test) to inject a failure and counts its
  calls to show the result is not cached. Kept as fault injection.
- `graph-command-toolchain.test.mjs` and `graph-go-toolchain.test.mjs` each
  have a "go missing" test. They overlap but guard different surfaces: the
  graph command's `toolchain.go` output versus the indexer report and the
  unchanged graph. Kept both.

## Review round 1

Each new assertion was checked against the reviewer's mutation in a scratch
copy of the tree on the dev server (never committed):

- Dispatch cap: with the combined decision's `limit` rule replaced by
  `() => undefined`, the new assertion fails (0 candidates; the link reports
  an overflow of 25 against a cap of 20). On the real code it passes with 25.
- Partial replacement: with a partial replacement made to delete every link
  that has a candidate in the replaced file, the new assertion fails (the
  caller's candidate link is missing). The old `.every()` check passed on
  that empty list.
- Locale order: with `compare` in `src/graph/identity.ts` replaced by
  `a.localeCompare(b)`, both subtests fail: `C` gives `a, ä, z, Z` and
  `sv_SE.UTF-8` gives `a, z, Z, ä`. The dev server has no `sv_SE` system
  locale (`locale -a`), but Node's bundled ICU still resolves `sv-SE` from the
  environment, so neither subtest is skipped there.
- After the fixes, the touched files (`graph-go-review15`,
  `graph-core-equivalence`, `graph-review`, `graph-go`) pass on the dev
  server: 31 tests, 31 pass, 0 fail, 0 skipped. The slice count rises by the
  two locale subtests.

## Checks

All run on the dev server.

- Before the change (main), the slice's `*.test.mjs` files: 2101 tests,
  2101 pass, 0 fail.
- After: `npm run build` passes; `tsc --noEmit` passes; Prettier check of the
  changed test files and `npm run format:check` pass (the check does not cover
  `docs/changes`, and this note is not Prettier-formatted).
- After, the slice's `*.test.mjs` files: 2098 tests, 2098 pass, 0 fail
  (2101 minus the three deleted tests).
- After, full `npm test`: 2920 tests, 2920 pass, 0 fail, 0 skipped.
- `implementation-check.integration.mjs` (backend suite, not part of
  `npm test`) was not changed and not run.
