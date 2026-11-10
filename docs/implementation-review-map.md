# Reviewing implementation changes across versions

Searchable version selection is now implemented and has focused source/API/MCP
and GUI evidence. The graph still lacks the full readable old/new comparison
and explicit per-link review journey described below. Retaining the exact
reviewed checkpoint is implemented as its prerequisite; that alone is not a
completed comparison feature.

## Version selection

A version query must filter the complete checkpoint metadata catalogue before
paging, not search only options already loaded in the browser. Plan and code
selectors need independent searches, totals and page positions. Link-only
checkpoints must be distinguishable from deliberate plan checkpoints and code
captures. Keep labels, stable checkpoint IDs and current markers; dates do not
define ordering. Showing no matches must not look like an empty project while
metadata is loading.

The existing sequence-backed checkpoint log remains authoritative. Queries read
metadata, not every retained source file or code graph. Filtering must never
change history, create a checkpoint or alter selected versions silently.

## Per-link old/new comparison

Compare a selected plan/declaration pair, not merely whichever binding has the
worst aggregate status. A new binding should retain the existing checkpoint ID
from which its reviewed code was read. That provides direct access to the exact
source, declaration hash and graph edges without duplicating source text or
scanning all history on each click.

Older bindings have only observation/hash provenance. They need an explicitly
bounded fallback lookup; if no baseline can be established, say it is unavailable.
Do not compare arbitrary similarly named code and do not call absence “unchanged”.
Portable history must retain baseline references. Missing imported baselines
remain a visible limitation.

The comparison displays:

- reviewed and selected checkpoint labels, source paths and snapshot identities;
- readable source additions/removals, with clear bounds and paging;
- added/removed calls and other observed relationships for that declaration;
- body category and signature changes;
- structured plan fields instead of a raw JSON dump when the record is native.

Source and graph differences are observations, not proofs that behaviour is
equivalent or that requirements are implemented.

## Explicit review

A review updates only the chosen pair's expected plan/code hashes. It preserves
other bindings, notes and historical versions. Reuse the existing guarded
binding transaction. The user reviews the plan and code, then explicitly accepts
the selected current version. A background capture, opening a comparison or
changing administrative status must never perform this acknowledgement.

An unfinished link form must not be overwritten just to inspect a different
pair. Keep source inspection separate from editing its reason. Review against
a stale checkpoint is refused using the existing active-revision guard.

## Failure and scale probes

1. Change a linked function from a stub to a body: show both exact texts and
   the body-category change; accept only after explicit review.
2. Add a retry and remove a cleanup call: show source and relationship deltas,
   without claiming semantic equivalence.
3. Two links on one plan: review one, preserve the other's outstanding change.
4. Rename/move a function: retain the old identity and show missing/unknown;
   never silently retarget it.
5. Lost baseline after importing partial history: comparison is incomplete,
   with a route to inspect the available current source.
6. Search thousands of mixed checkpoints: reach a code capture and a deliberate
   plan version outside the first page, without reading graph bodies per row.
7. Concurrent capture or link edit during review: refuse stale acceptance while
   retaining the user's reason and selection.


## Completed version-selection boundary

The catalogue classifies checkpoint metadata as design changes, code captures
or link updates, filters before paging, and records a catalogue hash. Paging a
changed catalogue is refused. Plan and code selectors have independent queries
and offsets; a selected checkpoint remains visible outside the current filter.
Duplicate labels show dates and short checkpoint identities. Initial loading
does not display empty-project guidance.

New implementation bindings retain `reviewedRevision`, referencing the exact
existing checkpoint whose code was reviewed. Repeating an unchanged review
does not append a checkpoint. Earlier code remains readable and an explicit new
review moves only that binding's baseline. Older bindings remain readable
without this optional field; no baseline is invented on read.

Focused evidence is under `evidence/product-audit/parent-version-*`.
The full local suite passes 512 tests. All 86 registered GUI journeys pass
on the unchanged pinned-browser candidate; the exact boundary is recorded in
`version-selection-validation.json`. The full comparison feature remains open.

## Prepared comparison probes (not yet the product API)

`evidence/product-audit/code-review-probes/` preserves bounded line-diff and
relationship-delta probes. The line diff scans unchanged prefixes/suffixes over
the full text, then bounds the changed display and LCS cells. A late change in a
10,000-line source is still found; a wide change reports incomplete display.
Line-ending-only differences are labelled explicitly, with original sources
retained separately.

Relationship deltas use multiset counts of actual parser-produced edges so two
call sites are not collapsed into one. A call inside a loop is one source call
site; the comparison never claims that this equals one runtime call. Both probes
must be integrated with source-hash validation, owned-worker cancellation and
the retained baseline before they become a user-facing comparison.

## Working comparison slice

Studio now opens a wide review dialog for a selected plan/declaration pair.
`POST /api/implementation/compare` and the read-only MCP `compare_implementation`
tool use the same typed request and owned-worker implementation. The dialog
shows the current plan fields, exact reviewed/selected source identities, a
bounded line diff, body categories and paged relationship deltas. Full retained
source remains separately pageable. Explicit acceptance reuses the guarded
link write and preserves its reason, other bindings and unfinished link drafts.

Baseline lookup is deliberately direct: `reviewedRevision` must resolve to a
retained graph matching the binding's observation, declaration and body hashes.
Legacy links without this reference, lost history, and mismatched provenance
report unavailable comparison. There is **no implicit history scan or name-based
fallback**. Reviewing available current source can establish a new baseline;
that does not retrospectively claim the missing old source was compared.

Source comparison scans common line prefixes/suffixes over the complete strings,
then bounds display to 300 changed lines per side, 24,000 displayed characters
including context, and at most 40,000 LCS cells. Individual unchanged
context lines are shortened to 500 characters so they cannot hide the edit. Wider edits use an explicitly
labelled coarse replacement; clipped output reports incomplete display. Line
endings are normalized only for display, including when a substantive edit is
present. Original bytes and their hashes remain authoritative.

Relationship comparison counts multiset source edges, preserving repeated sites.
It is O(E + K log K), with O(K) storage for distinct outgoing relationships;
results are sorted by deterministic code-point keys and paged before display.
Names/IDs have explicit display caps, with shortening flagged. This describes
static syntax, not runtime loop counts. Incomplete parser resolution or stale
capture prevents a complete-relationships claim. Graph decode/diff work runs in
an owned cancellable worker with the existing memory bound. Reading never writes
history. Missing/invalid worker output is rejected by the comparison schema.

Focused evidence: `code-difference.test.mjs`, `relationship-difference.test.mjs`,
`implementation-comparison.test.mjs`, the real MCP journey, and
`studio-implementation-review.browser.mjs`. The GUI journey includes keyboard
modal behaviour, narrow layout, axe, exact cleanup/repeated-call differences,
per-pair acceptance and preservation of an unrelated unfinished link draft.
The complete 87-journey GUI boundary and later focused refinements are recorded
separately in `code-review-validation.json`; the original focus failures are
retained alongside their corrections.
