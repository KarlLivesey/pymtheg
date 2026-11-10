# Editing existing operation contracts

Creation and existing-operation forms expose caller rules, return guarantees
and work summaries. Existing operations additionally accept symbolic counts.
The edit path uses the same checked source, preview and recovery model.
It is outside the immutable sixteenth-review candidate.

## First source slice

- The parser records optional full metadata-clause spans on the canonical AST.
  This is source ownership metadata, not a second parse or changed semantics.
- Describe an existing operation's requires/ensures/cost clauses as bounded raw
  expression fields with source and declaration hashes. Preserve signatures,
  effects, bounds, atomicity, stability, creation/settlement/protocol clauses and
  adjacent declarations. Constant and symbolic cost expressions are supported.
- Preview requires the expected current source hash and an unrecovered parsed
  operation. It never saves. The existing source-edit engine reports affected
  callers and incomplete discovery; the normal checker judges meaning after apply.
- Update/remove only the corresponding clause spans. New clauses go before the
  operation's final semicolon. Untouched clauses and comments stay byte-identical.
  If changing/removing a clause would delete embedded comments, refuse that edit
  with an exact Text fallback. Do not relocate notes under an unrelated rule.
- Share single-expression validation/source spelling with operation creation.
  Blank added expressions become explicit unknowns; no missing rule or cost is
  silently true or zero. External guarantees remain labelled assumptions.
- Draft indices are temporary form positions, never durable entity identity.
  Resume against a changed operation must compare its captured declaration and
  offer an explicit conflict decision before any apply.

## Subsequent interaction slice

Use the existing operation-rule fields and a recoverable edit form from the
operation's Blocks card. Inputs/effects remain editable through the existing
interface form. Preview lists source changes and affected callers; Apply enters
one unsaved, undoable buffer transaction. Concurrent changes must not overwrite
one another. MCP exposes describe/preview through the same source functions.
No GUI/MCP completion is claimed by implementing the first source slice alone.

## Required probes

1. Change a precondition/cost, recheck an affected caller and observe the real
   contract/budget change. Keep an independent component clear.
2. Preserve advanced clauses, expression strings containing //, leading/trailing
   notes and untouched bytes. Reject only edits that would erase embedded notes.
3. Add/remove rules and symbolic costs, preserve explicit unknowns, reject stale
   source, wrong kind, injection, limits and overlapping changes.
4. Restart with incomplete fields; compare conflicting source edits and retain
   both choices. Actual browser/keyboard and real MCP evidence is required before
   calling the full authoring feature delivered.

## Source and connection evidence

The first source slice and both connection actions are implemented:
`design_interface operation / preview_operation` and Studio's corresponding
operation/preview-operation interface actions. Both use `operation-contract.ts`
and the canonical metadata-clause spans. The Blocks operation card opens a
recoverable GUI form using a separate bounded operation-draft schema.

Tests show real changed caller/precondition and cost findings, preserve provider,
creation and settlement clauses, retain notes, refuse comment-erasing edits,
keep blank rules/costs explicitly unknown, and reject injection/stale hashes.
Real MCP and Studio HTTP previews preserve disk source. Creation and editing
share rule/cost generation; four real Quint/TLC creation probes still pass.
The full local suite passed 610/610 before the later sixteenth-priority fixes;
those now pass 614/614. See `parent-operation-edit-*.txt` and
`parent-sixteenth-priority-full-local.txt` under `evidence/product-audit/`.


## Current interaction evidence

`studio-operation-edit.browser.mjs` passes in Chromium, Firefox and WebKit
(`parent-operation-gui-*-final.txt`). It retains an unfinished expression across
restart, refuses its preview until corrected, reloads an outside source edit
without requiring a page reload, displays both versions and requires an explicit
choice. It checks real C004/K002 findings after Apply, one Undo, unchanged disk
source, focus after adding/removing rules and work, Apply focus, and narrow axe.
The initial passes are retained separately from the final polished build.

The current core boundary is 632 local tests, with 95 real compiler/backend
checks and the offline package passing. All 101 GUI journeys pass in two
manifest-checked batches; only the corrected guide test changed between them.
This is a bounded authoring capability, not a claim that external implementations
keep their declared guarantees. Real screen-reader use remains unverified.

## Seventeenth-review clause identity and missing operations

The earlier positional rewrite could attach a surviving rule to a deleted rule's
note. Descriptions now expose original clause origins; new forms preserve them
through deletion/addition/recovery. Preview validates those origins, preserves the
surviving source spans, labels retained removed-clause notes and removes empty
owned lines. Legacy clients without origins match unchanged clauses first; clients
combining edits and deletions should retain explicit origins. A renamed/removed
operation returns 409 naming the operation and file, with a retained downloadable
form instead of an HTTP 500. Focused source and real HTTP regressions cover these
boundaries; current GUI validation is recorded separately from the earlier sweep.

## Component maintenance (after eighteenth freeze)

The contract description/preview also accepts flow components. It exposes their
caller rules, return obligations, named work budgets and input bounds. Blocks
shares the existing durable form and conflict workflow. Named budgets and bounds
preserve adjacent notes; unknown input bounds are refused. Input-name changes in
the interface preview warn that body/rule/bound references need review.
Legacy rule edits that combine changed clauses and deletion without origins are
refused when identity is ambiguous. Pure additions and exact retained clauses
remain usable. No source or note is silently reassigned to another obligation.

The same form edits symbolic component `overhead` separately from total work
budgets. It emits concrete overhead on flows and abstract `cost` summaries on
external operations; called operations and loops are counted independently.
