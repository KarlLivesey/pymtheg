# Fifteenth review follow-up

The independent frozen-candidate score is approximately **8.8 overall**, with
no area at 9.5. The review and original evidence remain unchanged. This ledger
covers later repairs and keeps untested work explicit.

## D1: range violations are design counterexamples

The backend already includes declared state ranges in its safety condition.
Replay incorrectly rejects the final out-of-range value before establishing
that it follows the source transition. Resolve that semantic mismatch:

- Initial and intermediate states must stay in the declared domains.
- Every transition, including the final one, must equal source evaluation.
- Only the final state may leave a range, and only as the exact result of a
  declared event from a valid state. Reject continuations past that first error.
- Generated internal flow-state identifiers keep strict domain rejection;
  they are implementation metadata, not user-declared numeric state.
- Report a violated source-machine domain as an explicit behavioural property. A range
  failure has exit 1, a diagnostic on the assigning expression, the declared
  range and value, and the same source-replayed event trace.
- Other properties retain their own status; a run stopped by the domain failure
  does not prove unrelated invariants. A declared invariant that can safely be
  evaluated at the final state may report its own violation too.
- Preserve snapshot/source-map validation and reject corrupt or invented values.

First probes: upper/lower overflow, a larger exact jump, legal boundary values,
corrupt final value, continuation after overflow, an invariant that stays true, simultaneous
updates, and CLI/MCP/Studio reporting. Local checking may later add a conservative
warning, but no warning substitutes for the real counterexample.
The existing requirement for a declared invariant remains unchanged; this repair
does not silently broaden the accepted machine subset.

## Other findings queued

- D2: explicit post-discard focus target after current checked projection.
- D3: reserve architecture-action geometry during loading; deterministic held
  response/click regression. The original Firefox failure now has a reproduced
  layout-shift cause, not a status calculation defect.
- D4: stale authoring/formatter documentation.
- D5–D13: CommonJS observation, beginner wording, existing event ranges,
  deliberate defaults, specific MCP errors, independent state additions,
  remaining naming/formatting and console-noise findings.

This queue records the starting hypotheses. Verified repairs are described
below; none implies a new independent score.

## Current checks

D1 passes source replay, real Quint/TLC upper/lower/guarded cases, real MCP
trace retention, and a Blocks-only creation/overflow/guard-correction journey.
The initial no-invariant unit fixture conflicted with the published machine
subset; it now uses an always-true invariant to isolate domain checking. The
first MCP fixture used `items` instead of the protocol's `steps`; its failure
and corrected run are retained separately.

D2 and D3 first passed their focused Chromium journeys. The held-response test
reproduced the original 340 px/23 px movement before the grid layout fix; no
timer or computer-speed assertion is used. Subsequent cross-browser checks
are recorded below.

The separate operation-rule GUI journey exposed a real accessible-name defect
on restart: textarea contents became part of its implicit label. Explicit
accessible names corrected it; the later complete journey passes and data
recovery itself was correct. The first failure and instrumented DOM evidence remain.

The potential headed accessibility probe has only had its local, verified
binaries prepared. No display or headed browser was launched, and no exception
to Karl's headless-only policy has been granted or assumed.

Firefox passed the Discard-focus and held-response click tests. The subsequent
simultaneous-gap run failed at `browserContext.newPage`, before navigating to
Pymtheg (`fifteenth-firefox-studio-simultaneous-gaps.txt`). It is retained as a
failed browser-startup attempt, not a product pass or a reproduced UI defect.
One unchanged-assertion rerun with browser-process logging is recorded separately.

The unchanged Firefox gap test passed under browser-process logging, including
normal process exit. The prior context-creation failure remains unexplained
and retained; it happened before page navigation. It is distinct from the
original load-reflow defect, which now has a deterministic reproducer and fix.

## D5: static CommonJS functions and constructor work

Recognize function/arrow assignments to static `exports.name` and
`module.exports.name` paths, plus direct `module.exports = function/arrow`.
Give them relative declaration identities, attribute their body calls to that
function, and use TypeScript's resolved signature only when ordinary symbol
resolution has no observed target. Dynamic computed export names stay outside
this bounded reader; do not guess a runtime target.

TypeScript constructor parameter properties perform field initialization even
when the written body is empty. Classify that structural work as present.
Because these extraction rules change observation content for identical bytes,
bump the reader revision so new and historical observations cannot share a
snapshot identity accidentally. Historical observations remain readable.

D5's static CommonJS functions and parameter-property constructors pass focused
source tests. A new reassignment probe exposed an initially optimistic target
choice; targets are now resolved only when there is one observed implementation.
Symbol decisions are cached, and resolved-signature fallback is used only when
normal symbol resolution has no target. The first HTTP comparison rerun was
blocked by sandbox `listen EPERM`; its log is retained separately.

## D6, D9–D11, D13 follow-up

The blank-project recipe now says "Blank design" and points to forms/Blocks,
without requiring notation knowledge. Invalid link IDs and stale plan hashes
have different actionable MCP errors. Additive state-list edits combine in a
deterministic order when both retain the original states/order; removals and
conflicting initial-state edits stay guarded. Focused source/MCP tests pass.

Rust reserved callable names use a snake-case suffix without stealing an
existing source spelling. A real `rustc --deny warnings` regression failed
before the fix and passes afterwards. Studio configures Zod's supported
no-JIT mode before parsing; its five-view accessibility journey passes with
no runtime-eval CSP violations recorded.

The strengthened lifecycle GUI fixture initially expected its former default
transition target after adding a new state. It is corrected to select both
endpoints explicitly; that harness failure is retained separately.

## Current GUI boundary

The focused range-error, Discard-focus, held-response loading, simultaneous-gap
and operation-rule journeys pass in Chromium, Firefox and WebKit. One Firefox
startup failed before opening a page; the unchanged diagnostic rerun passed
and both attempts are retained. This is not a new complete GUI sweep.

The operation-rule restart failure was an unstable textarea accessible name;
explicit names fix it and the full restart/finding/correction journey passes.
The independent-state merge also passes its real restart/preview/application
journey after the fixture explicitly selected its intended transition target.

At that checkpoint, bound editing, deliberate/default field choices, formatter
polish, complete integration and real screen-reader evidence remained open.
The later bound-editing and integration results are recorded below. The prepared virtual-display binaries have not been launched.

The complete local boundary now passes 593/593 after these repairs. Full current
backend/package/GUI boundaries remain to run after the remaining range-editing
work. Its design is in `state-range-authoring-map.md`; incomplete numeric input
must be a recoverable atomic range draft, not parser-invalid source written on
every keystroke.

## Atomic existing-state range editor

D7 is now covered by a paired, durable Minimum/Maximum form. Source tests and
a real Chromium/Firefox/WebKit journey cover incomplete input, view/file switch,
restart, validation, a source-confirmed overflow, corrected simulation, one-step
Undo, external state changes and explicit reset. The narrow screenshots have
been inspected. The initial viewport test forgot to scroll before asserting;
its failure remains retained separately. See `state-range-authoring-map.md`.

The integrated boundary now passes 598/598 local tests and 89/89 real
compiler/backend tests, no skips. The current full GUI and package boundaries
are next. No replacement independent score is claimed. The prepared Orca probe
requires an explicit headless-policy exception and remains unrun pending that
answer; its exact plan is `evidence/product-audit/assistive-probe/proposal.md`.

The new consolidated boundary is complete: 598 local, 89 real compiler/backend,
98 GUI journeys, formatting and the installed private tarball passed.
`range-consolidated-validation.json` links each record. The GUI manifest stayed
unchanged, with individual results for every journey. The isolated Orca probe
is still unrun pending the explicit policy exception.
