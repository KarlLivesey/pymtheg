# Current completion audit — not complete

The latest independent review rates the frozen sixteenth candidate **about 8.9
overall**, with no area at 9.5. That score does not grade later working-tree
changes. [Read the review](../evidence/product-audit/claude-architecture-sixteenth-review.md).
Earlier audit text is retained in [the prior audit](completion-audit-before-sixteenth-remediation.md).

## What users can do

Initialize an empty repository, retain architecture documents, author requirements
and decisions, connect plans to checked `.pym` declarations, and compare retained
plan/code versions. Blocks and Text share source, undo and recovery. Forms create
components, types, operations, resources and finite event models. Resource
lifecycles, shared types, signatures, operation rules/work and numeric state
ranges can be edited.

Capture TypeScript/JavaScript code without executing it; inspect observed and
planned graphs, missing work, stubs, changed links and source differences.
**Existing-code reading is TS/JS only.** TypeScript, Rust and Go are output targets,
with extensible registered plugins and fail-fast or explicitly empty stubs.
Generated contracts still require integration into the user's build and do not
prove production behaviour. MCP exposes local analysis, findings and previews.

## Latest independent scores

| Area | Sixteenth score |
|---|---|
| Specification semantics and honest evidence | 9.1 |
| Architecture, planning and history | 8.8 |
| Blocks authoring | 8.9 |
| Plan/code graphs and review | 8.8 |
| Agent MCP | 9.0 |
| Output contracts and scaffolds | 9.1 |
| Recovery and concurrency | 9.1 |
| Scale | 8.9 |
| GUI accessibility and cross-browser use | 8.2 |

The frozen review contained 5,896 fingerprinted files. The reviewer reran
598 local and 89 real compiler/backend tests, reproduced fresh user journeys,
and verified unchanged fingerprints. The parent's 98-journey GUI sweep is
carried evidence, not the reviewer's own sweep. Neither is a claim about every
newer source change.

## Working-tree repairs after that freeze

- Unanswered type choices replace silent Text defaults for new value slots.
  Recovery retains them, and preview refuses incomplete types. Conflict views
  use a separate bounded display formatter, so an unanswered saved type does
  not crash comparison or become generated source.
- N1: out-of-range constant starting values produce a located B012 design error
  in the canonical check. The range form warns before Apply. Replay and local
  constant checking share the scalar evaluator.
- N2: precondition obligations use real line and column, including CRLF/Unicode.
- N3: Apply range retains editor focus during rechecking, then focuses Minimum.
  Immediate and completed-check focus are tested separately.
- N4: object-literal function/arrow properties are observed with their own calls;
  reader identity is now v3. Complex CommonJS aliasing remains explicitly
  unresolved rather than guessed.
- N6/N7: planning recovery uses title/kind, disabled Add has visible guidance,
  and record/document linking is distinguished from checked-component linking.
- Existing operation rules and symbolic cost summaries have guarded source,
  Studio API and MCP previews, plus a recoverable Blocks editor. Final focused
  Chromium, Firefox and WebKit journeys pass.

- N5 and N8: replayed failures survive unused scope warnings; agent errors now
  distinguish unknown declarations, stale observations and malformed edits.
- N9/N10: supported scalar operation guarantees help consuming calls, with
  assumption provenance; inconsistent guarantees produce located V002 errors.
- N11–N13: repeated related locations are removed, range-caused invariants point
  to the event, formatter syntax errors give locations/exit 1, and Revert explains
  that range form drafts are retained.

Exact boundaries and original failures are in
[sixteenth-review-remediation.md](sixteenth-review-remediation.md),
[unfinished-type-authoring-map.md](unfinished-type-authoring-map.md) and
[operation-editing-map.md](operation-editing-map.md).

## Validation boundary

The repaired candidate passes **632/632 local tests** and **95/95 real
compiler/backend integrations**, with no failures or skips. Formatting and the
offline private-package check pass. A real MCP check/fix/recheck journey confirms
that contradictory guarantees fail, a sufficient guarantee reports its assumption,
and unrestricted values remain unresolved, without changing source files.

The preceding 628-test candidate was withdrawn after an adversarial Boolean
contradiction probe; its partial GUI sweep is not counted as a pass. The repair
is also checked against 441 independently enumerated integer cases and 144
Boolean truth-table cases. All **101 GUI journeys pass across two recorded batches**. The first 64 pass
on the same production build as the remaining 37. The only inter-batch file
change is the corrected guide test, which now verifies the missing-type refusal,
chooses the type and waits for a ready pointer target. Both manifests and the
complete per-journey table are retained in `seventeenth-gui-validation.json`.
Focused operation-editing journeys pass in Chromium, Firefox and WebKit,
including partial-expression recovery, external changes, explicit conflict review,
caller findings, narrow accessibility, focus and undo.

All assertions use state, exact source/results, acknowledgement handshakes or
deterministic counts; elapsed resource limits are not correctness criteria.
Original failure logs are retained and distinguished from corrected runs.

## Remaining work

- Obtain another independent frozen-candidate review and address its findings.
- Real screen-reader interaction remains unverified. An isolated Orca probe is
  prepared, but its required headless-policy exception has not been approved.
  It has not run. Axe and keyboard tests do not replace screen-reader evidence.
- Broader platform, heterogeneous-project and user evidence remains limited.

The goal remains a useful, understandable architecture designer with a polished
GUI and honest evidence. Passing tests alone do not establish the requested
9.5 quality bar, and no replacement score has been assigned to these repairs.


## Changes after the seventeenth review input was frozen

The provisional CLI/source-extension boundary is now shared across browser and
Node code through `shared/identity-values.ts`, retaining the existing identity
re-export. A real alternate-extension probe exposed hardcoded discovery, scenario
and collision-filename behavior; those now follow the central values. Public
names and persisted protocol/storage formats are unchanged.

633 local tests, 95 real compiler/backend tests, six default-behavior comparisons,
formatting and private-package checks pass.
See [the rename evidence](../evidence/product-audit/parent-rename-boundary/README.md).
This change is outside the frozen review candidate; its focused GUI validation
waits until the independent reviewer releases browser use. Do not attribute the
frozen build's 101 GUI journeys to this newer working tree.

The [machine-readable acceptance map](../evidence/product-audit/parent-release-gates.json)
links every original R01–R16 requirement and the F01–F15 release gates to evidence
and remaining limits. It records the current runtime fingerprint separately
from the older GUI/review snapshot, and explicitly keeps overall acceptance
unproven.
