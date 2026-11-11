# W2-I: graph core speed and conformance hardening

The language-module and query interface is unchanged: no existing exported type
or function signature, ID calculation, stored-fact meaning, result ordering or
module lifecycle contract changed. Language-module authors need no implementation
changes. The conformance kit now independently verifies the existing requirement
that symbol IDs survive a blank line inserted above declarations, even if an
author's initial expected identities contain source offsets. Discovery's test
now checks every immediate `src/graph/*.ts` core file for fixture-language names.

## Internal changes

Resolution builds symbol, file and link-ID lookups once per validation pass,
rather than rebuilding/scanning the entire graph for each decision. Added-link
validation checks each canonical file once, then validates individual drafts.
Project-analysis replacement and context-change detection use path lookups.
Analysis and resolution still run on every invocation with complete snapshots;
parsed links are still presented unresolved and derived links are rebuilt.

SQLite queries select only matching symbol/link rows. Links join compact file
status columns and candidate/target status rows without decoding source records.
Neighbourhood traversal loads just visited symbols and their incident links.
Incident IDs are deduplicated before loading link bodies, so an ambiguous edge
with many candidate endpoints is decoded only once.
Indexes cover symbol filters, link file/source/target/module/resolution, and
candidate symbol/kind lookups, including foreign-key cleanup paths. Resolution
state is maintained during target/candidate invalidation; losing one candidate
never silently promotes another to a definite target.

Captured source/context records are decoded once per distinct stored body per
store instance and returned as independent snapshots. A cold reopen must decode
its snapshot once; unchanged subsequent invocations reuse decoded records.
Reads still consult SQLite, so another connection's replacements remain visible.
Full source text is confined to snapshot APIs and module phases, outside query
hot paths. Context persistence updates only changed/deleted records. Target
persistence compares definite targets and candidate memberships and does not
rewrite identical outcomes. No native module/compiler state is cached by core.

**On-disk schema changed from 2 to 3.** Existing graph databases are refused with
the existing rebuild message; rebuild them with the same project namespace to
retain symbol IDs. Schema 3 adds indexed metadata/candidate-kind columns and
invalidation triggers. There is no migration or backwards compatibility claim.

## Proof and observations

`test/graph-core-equivalence.test.mjs` compares the optimized core with frozen,
test-only pre-W2-I implementations from commit `397c5e7`. Twenty-four projects
use a fixed PRNG seed and exercise unchanged runs, edits, symbol renames, file
moves, deletions, partial files, parser errors, context changes/removal, analysis
errors, resolver errors, invalid/duplicate decisions, derived links and ambiguity.
Comparisons include full source/canonical file records, contexts, symbols and IDs,
all link fields/candidate statuses, complete reports, filtered queries and
neighbourhoods. Existing graph assertions remain intact; the discovery assertion
is expanded to all core files. A deliberately offset-based module now fails the
kit despite initially correct expectations. Additional checks cover cold query
paths, snapshot isolation, and changes from another store connection.

`test/graph-core-scaling.test.mjs` counts array visits, map/set operations and SQL
rows returned, plus SQLite `total_changes()` (including triggers and foreign-key
actions). It asserts linear growth over 40/80/160/320 files, zero parses/writes/
stored-file decoding on unchanged runs, and one parse plus writes restricted to
the edited file's facts for a one-file edit. It also checks an affected caller
is invalidated while an unrelated resolution is preserved. A separate growth
check visits every endpoint of a large ambiguous link and verifies that link is
decoded once, with linear rows/lookup work. Targeted sample
queries read a constant number of rows as the store grows. Zero-parse/write
counts use successful unchanged snapshots; existing failed-file retries and
error recovery remain mandatory and can replace facts. Timings are never
acceptance criteria; deterministic ordering and SQLite B-tree operations retain
their usual sorting/index costs. Work also necessarily scales with snapshot
bytes and candidate memberships, not just counts of files and links.

Before/after elapsed-time observations at 100/200/400/800/3200 files, the exact
reproduction harness, operation counts and final check results are recorded in
`evidence/w2-i/`. These are local observations with shared machine load, not
speed guarantees. The manager explicitly revised the original near-constant
unchanged-run target to linear snapshot/resolution work with zero parses/writes.

## Possible later addition: incremental resolution

An optional, additive module capability could allow core to reuse a successful
resolution when its declared inputs have not changed. A module would need to
guarantee deterministic, snapshot-only decisions and declare the complete set
of source/context files (or versioned project-wide dependencies) on which each
link and derived relationship depends. Negative lookups must include the scope
in which a newly added/renamed declaration could supply a target; otherwise a
previously unresolved or ambiguous result could be cached incorrectly. Module
version, target removal/status changes, dependency additions/removals, and prior
errors must invalidate cached results. A separate opt-in analysis guarantee
would also be required to skip the current mandatory project phase safely,
including after cold reopening. Existing modules would continue receiving the
current complete-snapshot callbacks on every run. This is a description only;
no incremental capability or contract change is implemented here. Inventory and
content verification would still require work unless a separate trusted change
inventory were supplied.
