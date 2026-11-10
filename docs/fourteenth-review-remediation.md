# Fourteenth review follow-up

The independent frozen-candidate review scored approximately **8.7 overall**,
with no area at 9.5. It ran 529 local tests, 74 real integrations and a complete
Blocks journey. The changes below happened afterwards; they have no independent
replacement score. Evidence files are under `evidence/product-audit/`.

| Finding | Current work and evidence |
|---|---|
| D1 simultaneous gaps hidden | Implemented. Independent per-link/record conditions and overlapping counts retain missing code, unknown coverage and plan/code changes together. Eight masking/aggregation cases and real graph list/detail/count journeys pass. `parent-fourteenth-gaps-ui.txt`; preserved Firefox failure discussed below. |
| D2 Apply loses focus | Implemented. Exact file/text-bound request waits for checked Blocks projection or returns to Text. Declaration, interface and lifecycle Apply retain editor focus. `parent-fourteenth-declaration-ui-fixed.txt`, `parent-fourteenth-resource-ui.txt`; latest modal-boundary check `final-cross-v2-chromium-studio-declaration-authoring.browser.mjs.txt`. |
| D3 saved files labelled draft | Implemented. Status derives from actual recovery differences. Real save/recovery/revert journey passes. `parent-fourteenth-revert-ui-fixed.txt`. |
| D4 Blocks save shortcut | Implemented. Ctrl/Meta-S saves in Blocks outside dialogs. Declaration dialog now participates in the modal guard; the regression checks background inertness and actual absence of a save request. `parent-modal-guard-authorized.txt`. |
| D5 new form labelled resumed | Implemented. Resume state captured when opening the form. Fresh and reopened forms are distinguished in `studio-save-basics.browser.mjs`. |
| D6 narrow banner overflow | Implemented. Message rows wrap and actions fit. Actual Discard geometry checked at 390 px, also exercised in Firefox and WebKit. |
| D7 false empty state while loading | Implemented. Explicit loading state; held-response probe passes. `parent-fourteenth-planning-ui-fixed.txt`. |
| D8 guessed defaults | Partial. New effect targets start blank; Declined no longer silently gains a String payload. Generic editable field names and String starting types remain. They are authoring defaults, not inferred facts. |
| D9 cancellation transition guidance | Implemented. Ownership evidence marks cancellation cleanup and explains prior cleanup. Repeated Closed→Closed is suggested only if a no-op matches the actual API. `parent-fourteenth-explanations.txt`. |
| D10 unfinished link silently dropped | Implemented. Save requires Add link or clearing the pending target; the real planning journey checks persisted relationships. `parent-fourteenth-planning-ui-fixed.txt`. |
| D11 lifecycle conflict merge | Implemented. Shared validation plus explicit conservative three-way combination of independent changes; conflicting states/references remain unresolved. Source tests and restart GUI journey pass. `parent-fourteenth-resource-merge-local.txt`, `parent-fourteenth-resource-merge-ui.txt`. |
| D12 MCP write responses/review assertion | Implemented. Compact revision receipts; linking requires `reviewed:true` and retains normal hash guards. Real protocol tests check receipt size and preserved history. `parent-fourteenth-mcp-receipts.txt`. |
| D13 revert to saved | Implemented. Both modes offer explicit comparison, Keep, or Discard. Discard triggers a fresh check even with auto-check off. `parent-fourteenth-revert-ui-fixed.txt`; original missing-recheck failure retained. |
| D14 blank-line runs | Implemented. Normalize LF before parsing, preserve tokens/comments, retain at most one blank line. Formatter/source tests and full GUI boundary exercise this. |
| D15 restored Blocks premature request | Implemented. Only completed current-client runs are used; restored runs recheck before requesting Blocks. Actual restart test asserts no unavailable Blocks response. `parent-fourteenth-recovery-ui.txt`. |
| D16 omitted diff line count | Implemented. Bounded diffs report omitted lines per side; test replaces 10,000 lines and checks 9,700 omitted. Long individual lines remain separately qualified. |

## Additional authoring integration

Cross-file type selection exposed cached unchanged buffers bypassing disk
freshness. The shared unsaved-buffer policy now excludes unchanged cached
copies; it retains edited, new, deleted and explicitly recovered buffers.
The real import/restart/stale-source journey passes in Chromium, Firefox and
WebKit. A deterministic traversal-count test covers the shared one-pass filter.

Finite event-model creation shares source preview, canonical checking and
recovery. GUI journeys create, restart, find a real counterexample and correct
it. Four real Quint/TLC probes also pass. The exact 100,000-type discovery
boundary has separate production tests and a small executable self-model;
the model is not claimed to prove scanner implementation correctness.

## Integration evidence and qualifications

- Current local boundary: **575/575**, no skips, `parent-fourteenth-final-local.txt`.
- Real compiler/backend boundary: **78/78**, no skips, `parent-fourteenth-final-integration.txt`.
- Private installed package: passed, `parent-fourteenth-final-package.txt`.
- Formatting: passed after formatting the new test,
  `parent-fourteenth-final-format-fixed.txt`; initial formatting failure retained.
- Previous complete Chromium boundary: **94/94**, fingerprint
  `5994e1f83561c6d45aa7abe9b8f0fc9d989a381327bfdd73b11ac0b2ab18684c`.
  This predates the additional declaration-modal guard. The final full sweep
  also passes **94/94**, including the guard, on unchanged fingerprint
  `99d912196c3ae299599091d0c86e4ff0da04932d3170e9f67ceb9234d5cc01ef`; record
  `parent-fourteenth-final-gui/journeys.json` holds each journey result.
- Cross-browser record: `fourteenth-final-cross-browser-results.json`.
  Eight selected WebKit journeys pass. Combined earlier/new Firefox records
  cover the same eight journeys. Neither is a full browser suite.
- The original Firefox simultaneous-gaps assertion failed once; an instrumented
  run and unchanged repeat passed. **Cause unresolved.** The failure remains
  in `cross-firefox-studio-simultaneous-gaps.browser.mjs.txt`.
- Screen readers remain unverified. The initial isolated AT-SPI probe failed
  registry activation. A private directly owned bus started, but headless
  Firefox exposed no application tree before the bounded run ended. Neither
  result establishes product accessibility or an accessibility defect.

The new work does not receive a 9.5 from these test counts. Real-user usability,
assistive technology, wider platform coverage and the residual authoring scope
remain explicit. Full source/build/test manifests distinguish each boundary.
