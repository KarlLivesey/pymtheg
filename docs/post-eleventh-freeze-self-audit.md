# Self-audit after the eleventh candidate freeze

The independent review input remains `/tmp/pym-eleventh-candidate-94n9d3x1`.
Its 2,240 fingerprints still matched after this work. Changes below are only in
the main workspace and must not be credited to the frozen candidate.

## Displayed source and recovery

A new failing probe showed that selecting a component, reformatting that component
on disk, then saving could retain different bytes under the review label. A
captured semantic hash alone was insufficient for the displayed-source contract.
Save validation now checks the selected declaration's exact displayed text and
its dependency expectations. It still revalidates current file hashes immediately
before publication. An unrelated declaration edit in the same file is permitted;
it does not change the selected text or dependency closure.

Source refresh conflicts and competing plan edits now have distinct API conflict
kinds. The GUI keeps a stale-source draft in its current form and asks the user to
refresh and explicitly review. It does not open the unrelated concurrent-record
merge form. The real API regression exercises both conflict kinds.

Evidence:
- `post-eleventh-freeze-displayed-review-before.txt`: reproduced stale text capture.
- `post-eleventh-freeze-displayed-review-after.txt`: source checks after the guard.
- `post-eleventh-freeze-selected-scope-before.txt`: overly broad whole-file guard.
- `post-eleventh-freeze-source-final.txt`: selected-text scope and conflict routing.
- `studio-stale-source-review.browser.mjs`: prepared GUI journey; not run while the
  independent reviewer owns the shared browser resource.

## Imported dependencies and repeated references

The source-review limit counts explicit selected roots. A linked component can
have more than 32 imported dependencies within the normal parser/snapshot limits.
A failing probe showed the work view accidentally counted every recorded
dependency as another root. It now starts capture from the actual plan links;
the canonical IR supplies their dependencies.

Dependency traversal uses deduplicated adjacency sets and ordinary iteration.
A 150,000-edge repeated-reference probe returns the two relevant declarations
without building an enormous function argument list.

Evidence: `post-eleventh-freeze-import-roots-before.txt` and
`post-eleventh-freeze-source-scopes.txt` (13 focused checks pass).

## Executable self-model

`examples/self/source-reviews.pym` models two plans sharing one component, semantic
changes versus formatting changes, and source selection/publication ordering.
The model explicitly permits source edits after a save: the saved version is
compared with publication-time source, not with a mutable file forever.

Pinned TLC exhausted 17 states of `IndependentSourceReviews` and 16 states of
`RevalidatedSourceSelection` without an invariant violation. Deliberately unsafe
models produce replayed two-event counterexamples:

- `changeMeaning -> reviewA` exposes implicit acknowledgement for plan B.
- `formatOnly -> captureForA` exposes replacement of B's reviewed source bytes.
- `edit -> save` exposes publication from a stale selection.

The JSON evidence files start with `source-review-self-`. The first selection
model/result is retained separately; its revised version includes post-save edits.
These finite models check the design decisions. They do not prove SQLite, the
source compiler, or the production implementation correct.

No new readiness rating is awarded here. The frozen independent review, new GUI
recovery journey and consolidated current validation still need reconciliation.

Current follow-up validation: all 392 local tests pass with no skips, and the
format check passes. This is a new main-workspace result, separate from the
387-test frozen eleventh candidate. The prepared stale-source GUI recovery test
remains pending; it is not counted among the earlier 57 passing GUI journeys.

## Multi-link review clarity

A plan with two independent components exposed another presentation error:
the source-card endpoint returned every changed plan dependency for each card.
It now limits a card to that selected component and its current dependency
closure. Plan-wide Needs attention still reports the other component's change.
The UI explicitly labels the scope and distinguishes unchanged declaration text
from changed binding/dependency semantics. The failing and corrected evidence
is in `post-eleventh-freeze-detail-scope-before.txt` and `...-after.txt`.

## Freshness checks do not block the coordinator

The final stale-source comparison previously read every file synchronously.
A bounded asynchronous reader now handles the coordinator paths in CLI, Studio
and MCP, including reading older agent evidence. Nonblocking open plus a
regular-file check avoids waiting on a FIFO substituted for a source. The reader
shares the parser's two-MiB per-file limit, rejects invalid UTF-8 as stale and
observes the request's abort signal between bounded reads.

The cancellation regression queues an abort across the asynchronous open
boundary; it uses no elapsed-time threshold. A real FIFO fixture checks that no
writer is required. Existing encoding, session, MCP and Studio checks also pass:
48 focused tests, no skips. Evidence: `post-eleventh-freeze-freshness-focused.txt`.
This does not claim filesystem locking or indefinite-I/O guarantees against an
uncooperative kernel/filesystem.

Latest consolidated follow-up validation: **396 local tests passed, no skips**;
format check and the private installed-package CLI/MCP smoke both pass. Evidence:
`post-eleventh-freeze-async-local.txt`, `...-format.txt`, `...-package.txt`.
This does not replace the frozen candidate's 387-test result or count pending GUI
work as passed. Apex was recorded as a future output-plugin target at Karl's
request; no Apex implementation was added to this scope.

## Initial source reads use the same bounds

The shared reader now also serves initial parsing/discovery and lazy source
loading. It enforces the byte cap while reading, not only from a pre-read stat,
and rejects nonregular files. Worker-side and coordinator-side adapters share
one size/type policy. The two-MiB exact boundary, oversized input, FIFO input,
UTF-8 preservation, cancellation, large inventories and MCP source reads pass
28 focused checks in `post-eleventh-freeze-source-reader-final.txt`.

A test initially assumed the low-level loader returns a diagnostic for I/O
failure; its actual contract is to throw, with the analysis/session layer owning
the diagnostic. The acceptance check now asserts that rejection directly.
A missing retained `stat` import was caught by the build and restored before the
focused run. These were not counted as passing attempts.

The consolidated local run after shared source reading passes **397 tests with
no skips**. The independently frozen candidate remains byte-identical at all
2,240 manifest entries. The new source modules are main-workspace follow-up work,
not changes to the review input.
