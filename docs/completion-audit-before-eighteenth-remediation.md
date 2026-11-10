# Current completion audit — not complete

The latest independent review rates the frozen **seventeenth candidate about 8.6
overall**, with no area at 9.5. The reviewer explains that newly exercised
multi-tab, real-code-scale and keyboard journeys exposed previously untested
problems; the score change does not establish a regression from the sixteenth.
[Read the review](../evidence/product-audit/claude-architecture-seventeenth-review.md).
The [previous completion audit](completion-audit-before-seventeenth-remediation.md)
is retained as history. These scores do not grade the repairs below.

## What users can do

Initialize an empty repository; retain architecture documents, requirements,
decisions and history; connect plans to checked `.pym` declarations; compare
selected plan/code versions. Blocks and Text share source, undo and recovery.
Forms create components, types, operations, resources and finite event models,
and edit lifecycles, types, signatures, operation rules/work and state ranges.

Capture TypeScript/JavaScript without executing it, inspect planned/existing
code graphs and structural gaps, and review exact linked source differences.
**Code reading is TS/JS only.** TypeScript, Rust and Go are output targets, with
registered output plugins and compile-ready fail-fast stubs by default. Neither
code presence nor generated contracts prove production behaviour. Contracts must
be added to the implementation's build. MCP exposes local analysis and previews.

## Latest independent scores

| Area | Seventeenth score |
|---|---:|
| Specification semantics and honest evidence | 9.1 |
| Architecture, planning and history | 8.6 |
| Blocks authoring | 8.9 |
| Plan/code graphs and review | 8.3 |
| Agent MCP | 8.8 |
| Output contracts and scaffolds | 9.1 |
| Recovery and concurrency | 8.2 |
| Scale | 8.1 |
| GUI accessibility and cross-browser use | 8.1 |

The frozen review matched 6,433 manifest entries and reproduced identical builds,
632 local tests and 95 real compiler/backend tests. The reviewer reran eight of
101 recorded GUI journeys and completed fresh beginner/agent/compiler journeys.
Those results apply to the frozen candidate, not the current working tree.

## Repairs after the review freeze

- Public CLI/source naming now follows the shared identity values. Default-name
  semantic comparisons, alternate-extension package/agent/Studio checks and
  633 local / 95 real tests passed before the save/storage repairs.
- **S17-1:** each source buffer retains its own save base. An event from another
  tab cannot silently rebase stale text. Four focused browser scenarios cover
  both stale edit orders, an operation form, and typing during an owned save.
  Stale saves return 409 and preserve both sides; the owned acknowledgement
  permits saving newer typing. The save repair passed 636 local tests and four
  existing save/authoring/recovery browser regressions.
- **S17-2/S17-3:** code observations now use compact per-file graph/source parts
  and a version manifest. Unchanged parts share existing content blobs. Legacy
  monolithic observations remain readable. Nine named 1,006-file captures plus
  one later edit export and reload in a separate database in 29,760,852 bytes;
  the edit replaces one part and reuses 1,005. The corpus contains two full real
  source/UI copies and additional real shared modules. Larger all-source-copy
  attempts hit the separate existing AST work limit; those failures are retained.
  This does not establish unlimited capture capacity.
- **S17-5:** Preview keeps its keyboard trigger focus while a request runs,
  announces the busy state and guards repeated activation. The four-form focused
  journey passed in Chromium, Firefox and WebKit on the earlier build; current
  Chromium/WebKit pass while the later Firefox crash is now diagnosed as compositor thread-creation exhaustion;
  capped test pools pass the same focused journey.

The corrected current local suite passes **645/645**, and **95/95 real compiler/backend
integrations** pass without skips. Formatting and the offline private-package smoke pass. The final reader/storage probe retains **1,000 real files**,
nine labels and one later edit in **30,927,058 archive bytes**, changing one part
and reusing 999. **All 104 registered Chromium GUI journeys pass** in six bounded groups, with the
controller itself inside `pc-tools headless`. Every group has exactly the same
runtime/test manifest hash: `d3185b29e494bd2d454c0154a349cce9c266816a505272a779297f0a2ec04e5a`.

- **S17-4:** located C006 findings expose bounded scalar candidate bad arguments;
  the property remains inconclusive with an explicitly unvalidated witness.
  Core and real MCP check/fix/recheck tests pass without disk edits.
- **S17-5:** all four Preview forms retain focus before/after a held response in
  the earlier Chromium/Firefox/WebKit runs. Current Chromium and WebKit repeat
  checks pass. The Firefox core now identifies failed SwComposite thread creation
  (EAGAIN) under shared task pressure; a capped test profile passes the same
  assertions. The failed run remains retained. Repeat activation is guarded while busy.
- **S17-6/S17-7:** origin mappings keep surviving clauses with their own notes;
  missing operations return actionable 409 responses and preserve downloadable
  drafts. Focused source and HTTP regressions pass.
- **S17-8:** reader v4 classifies target origins separately from resolution,
  normalizes chained names, and discloses relationship-list truncation. Shadowed
  builtins are not misclassified. Partial coverage remains honest.
- **S17-9–S17-11:** evidence displays project-relative paths, zero-input guarantee
  messages refer to the call, medium headers use a deliberate action row, and
  clause removals/declaration additions avoid introducing empty whitespace lines.

The GUI sweep exposed a test that asserted against transient `:focus` while the
new block projection was still loading. The repaired test waits for the exact
new field value and requires that field to be focused. The failed run is retained;
production code was unchanged by this test repair. A separate final browser
validation found a Buffer reference in my new document shape validator; that is
corrected while retaining the existing server-side byte limits. The full GUI
boundary restarts under `parent-s17-fixed-gui-*`, with earlier logs preserved.
All corrected-build groups have now finished successfully. Earlier failures
remain retained and are not counted as passes.

Full finding/evidence map: [seventeenth-review-remediation.md](seventeenth-review-remediation.md).

Evidence: `evidence/product-audit/parent-s17-two-tabs-connected.txt`,
`parent-s17-save-base-full-local.txt`, `parent-s17-storage-full-local.txt`, and
[`parent-s17-code-storage/`](../evidence/product-audit/parent-s17-code-storage/).

## Remaining work

- Obtain another independent frozen review before treating these repairs as
  independently accepted. Automated acceptance is complete for the recorded
  boundary; the independent score remains 8.6 and no area is assigned 9.5.
- Real screen-reader interaction remains unverified. Karl requested a route
  without the virtual-display exception, so that proposal is no longer pursued.
  A genuine-headless Firefox probe with a confirmed ready private registry
  exposes real browser accessibility roles/names/focus, but no native AT-SPI
  objects for Orca. Browser-tree, axe and keyboard tests stay separate from
  screen-reader evidence. See `assistive-probe/headless-findings.md`.
- Broader platform, heterogeneous-project and user evidence remains limited.

The current [validation record](../evidence/product-audit/parent-s17-validation.json)
contains all 104 per-journey results and their matching manifests.

The [machine-readable acceptance map](../evidence/product-audit/parent-release-gates.json)
and its earlier runtime manifest predate these repairs. They remain historical
inputs and do not certify this working tree. No replacement score is assigned.


## Additional headless evidence before the eighteenth review

The saved Firefox core's `gMozCrashReason` identifies failed SwComposite thread
creation (EAGAIN), rather than a product error before navigation. The test-only
launcher caps content pools, disables prelaunch and renderer multithreading, and
keeps software rendering within the unchanged pc-tools resource limits. The
four-form focused journey passes with that configuration. No desktop settings or
security sandbox were changed. Karl requested no further Firefox investigation.

The pinned development-only Guidepup virtual screen reader now drives a real
headless Studio workflow: reading order, inert-background isolation, native
browser accessibility-tree cross-check, name editing, preview, apply, editor
focus and unchanged disk. This is a simulator, distinct from native Orca or a
human screen-reader assessment. The new journey is registered alongside the
existing 104. `parent-eighteenth-validation.json` records which evidence was
rerun and which applies by unchanged production fingerprints. No new score is
assigned before independent review.
