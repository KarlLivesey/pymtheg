# W2-I: graph core speed and conformance hardening

The language-module and query interface is unchanged: no language-module/query
type or function signature, ID calculation, stored-fact meaning, result ordering
or module lifecycle contract changed. The conformance expectations gain an
optional, explicit exclusion list for other position-sensitive preambles. Language-module authors need no implementation
changes. The conformance kit now independently verifies the existing requirement
that symbol IDs survive a blank line inserted above declarations, even if an
author's initial expected identities contain source offsets. Discovery's test
now checks every immediate `src/graph/*.ts` core file for fixture-language names.

## Exact conformance edit

Context-only fixtures (`context: true`) are never edited. For every source fixture,
the kit inserts one LF blank line before the source, except that a leading BOM
stays at offset zero and a leading `#!` line stays first: insertion is after the
BOM and, if present there, the entire shebang line including its original line
terminator (LF, CRLF, CR or Unicode line separator). After a shebang the blank
line repeats that terminator, so inserting LF cannot accidentally coalesce with
a CR-only terminator. A shebang without a terminator
gets an LF terminator followed by the blank line. Other source bytes are unchanged.

Other constructs can also be sensitive to line placement, such as an encoding
cookie required on the first two lines. Such a fixture may explicitly opt out
with `identityEditExclusions: [{file: "script.ext", reason: "..."}]` in its
**expectations**. Reasons must be nonempty; filenames must name unique source
fixtures. Excluded fixtures retain their original text and are visibly exempt
from this edit-stability check; all other positional/fact checks still apply.
No exclusion is inferred silently. Existing correct callers need no new fields.
Compiler-backed self-tests cover shebangs, BOMs and unchanged context text; the
broken offset-based identity variant remains rejected.

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
errors, resolver errors, invalid/duplicate decisions, and common definite and
multi-candidate derived links. Direct partial/failed replacement with retained
symbols verifies incoming-target/candidate invalidation before any re-indexing
can repair a mistake.
Comparisons include full source/canonical file records, contexts, symbols and IDs,
all link fields/candidate statuses, complete reports, filtered queries and
neighbourhoods. Existing graph assertions remain intact; the discovery assertion
is expanded to all core files. A deliberately offset-based module now fails the
kit despite initially correct expectations. Additional checks cover cold query
paths, snapshot isolation, and changes from another store connection.

`test/graph-core-scaling.test.mjs` counts array callback visits, map/set operations,
Array/Map/Set iteration steps (including for...of, spread and destructuring), and
SQL rows returned, plus SQLite `total_changes()` (including triggers and foreign-key
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

The synthetic workload now contains ten parsed, ten definite derived and ten
three-candidate derived links per file. The one-file edit writes 151 rows at every
counted size (including that file's derived candidate memberships); unchanged
runs write zero. The older parsed-only observations remain preserved and can be
reproduced with `evidence/w2-i/parsed-only-scaling.mjs`. New derived-workload counts,
observations, requested mutation checks and final validation logs are under
`evidence/w2-i/review-r2/`. The exact per-added-link symbol-map regression and a
nested for...of membership scan must fail the growth assertions; removing failed
target invalidation must fail the direct full-state comparison. Candidate-kind
corruption is also checked against the thicker derived-link generator.


Counter limits: numeric index-based `for`/`while` loop bodies are not counted
unless they perform other instrumented operations. Element comparisons inside
`Array.prototype.includes` and `Array.prototype.indexOf` are also not counted.
A quadratic step written in those forms can therefore escape the growth check.
SQL rows returned are not all SQLite VM steps, and sorting/native work is not
fully measured. The counters are targeted regression evidence, not a general
proof of asymptotic complexity; source inspection remains necessary.

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

## Review follow-up: snapshot test oracles

Snapshot-isolation expectations are deep-copied before mutation. Tests mutate
nested fields returned by getFile/files/contexts, symbol/link queries and
neighbourhoods, on cold and warm stores. They also mutate retained parse inputs
and outputs, analyze/resolve contexts, authoritative analyze outputs and resolver outputs, and prior reports,
then verify unchanged stored facts and fresh subsequent invocations. An in-place
analyze edit with no returned replacement cannot corrupt the decoded-file cache.
This audits persistence/cross-invocation aliasing; it does not add new semantics
for mutation of shared current-invocation snapshots. The exact cached-file
clone-removal mutation must fail these tests. Evidence is in `review-r3/`.

The shared synthetic module is now `test/fixtures/graph-core/synthetic.mjs`;
operation-count tests and the observation script both import that fixture.
Generated equivalence queries sample up to six symbols including the last ID,
at depths 0/1/2/5, both unfiltered and filtered by calls.
