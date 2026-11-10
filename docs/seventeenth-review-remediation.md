# Seventeenth-review remediation and evidence

The independent score remains **8.6**, with no area at 9.5. These are implementation
repairs awaiting a new independent review, not a replacement rating.

| Finding | Repair | Evidence / boundary |
|---|---|---|
| S17-1 stale-tab overwrite | Buffer-owned save bases; metadata events cannot authorize a stale write | Four real browser cases plus deterministic ownership races; stale saves return 409, preserving both sides |
| S17-2 real-code retention | Compact manifest and exact per-file graph/source parts | 1,000 real files captured in production worker, retained and reloaded |
| S17-3 repeated graph storage | Reuse content-addressed parts; remove inactive parts from active native inventory | Nine named captures plus one edit: 30,927,058-byte full history, exactly one replaced part and 999 reused; legacy observations remain readable |
| S17-4 hidden uncertain preconditions | Located C006 warning and bounded scalar candidate arguments | Local and real agent check/fix/recheck; property remains inconclusive and witness explicitly unvalidated for joint reachability |
| S17-5 keyboard Preview | Keep trigger focusable, announce busy state, reject repeat activation | Earlier four-form checks pass in three engines; current Chromium/WebKit pass, final Firefox repeat crashes natively before page creation and is unresolved |
| S17-6 rule notes move | Original clause indices survive form removal/addition/recovery and guarded rewrite | Source tests preserve surviving rule/work notes, mark removed-clause notes, reject invalid origins; old callers match unchanged clauses first |
| S17-7 renamed operation draft | Actionable 409 names operation/file; keep draft and offer download | Real HTTP checks cover describe/preview; source stays untouched |
| S17-8 anonymous graph targets | Retain normalized target names and target origins; disclose record/page truncation | Known unshadowed builtin / package / local binding / unknown distinctions tested, including a shadowed Error; origin does not imply runtime resolution |
| S17-9 evidence paths/wording | Display project-relative provenance; zero-input guarantee refers to the call | Stored evidence remains unchanged |
| S17-10 medium header | Deliberate full action row; decorative brand text hidden from accessibility name | Geometry checked at 390, 500, 980, 1024, 1100, 1200 and 1280px |
| S17-11 whitespace | Remove empty owned clause lines; avoid adding a third separating newline | Canonical-format assertion in block save journey; untouched handwritten source is preserved |

## Failed attempts retained

- The save bug was first reproduced as a 200 response where 409 was required.
- Two larger repeated-source capture corpora hit the existing AST visit limit.
  They are refused complexity cases, not storage passes; file count alone never
  establishes capacity for every corpus.
- The initial Preview test stalled between forms and tried keyboard activation
  before the declaration context loaded. Instrumentation identified missing form
  readiness. Its stopped runs remain.
  The corrected test uses the existing Close action and explicit enabled readiness.
- A full GUI controller launched outside the required helper was rejected by
  automatic approval review. It did not run. The replacement puts the entire
  controller inside `pc-tools headless`, in bounded groups of distinct journeys.
- A block-focus test inspected transient `:focus` as an input before the new
  projection arrived. It now waits for the exact field value and requires focus
  on that field; the failed assertion is retained.
- Final inspection found a browser-only Buffer reference in the new document
  shape validator. The initialized-project journey independently reproduced it.
  Restoring the browser-safe shape validator preserves the existing server-side
  UTF-8 limits. The full GUI boundary restarts on this correction, under the
  `parent-s17-fixed-gui-*` evidence directories. Earlier runs are not relabelled.

## Accessibility without a display exception

At Karl's request, the proposed virtual-display/Orca exception is no longer
pursued. A genuine-headless Firefox probe, with a confirmed ready private AT-SPI
registry, exposes real browser accessibility names/roles/values/focus but no native
applications for Orca. No display server, desktop connection or audio was started.
Browser-tree, keyboard and axe evidence remain distinct from unverified real
screen-reader use. See [the headless findings](../evidence/product-audit/assistive-probe/headless-findings.md).

## Current validation

The machine-readable [validation record](../evidence/product-audit/parent-s17-validation.json)
lists exact logs, per-journey results, retained failures and remaining work. It is
now complete: all 104 current registered GUI journeys pass on the corrected
runtime, with the same manifest in all six bounded groups. Local/real-backend/package/format results have their own boundaries;
nothing here assigns a new score or proves production-code conformance.
