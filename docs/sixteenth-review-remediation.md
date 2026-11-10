# Sixteenth review follow-up

The frozen sixteenth candidate scored about 8.9 overall, with no area at 9.5.
Its source and evidence remain unchanged. The newer operation-edit API and
unanswered-type follow-ups are outside that reviewed candidate.

## Priority repairs

- N1: a starting value outside its declared domain is a located B012 design
  error in the canonical semantic pass, so `check`, Studio and MCP all retain
  it. Source replay and constant evaluation share the same scalar evaluator.
  The range form warns when proposed bounds exclude the known initial value.
- N2: pending precondition messages use the existing snapshot line/column helper,
  replacing raw byte offsets. LF, CRLF and Unicode-preceded calls are covered.
- N3: a changed block is temporarily unavailable while its source is checked.
  Keep keyboard focus on the editor's persistent status during that interval,
  then focus the same state's Minimum field after the exact projection arrives.
  Do not focus the page body or steal focus if the user moved elsewhere.

The old browser test only checked focus after rechecking. A new assertion checks
it immediately after the source change too; it reproduces the missing focus in
`parent-sixteenth-focus-before.txt`. The two phases are separate obligations.

Local initial-domain, real CLI/MCP and replay/location tests pass in
`parent-sixteenth-initial-location-first.txt`. Browser validation is in progress.
No repaired score or full-candidate validation is claimed by these focused tests.

N1–N3 now pass the extended paired-range journey in Chromium, Firefox and
WebKit. It checks focus immediately during rechecking and after the checked
projection, Enter and Space activation, the before-Apply initial-value warning,
located B012 and correction, and a visible pending precondition at the real
line/column. Full local tests pass 614/614 and real compiler/backend tests pass
89/89. These remain focused GUI checks, not a new full sweep or new rating.

The first extended Chromium attempt tested focus after deliberately clicking
Findings and therefore failed its own focus assertion. That harness error is
retained separately in `parent-sixteenth-priority-chromium.txt`. The corrected
sequence tests focus before navigating; all three engines pass it.

N6/N7: the recovery banner now names the planning record's kind and title;
Add planning record has a visible, associated explanation while recovery or
another edit prevents use. The empty state points to restoring/discarding the
saved draft rather than an unavailable action. The document/record link field
is labelled separately from the checked-component picker. The real restart,
restore, save and cancel journey passes in `parent-sixteenth-planning-recovery.txt`.

N4: object-literal arrow/function properties are now observed and own their body
calls. A failing-before probe established the missing `zeta` declaration. The
first post-fix assertion accidentally counted the module's containment edge as
a call, and one comparison test encountered sandbox `listen EPERM`; those logs
are retained. The corrected source/observation/HTTP-comparison boundary passes
11/11 (`parent-sixteenth-commonjs-final.txt`). Reader v3 prevents reusing a v2
snapshot identity for the extended extraction. Complex CommonJS aliasing after
object replacement remains explicitly unresolved rather than guessed.

The new type-choice GUI journey also passes (`parent-type-choices-validated.txt`).
Its initial attempt used Playwright's shorthand newPage, which axe rejects; the
corrected test uses an explicit context. The recovery/keyboard/application
assertions were retained, not weakened.

N5 now retains a real call-contract counterexample even when that failed call
leaves a supplied result unused. Configuration issues remain separate and
prevent non-violated properties passing. Six real engine/emission checks, source
replay, real MCP and the scenario/trace GUI journey pass. The first two corrected
fixtures exposed the separate N9 lack of local abstract-result propagation;
their unexpected aggregate exit 2 is retained, not counted as a product failure.

N8's three reproduced error cases now have separate useful messages: unknown
observed declaration, missing project-relative source file, and malformed
creation edit with a template action. Real MCP regressions pass without source
writes. The original vague/raw messages remain in `parent-agent-errors-before.txt`.


N9/N10: local scalar result facts now retain declared types, narrow supported
abstract guarantees after established preconditions and propagate assumption
provenance to consumers and branch-dependent returns. Concrete guarantees are
not assumed. V002 rejects known inconsistent operation guarantees. The same
interval/Bool feasibility fragment is used; unsupported logic stays unresolved.
The new tests exposed and repaired evaluation of unreachable fallthrough returns
after known branches. The focused boundary passes 39 tests; the complete later
core boundary passes 628. Producer assumption notices are retained as well as the
new consuming-call provenance.

N11–N13: exact duplicate related locations are removed. A range-caused invariant
finding explicitly prioritizes the assigning event instead of encouraging a
weaker invariant. Formatter syntax errors identify the first location and return
exit 1 without writing; Revert explains that unfinished range forms are retained.
Six real Quint/TLC range checks validate the diagnostic changes.

Existing-operation GUI: three-engine final journeys pass with partial-expression
restart, outside-source refresh without reload, explicit conflict choice, caller
impact and real errors, unchanged disk source, Undo and keyboard focus. Logs are
`parent-operation-gui-{chromium,firefox,webkit}-final.txt`. Full integration gates
are still separate and no newer independent score has been assigned.


A later independent probe found an incomplete Boolean-equality boundary in the
new guarantee propagation: conflicting `result == true && result == false`
clauses could select the last value. The 628-test candidate's partial GUI sweep
was deliberately stopped. The repair checks Boolean equalities in shared
feasibility and tests every conjunct before accepting narrowed facts, including
contradictions dependent on a concrete input. Independent enumeration covers
441 bounded integer comparisons and 144 Boolean truth-table comparisons. Pure
helper rules also require their own established preconditions before their body
can supply a fact. The wider validation is restarted after this correction.
