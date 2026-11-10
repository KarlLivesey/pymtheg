# Current completion audit — not complete

The latest independent review rates Pymtheg **about 8.8 overall**; no area earns
9.5. That score belongs to the frozen fifteenth candidate, not the subsequent
repairs. [Read the review](../evidence/product-audit/claude-architecture-fifteenth-review.md).
Earlier work and test boundaries are retained in the
[historical audit](completion-audit-through-fourteenth.md).

## What users can do now

Initialize an empty repository, retain existing architecture documents, write
requirements and decisions, and connect those plans to checked `.pym` declarations.
Use Blocks or Text to build component signatures, records, outcomes, operations,
resource lifecycles and finite event models. Inspect real findings, edit lifecycle
rules, and recover unfinished forms after a restart.

Capture TypeScript/JavaScript code without executing it; inspect planned and
observed graphs, compare named versions, see simultaneous missing/changed
conditions, and explicitly review individual links. **Existing-code reading is
TypeScript/JavaScript only.** Rust and Go are output targets, not code readers.
Generate fail-fast stubs or separate contracts for TypeScript, Rust and Go;
registered output plugins add targets. MCP exposes the same local design work.

## Latest independent scores

| Area | Fifteenth score |
|---|---|
| Specification semantics and honest evidence | 9.0 |
| Architecture, planning and history | 8.8 |
| Blocks authoring | 8.8 |
| Plan/code graphs and review | 8.7 |
| Agent MCP | 8.9 |
| Output contracts and scaffolds | 9.0 |
| Recovery and concurrency | 9.0 |
| Scale | 8.7 |
| GUI accessibility and cross-browser use | 8.2 |

## Repairs and current evidence

The [fourteenth follow-up](fourteenth-review-remediation.md) retains earlier
repairs. The [fifteenth follow-up](fifteenth-review-remediation.md) tracks the
new range, focus and loading defects against their concrete checks.
The latest completely integrated candidate checks are:

| Boundary | Observed result / retained evidence |
|---|---|
| Local regression suite | 598 passed, zero failed/skipped including atomic range edits; `parent-range-full-local.txt` |
| Real compiler/backend suite | 89 passed, zero failed/skipped; `parent-range-integration.txt`. |
| Offline installed package | Current private tarball smoke passed; `parent-range-package.txt`. |
| Whole Chromium GUI suite | 98/98 current journeys passed against unchanged candidate; per-journey log and fingerprints: `parent-range-full-gui/journeys.json` |
| Modal guard and Apply focus | Actual keyboard save, inert background, no save through the dialog, and post-check focus pass; `parent-modal-guard-authorized.txt`, `final-cross-v2-chromium-studio-declaration-authoring.browser.mjs.txt` |
| Firefox / WebKit | Eight selected journeys per engine have passing runs across the retained cross-browser records; these are not full browser suites |

All evidence paths in this table are under `evidence/product-audit/`. Assertions
use state, responses, source results and operation counts rather than required
execution speed. Resource deadlines can leave a check unresolved; they do not
prove correctness.

## What still prevents completion

- The fifteenth review reproduced the original Firefox failure: loading moved
  the graph button between pointer selection and dispatch. The original failure
  remains retained; a fixed header layout now passes a deterministic held-response
  click test in Chromium, Firefox and WebKit.
- Real screen-reader interaction remains unverified. The initial isolated AT-SPI
  probe could not start its registry; the follow-up probe is recorded separately.
  axe scans and keyboard tests are not a substitute for screen-reader evidence.
- Some authoring defaults remain generic example names/types. Richer operation
  editing of existing operation contracts and wholesale event definitions still uses Text.
- Code reading remains TS/JS only; observed structure is not proof that an
  implementation satisfies its design. Generated contract checks must be added
  to the user's build.
- Broad real-user, large-project GUI and platform coverage remains limited.
  No new independent score has been assigned to the repairs.

The goal remains a useful, understandable architecture designer with a polished
GUI and honest evidence in every supported area. Green tests alone do not meet
the requested 9.5 bar.

## Work after the fifteenth review freeze

The completed fifteenth review used an immutable candidate. Separate working-tree
changes now provide contextual creation guidance, optional operation caller
rules and assumed return guarantees, and a BigInt-safe human report renderer.
Both real backends explicitly identify external postconditions as assumptions.
A 130-file test confirms that strengthening one shared operation rule affects
128 callers and the dependent plan while leaving an independent plan clear.

The consolidated code/build/test fingerprint stayed unchanged through all
584 local tests, 82 real integrations, the offline installed-package check,
and formatting. Exact evidence is in
`evidence/product-audit/post-fifteenth-consolidated-validation.json`.

Focused current GUI checks pass in Chromium, Firefox and WebKit for range
counterexamples, Discard focus, loading clicks, gap status and operation rules.
The complete 98-journey sweep passes on an unchanged candidate. Existing numeric-state bounds
now have a recoverable paired editor; [its draft/source contract](state-range-authoring-map.md)
and extended three-engine journey cover partial input, stale states, source
undo and a real counterexample/corrected simulation. One unrelated Firefox startup failure is retained
alongside its successful diagnostic rerun. Screen-reader use remains unverified.

The executable authoring self-model separately finds a premature-publication
counterexample and exhausts 130 states of the guarded policy. That is finite
policy evidence, not proof that the React/worker/persistence implementation
conforms to the model. See
[the operation-authoring map](operation-contract-authoring-map.md).

The latest consolidated boundary is in
`evidence/product-audit/range-consolidated-validation.json`: 598 local tests,
89 real compiler/backend tests, 98 GUI journeys, formatting and private-package
smoke pass. Every GUI journey has its own result/log and the candidate
fingerprint stayed unchanged. This validates recorded behaviour, not a new
independent usability score. The exception-only Orca probe remains unrun pending
explicit approval; headless-only policy has not been bypassed.

## After the sixteenth freeze: explicit type choices

A newer working-tree authoring change removes silent Text defaults when adding
inputs, fields, list elements and outcome payloads. Unanswered choices remain
recoverable drafts, and preview refuses them with a specific field/input error.
Existing complete forms remain compatible. Local tests pass 603/603 and the
focused real MCP and private-package checks pass; updated GUI validation is pending.
Do not apply the frozen candidate's 98-GUI result to this newer code. See
[the draft contract and evidence](unfinished-type-authoring-map.md).

The unfinished-type follow-up exposed and fixed a conflict-view crash before
browser testing: both data-shape and interface comparison screens attempted to
write an unanswered type as source while rendering. Real component-render tests
failed before and pass after the display-only formatter. The 603-test local
boundary and formatting pass; browser interaction for these newer paths is
still pending. Frozen-candidate GUI evidence does not cover this newer work.
