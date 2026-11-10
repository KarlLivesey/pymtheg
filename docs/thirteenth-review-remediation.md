# Thirteenth review follow-up — not a readiness claim

The independent review scored the frozen candidate about **8.6 overall**, with
no 9.5 in any area. Preserve that report and the frozen build. These changes are
in the main working tree; they have no replacement independent score.

| Finding or major gap | Current result | Evidence / remaining work |
|---|---|---|
| F1 keyboard focus lost after structural actions | Focus retained on move, nearest surviving field on removal, new field on addition | `parent-block-focus-formatted-rerun.txt`; also tests saved canonical source and a held response after a newer Text edit |
| F2 target/reason bleed across plans; no recovery | Per-plan bounded drafts, restart recovery, fresh review required; only saved plan's draft clears | `parent-link-draft-ui-after.txt`, `parent-link-block-local.txt`; first probe's incorrect ID expectation retained separately |
| F3 formatter-dirty Blocks output | Structural edits use existing formatter; failure/stale response does not mutate source | Actual saved file passes canonical equality in the focus journey |
| F4 duplicate outcome action | Direct existing outcome step suppresses convenience action | `parent-duplicate-outcomes-ui.txt`; scope-local guidance, not proof of complete coverage |
| F5 cleared call input becomes invalid | Clearing restores an explicit unknown and survives recheck | `parent-cleared-call-ui.txt`, focused source tests |
| F6 version list navigation | Independent searchable, paged catalogues for plan/code versions; selection survives filtering | `implementation-versions.test.mjs`, `studio-version-search.browser.mjs`; full 86-journey boundary in `version-selection-validation.json` |
| F7 readable old/new code and plan comparison | Exact retained baseline, body/source/static-call-site differences, readable native plans and per-pair guarded acceptance implemented | Focused source/API/MCP and new GUI journey pass; current full integration boundary is being recorded |
| F8 unexplained browser closure | Unresolved | Preserve failure; successful reruns do not establish a cause |
| F9 observe on directory message | Directs user to metadata browsing and explicit file capture | Directory regression in the 499-test suite |
| F10 initial graph loading | Explicit loading state before metadata resolves | Held-response probe in `studio-version-search.browser.mjs` |
| Existing type structure edits | Standalone type form, restart merge and affected constructor check pass | `parent-type-authoring-ui.txt`; root creation still open |
| Broad code selection | Paged metadata discovery and explicit picker pass | `parent-code-picker-ui.txt`; source bodies are only read on explicit capture |
| Root declaration authoring | Create-only component/operation/type/resource forms implemented and exercised | Existing lifecycle editing now passes the source/API/MCP and restart/conflict GUI journeys; full events/machines and cross-file type discovery remain open |

Current full local suite: **499 passed, zero failed/skipped** in
`parent-thirteenth-remediation-local.txt`. Focused GUI results above passed.
The first full GUI sweep stopped at `studio-completion.browser.mjs`: its
entry-point assertion did not guarantee the requested check had finished.
The corrected test waits for startup completion and the specific requested run.
Its isolated journey passes; the failure remains in the first journal.
The fresh sweep passes **82/82** on one unchanged candidate in
`parent-thirteenth-remediation-gui-final/` (manifest
`4f1c6e42cc8c5fac4a72dbb5d717908937b4c977e88e50496a856d3567fd829d`).
The real backend/compiler suite passes **74/74** with no skips, and the offline
installed-package smoke passes. Both ran on this integration candidate before
the status-bar run-ID attribute was added for observable test readiness.
No new backend semantics were introduced by these authoring fixes.

## Browser closure investigation

The exact service log ties the review failure to
`agent-browser-f20a86d90840452fb2959d2041460876.service`, launched with
`test/studio-implementation-graph.browser.mjs` at 04:01:34 UTC. A Chromium
renderer in that unit (PID 2726148) dumped core at 04:01:41 with signal 5
(TRAP). The waiting test then reached the helper's runtime limit at 04:02:35.
The renderer crash preceded that limit; it was not caused by the timeout.
The reason for the renderer trap remains unknown, so F8 is not closed.

Evidence: `parent-thirteenth-browser-exit-unit.txt` and
`parent-thirteenth-browser-coredump.txt`. No core was extracted, no resource
limits changed, and no failed attempt was replaced by a passing rerun.

The project pins Playwright 1.56.1, whose expected Chromium revision is 1194
(141.0.7390.37). The existing GUI scripts use a shared locally installed revision
1234 instead. The exact pinned headless browser was downloaded to
`/tmp/pym-pinned-playwright` for a subsequent focused comparison. This does not
prove the mismatch caused the recorded crash. The current full sweep still uses
the original shared browser, and must be labelled accordingly.

The focused graph journey also passed once with the exact pinned Chromium
1194 browser (`parent-pinned-graph.txt`). That establishes this journey on that
browser; it does not prove the earlier renderer trap is fixed. The consolidated
evidence boundary is `post-thirteenth-authoring-validation.json`.


## Declaration creation integration

The create-only forms and agent previews pass their source/API/MCP tests and
three focused GUI journeys. The full pinned-browser sweep passes 85/85 against
one unchanged candidate; its per-journey journal is
`parent-declaration-pinned-gui/journeys.json`. The matching Chromium executable
is recorded in that journal. The real compiler/backend suite passes 74/74,
and the private package test includes an actual MCP declaration preview.

Follow-up tests then exposed and fixed default input-name reuse after removing
a field, and the creation context returning unpaged types. A 1,000-type real
MCP probe now reaches the last page, and the changed form passes the
remove/add/held-preview GUI journey. These later focused results are distinct
from the 85-journey frozen fingerprint. No replacement readiness score is given.

## Current linked-code comparison boundary

The current working build includes the per-link review dialog, shared read-only
comparison API/MCP tool and explicit acceptance. The 522-test local suite and
offline installed-package check pass. The expanded GUI probe found lost focus
after closing a refused stale review; layout cleanup now restores the opener,
and the unchanged focus assertion passes. The earlier failed log is retained.
The full 87-journey frozen GUI sweep passed. Subsequent focused refinements
prioritize changed lines over giant context and return focus to the selected
record after acceptance. Those later checks have a separate evidence boundary. No replacement score is
assigned, and the older browser renderer crash remains unexplained.
