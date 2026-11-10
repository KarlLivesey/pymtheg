# Current completion audit — not complete

The latest independent review rates the frozen **eighteenth candidate about 8.8
overall**, with no area at 9.5. [Read the review](../evidence/product-audit/claude-architecture-eighteenth-review.md).
It reproduced 645 local tests, 95 real integrations and identical builds, and
checked every one of 7,033 frozen files before and after. Its new journeys found
guard-continuation, live-design drift, async contract, real-code scale and Blocks
maintenance gaps. Those scores apply to that frozen candidate.

| Area | Eighteenth score |
|---|---:|
| Semantics and honest evidence | 9.0 |
| Architecture, planning and history | 9.0 |
| Blocks authoring | 8.8 |
| Plan/code graphs and review | 8.7 |
| Agent MCP | 9.0 |
| Outputs, contracts and plugins | 8.9 |
| Recovery and concurrency | 9.1 |
| Scale | 8.3 |
| GUI accessibility and cross-browser use | 8.6 |

## Current repair candidate

Guard returns refine continuation facts conservatively; supported guard patterns
clear C006 without converting candidate arguments into confirmed executions.
Unknown bound inputs are errors. Code parse errors retain unknown body status
and real line/column locations. Flow/component rules, work budgets and input
bounds can be edited with guarded recoverable forms in Blocks. Parameter-name
changes explicitly warn that existing references need review.

Graph gaps and link comparisons compare live checked design with retained
expectations without modifying historical versions. Design and code change flags
coexist; readable retained `.pym` and current changed declarations are shown.
Effectful TypeScript contracts use Promise results and async fail-fast stubs;
pure contracts remain synchronous. Rust and Go keep their native representations.

Code parts now use a dictionary/tuple encoding with legacy readers. Deterministic
AST budgets degrade per file; coverage on another file cannot conceal a known
missing declaration. A 1,366-file / 10,025,721-byte real TS/JS corpus captures
19,505 declarations and 166,642 edges with complete declaration coverage. Three
captures (one small edit) export in 30,064,944 bytes and all reopen after import.
The graph remains structurally partial where external/dynamic calls are unresolved.
This is bounded evidence, not a universal size guarantee.

The final candidate passes 663 local tests and 96 real compiler/backend tests,
with no failures or skips, plus formatting and the offline installed-package smoke.
All 110 registered Chromium journeys have passed against one unchanged candidate
manifest. One shared-interface attempt reported worker-start EAGAIN; after the
shared slice returned to zero active tasks, the unchanged journey passed. Its
failed log is retained. The focused component form also passes in WebKit.
[Exact per-journey validation](../evidence/product-audit/nineteenth-validation.json)
and [repair/failure record](../evidence/product-audit/parent-n18-remediation.md)
distinguish successful checks and unsuccessful attempts. No replacement score or
9.5 sign-off is claimed. Native screen-reader/human assessment remains unverified;
headless virtual-reader plus browser accessibility-tree evidence is a distinct
boundary. At Karl's request, further Firefox-only investigation is out of this loop.

The earlier audit is [preserved](completion-audit-before-eighteenth-remediation.md).
The repair records below describe the previous round and remain historical evidence.

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
