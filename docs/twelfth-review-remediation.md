# Twelfth review remediation — incomplete

The independent score is approximately 8.7, with no area reaching 9.5.
The report is preserved at
`evidence/product-audit/claude-architecture-twelfth-review.md`.
It verified all 2,575 frozen files, 410 local tests and 74 integrations.
Those results describe its frozen candidate, not subsequent working-tree changes.

| Finding | Current status | Evidence / next check |
|---|---|---|
| T12-1 unrelated source error obscures broken links | Service fix tested: classification uses the expectation's file; previously captured imported files are checked for absence; detail completeness uses its dependency scope | Two regressions plus the existing 2,100-file isolation test pass. Browser planning journey still required |
| T12-2 cannot retire a plan with a broken link | Ordinary edits retain historical expectations; adding/removing a subset uses per-root dependency baselines | Source-subset, root-review and legacy-attribution tests pass; the real GUI retires a plan while retaining missing A and removing B. Unknown legacy attribution remains explicitly conservative |
| T12-3 deleted dirty buffer cannot be reopened | Service and GUI fix tested | Seven service tests pass; frozen GUI reproduces the dead end, current GUI reopens the retained text and completes save-copy and explicit recreation |
| T12-4 empty/removing documentation refresh | Service, CLI and focused GUI checks pass | Tracked empty sources use the normal refresh preview; visible summaries exclude import bookkeeping. Nine focused tests and a real last-document removal GUI journey pass; linked removals still require review |
| T12-5 keyboard-inaccessible report import | Focused GUI test passes | Real button, keyboard-opened chooser and actual report import at 390px. Original UI skips the control; one initial corrected-UI probe hit its budget because of a bad exact-text selector, retained separately |
| T12-6 agent plan impact, schema guidance, cancellation slot | Core fixes tested | Proposed-buffer impact and retained pages, structured search IDs, planId schema guidance and controlled cancel/retry pass; 19 focused MCP tests. Broader independent re-review remains |
| T12-7 remaining newcomer messages | Four reported forms corrected | Await expression, bare call, optional return and reassignment have source-spanned guidance; valid neighbouring syntax retained. Broader authoring review remains |
| T12-8 large-project source search and per-plan selection limits | Partly resolved | A 40-root probe in a >2,048-file repository uses one snapshot and one shared imported declaration. The 32-root limit is replaced by 500 roots under existing parser bounds. Broad indexed source search remains open |

## Additional fixes found while the review ran

Output omissions now share the captured-source coordinate root, even with no
surviving declarations. Contract output preserves cost quality, stability,
atomicity, creation and resource transitions; constraint formatting no longer
creates drift. Trial responses retain interpreter assumptions.

These integrated changes passed 425 local tests, nine targeted real compiler
integrations and an offline installed CLI/MCP package smoke. Exact results:
`evidence/product-audit/parent-integrated-evidence-validation.json`.

The input-edit race has since been reproduced against the frozen UI and fixed
in the current UI using a held real response. Its controlled browser test passes
(`parent-t12-trial-race-original.txt`, `parent-t12-trial-race-fixed.txt`). The
assumptions-display browser test also passes
(`parent-t12-trial-assumptions-gui.txt`). Both use the bounded headless helper,
no startup sleeps or timing assertions. These two journeys are not a substitute
for a new full GUI sweep or accessibility/browser coverage.

No new readiness score or completion claim is justified yet.

Deleted source remains usable as an explicit in-memory analysis input without
being recreated on disk. The normal project-root/path validation still applies.
Recreation sends a create-only save and refuses a path occupied in the meantime.
Evidence: `parent-t12-deleted-buffer-service.txt`,
`parent-t12-deleted-buffer-original.txt`, `parent-t12-deleted-buffer-fixed.txt`,
and the retained dialog screenshot under `parent-t12-deleted-buffer-gui/`.
Keyboard evidence: `parent-t12-keyboard-import-original.txt` and
`parent-t12-keyboard-import-corrected.txt`; the first current-UI attempt in
`parent-t12-keyboard-import-fixed.txt` is not a pass.

Documentation removal evidence is retained in
`parent-t12-doc-removal-before.txt`, `parent-t12-doc-removal-clean.txt` and
`parent-t12-document-removal-clean-gui.txt`. The first screenshot exposed an
internal metadata path in the human summary; the corrected projection keeps
that metadata in the underlying ledger while listing only design documents.
Repeated empty refreshes remain unchanged. The full 429-test local suite passed
before this last documentation-summary change; its nine focused tests pass
afterwards. A broader final validation is still required.
