# Operation rules in declaration forms

This is post-fifteenth-freeze work. The existing language and canonical checker
already support operation preconditions (`requires`) and assumed guarantees
(`ensures`). The visual creation form does not yet expose them. This slice adds
optional rule fields without introducing a second evaluator or proving an
external service implementation.

## Contract and ownership

- The declaration request keeps bounded `requires` and `ensures` string arrays:
  at most 20 rules each, at most 1,000 characters per rule. Missing arrays mean
  no declared rules, preserving existing callers and recovered drafts.
- Blank added rules remain explicit unknown expressions. Empty arrays make no
  promise. Draft recovery retains incomplete expressions verbatim.
- The existing parser validates that each field contains exactly one expression;
  the canonical checked IR owns names, types and proof status after applying.
  Share this boundary with finite-event fields instead of copying a parser.
- A precondition is a demand on callers. An operation's postcondition is an
  environmental assumption, not a verified implementation fact. Display this
  beside the controls and in source-preview notices.
- Ordinary create-only, source hash, fresh preview, unsaved-buffer and undo
  boundaries remain unchanged. No source writes or calls are added implicitly.

## First probes

1. Create an operation with `amount > 0` and `result >= amount`. Check a valid
   guarded caller, then a zero-valued caller; the existing checker must expose
   the real precondition violation.
2. Add a blank rule. It must become an explicit unknown and prevent unqualified
   complete evidence, rather than silently become `true` or disappear.
3. Try injected declarations, metadata, malformed syntax and oversized lists.
   Refuse before source mutation. Preserve the original source in every case.
4. Recover an unfinished rule and preview it through the real MCP endpoint.
5. Once the independent reviewer releases the browser, create, restart, correct
   and apply rules from the GUI and inspect an actual source-spanned finding.

This first slice creates operation rules. Editing existing operation contracts,
resource-settlement/provider-protocol controls and fully visual expression
composition remain separate decisions. No current GUI pass is claimed.

## Current evidence

The source writer, bounded optional arrays, shared expression validator, form
controls and MCP template fields are implemented after the fifteenth freeze.
`parent-operation-rules-local.txt` passes 11 source/machine/declaration checks.
`parent-operation-rules-recovery-fixed.txt` passes the real MCP, recovery and
source checks. The first recovery fixture omitted required context fields; its
failure is retained in `parent-operation-rules-recovery.txt` rather than counted
as a product defect. Four real event-model integrations pass after extracting
the common expression boundary (`parent-shared-authoring-parser-integration.txt`).

`studio-operation-rules.browser.mjs` is prepared and registered but **unrun**
while the independent reviewer owns the browser. It checks restart with an
incomplete rule, assumed-guarantee wording, narrow layout/axe, a real precondition
finding and correction through Blocks without saving source. The existing
94-journey result does not cover this extension.

The integrated local boundary now passes **579/579**, with no failures/skips
(`parent-operation-rules-full-local.txt`), and formatting passes. This is source
and service evidence, not a claim that the new UI journey has passed.

A separate rolling-project acceptance test strengthens one operation rule in
a 130-file snapshot. It produces exactly 128 caller violations, propagates
contract impact to all 128 consumers, flags the dependent plan, and leaves an
independent plan clear. Parser counts remain exactly 130 per snapshot. Evidence:
`parent-operation-project-impact.txt`; this additional test is not included in
the earlier 579-test full-suite count.

The small before/after CLI example exposed a pre-existing text-rendering bug:
raw JSON.stringify could not serialize a BigInt feasibility witness. The renderer
now uses shared exact-integer serialization. Real CLI regressions exercise large
positive/negative witnesses and a violating caller. Retained example sources and
outputs are in `evidence/product-audit/operation-rules-probe/`; the original
`before.txt` is the crash, and `before-fixed.txt`/`after-fixed.txt` show the repair.

## Executable authoring boundary model

`examples/self/contract-authoring.pym` contrasts premature publication of a
parsed preview with publication gated on a complete check of the current
source version. The finite version range 0..2 models an edit while checking;
blank rules initially remain unknown even though they parse.
`self-contract-authoring.test.mjs` source-replays the bad policy and exercises
unknown, late-result and corrected paths through the good policy. Real TLC
results are recorded separately. This model checks the policy, not conformance
of the React, worker or persistence implementation; those keep their own tests.

Real TLC evidence now source-replays the premature-policy counterexample and
exhausts 130 states of the guarded policy without a violation. The checked
scope has source versions 0..2 and the fields described in the example; it
does not prove arbitrary histories or production implementation conformance.
Reports: `self-contract-authoring-bug.json` and
`self-contract-authoring-fixed.json` under `evidence/product-audit/`.

## Behavioural integration

`operation-authoring.integration.mjs` sends generated operations through real
Quint and TLC. Both find a source-replayed failed assertion without a declared
guarantee. With the guarantee, both report no counterexample in their requested
scope and explicitly label the operation postcondition as assumed, with the
external implementation unverified. All four probes pass without skips in
`parent-operation-behaviour-fixed.txt`.

The first probe exposed missing specificity in behavioural assumption text,
which described only generic abstract outcomes/effects. `behaviour/flow.ts` now
retains an explicit postcondition assumption per operation when applicable.
The first harness also wrongly required every property to fail when one failed;
that assertion was corrected to retain independent inconclusive properties.
The original combined failure remains in `parent-operation-behaviour-before.txt`.
