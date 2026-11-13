# W2-M: graph core robustness

## Large analyses

SQLite already persists each derived relationship in its own `graph_links` row.
The remaining module-sized strings were the equality checks in `replaceAnalysis`
and `resolveLinks`. Both now compare matching links individually, then preserve
the existing atomic per-row updates and per-row reads. No whole analysis JSON
string is assembled, on unchanged, changed or reopened paths. Link-row format
and language modules are unchanged.

The new regression injects a 4,096 UTF-16-code-unit ceiling into JSON stringify
and parse, while round-tripping 300 derived links whose aggregate exceeds that
ceiling by more than ten times. It checks initial writes, zero-write unchanged
replacement, reopen, changed/deleted links, rejected invalid output and clearing.
The former whole-array equality check fails this ceiling. This exercises the
same per-row path without allocating gigabytes. This is not a claim that arbitrary
single facts, source files or candidate lists fit V8/SQLite limits, or that all
large projects fit memory: the snapshot still resides in arrays in memory.

An honest size calculation, reproduced by `evidence/w2-m/isolation-observation.mjs`:
Node 24.21.0 reports `MAX_STRING_LENGTH = 536870888` code units. One synthetic
AddedLink serializes to 312 code units. An array repeating it 1,715,243 times
requires `1 + 1715243 * (312 + 1) = 536871060` code units, beyond that limit.
Even before conversion to identified GraphLinks this can exceed the limit.
No test claims to allocate that array/string successfully.

## Cached failures and query

A valid returned content failure is now reusable when original-byte content hash,
module ID and module version match. Core tracks no separate grammar/parser
version: the existing module-version contract requires bumping `version` when
its parser or grammar changes. Failed files remain failed in reports and retain their diagnostics. Fixing content or changing
the module/version invalidates the cache. Inventory and content reads still run;
unreadable captures are retried. Project analysis and resolution still run on
every invocation, including cold reopen. Analysis failures remain retryable:
they must not suppress the parse needed to rebuild a valid canonical snapshot.
Thrown parser exceptions (including crash, timeout, cancellation and resource
budget errors), malformed parser output and source-capture failures are never
cached as content failures. Returned operational failures opt out with the
additive `ParseResult.failureKind: "transient"`; absent that field, a valid returned
failed result declares a content failure (`"content"` is also explicit). This
preserves existing content-failure modules without edits. Modules must throw or
mark operational failures transient, rather than misreporting them as content
errors. Core does not classify errors by wording. The core Tree-sitter helper
marks its no-tree result transient. The new optional field is validated.

A small additive `graph_parse_failures` table records this provenance, keyed by
file with cascading deletion. File replacement updates the marker in the same
transaction as the facts. Existing schema-3 databases gain the table on open;
existing records have no marker and failed parses are retried once to establish
provenance. Schema version remains 3: old stored records and meanings are valid.
`GraphStorage.replaceFile(file, parseFailure?)` has an optional second argument;
`isParseFailure?(path)` is an optional capability. Existing backends without it
retain their retry behaviour. The shipped SQLite backend caches failed parses.
Direct replacements default to retryable failure; indexer explicitly marks
cacheable returned content failures. No native parser/compiler state is persisted.

`SqliteGraphStore.failedFiles()` is the new synchronous read API (also exposed as
an optional `GraphStorage` capability for source compatibility with other stores).
It returns only canonical source files with status `failed`, ordered by
locale-independent path: `{path, language, reason, range?}`. Language is the module
ID; reason is the first diagnostic message; range is that diagnostic's optional
half-open UTF-16 source range, with no invented position. Returned records are
independent snapshots and survive reopening. Partial files remain available via
`files()` and report.partial; capture/claim/context-only failures are still named
in the index report and are not invented as language-owned canonical source files.

## Resolver isolation

Each resolver receives an independent deep copy of files, symbols, its unresolved
parsed links and its declared context files. Nested mutations and array edits
cannot change the validation snapshot, later resolvers or stored facts. Module
signatures, resolve ordering, cold analysis lifecycle and language implementations
are unchanged. Copying also preserves the mutable nested snapshots exercised by
the pre-existing isolation tests, including mutation after callback return.

The observation script compares one deep freeze with three complete copies over
3,000 files (1,000 text code units each) and 30,000 symbols. Five local observations:
freeze once 22–38 ms; three copies 220–246 ms. Copying is costlier; that observed
cost is accepted to preserve existing mutation behaviour. It increases temporary
memory and work with snapshot size and resolving-module count. No timing is an
acceptance criterion. Exact samples and workload are saved alongside the script.

## Validation

New deterministic tests count parser invocations by path, verify zero parses and
zero database-byte changes on unchanged projects with content failures, exercise
cold reopen,
fix/version invalidation, exact failure reports, retryable project errors, and
cross-module nested mutation. The string ceiling is injected by the test at the
serialization boundary; production has no test-only piece-size setting. Individual
stored link rows are the pieces. Existing language modules and all existing
`test/graph-*.test.mjs` tests are untouched.
With Karl's explicit scope extension, only these two existing tests in
`test/graph.test.mjs` were updated:

1. “failed and partial parses are recorded…” now returns a valid content failure
   rather than throwing a parser crash, and expects two unchanged files/zero
   indexed on repeat. This specifically tests the new content-cache contract;
   crashes must still retry and are independently tested in the new regression.
2. “module revision invalidates cache…” retains its malformed-output and atomic
   rejection assertions, then establishes a valid content failure. Replacing the
   parser at the same version must leave it failed with zero indexing; bumping
   the module version retries and restores the original symbol IDs. A fixed
   implementation under an unchanged version cannot bypass a content cache.

The core conformance kit now expects cached parser failures to be unchanged and
still counts retryable analysis failures as indexed. Its original retry-all-failed
expectation caused the two initial Go/Rust conformance failures; the captured
initial run passed the other 1,000 tests. Exact graph-fact assertions remain intact.

The new operational-failure regression simulates thrown crashes, timeouts,
cancellation and resource-budget errors, explicitly transient returned failures,
and malformed facts; every case retries unchanged content after reopening and
succeeds. These use deterministic calls, not real timeouts or elapsed assertions.

Final command results and logs are recorded in `evidence/w2-m/README.md`.
