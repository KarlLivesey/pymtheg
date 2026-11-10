# Visual block editor and presentation standard

Karl explicitly requires a friendly visual block editor alongside source text,
and clearer visual standards. Existing snippet insertion is not this feature.

## Current capability and acceptance boundary

Blocks and Text share source, undo, checking and recovery. Current forms create
components, external operations, data shapes, resource lifecycles and finite
event models. Existing interfaces, types, lifecycles, state ranges and operation
rules/work can be edited with guarded previews. Unanswered type choices remain
unfinished form data; unsupported source stays visible and editable in Text.

All 101 GUI journeys pass across the two recorded batches in
[the current GUI evidence](../evidence/product-audit/seventeenth-gui-validation.json).
The operation-edit journey additionally passes in Chromium, Firefox and WebKit.
These are observed paths, not proof of universal usability. Independent
whole-product review is pending; real screen-reader use remains unverified.

The remaining sections retain the original staged implementation contract.
Phrases such as “next slice” describe that historical stage; use the
[current completion audit](current-completion-audit.md) for open release work.

## Editing contract

- One `.pym` source buffer remains authoritative. Text and block modes edit it;
  there is no second independently executable block language.
- Project the checked AST into declaration cards and nested statement blocks.
  Inputs, outputs, calls, decisions, repetition, resource transitions and open
  questions have distinct plain-language controls.
- Every field/block retains its source span and snapshot identity. Edits are
  source transactions, preserving surrounding comments and unsupported syntax.
  Stale transactions are refused or rebased explicitly, never applied by offset
  to a newer document silently.
- Unsupported or malformed regions remain visible source blocks. A damaged
  region does not erase unrelated readable blocks or imply an empty body.
- Adding a block with an unanswered question creates an explicit unknown, not
  invented success, zero work or a silent no-op.
- Reordering has keyboard controls as well as pointer interaction. Nested branches
  retain their boundaries; moving attached comments requires an explicit rule.
- Block changes use the same recovery, undo, check, source navigation and save
  conflict contracts as text editing. Unsaved field values must survive switching
  modes and recovery; a displayed draft is not a saved specification.

## Presentation standard

Use a shared spacing/type/colour scale, readable body text, short field labels,
and clear grouping. A component card starts with its purpose and inputs/output,
then its steps and open questions. Advanced effects/contracts remain available
without crowding first use. Source, diagnostics and graph selections should
identify the same construct. Colour is supplemental to labels and shape.

The initial view should make the next action obvious. Avoid a blank canvas,
dense toolbars, unexplained syntax, icon-only actions and mandatory manuals.
Keep comfortable default density; offer compact views for large designs.

## Acceptance journeys

1. Create a component, add inputs and an output, add a call and a decision using
   blocks; run the real checker and open its finding at the corresponding block.
2. Change a repetition count and see the structural work result change.
3. Switch to text, make an edit, return to blocks, and preserve the exact source,
   comments, unknown regions and undo history.
4. Recover an unfinished field/block after restart; resolve an external edit
   without losing either version.
5. Use the entire block workflow with the keyboard at narrow and normal widths.
6. Inspect a large design through scoped cards/graphs with explicit paging and
   no hidden omitted blocks. No correctness assertion uses computer speed.

Historical first-slice status: an initial working editor was implemented and checked. The shared-source
repeat/cost/undo, incomplete-field, stale-response, restart and narrow-layout
journeys pass. The full builder remains open: rich visual resource/type/event
interiors, larger authoring journeys and broader accessibility evidence are still
required before a readiness claim.

The first concrete slice projects existing `ProjectIR` statements into labelled
cards, with field spans for call arguments, return values, decisions and loop
counts. Parser-owned body spans provide safe insertion positions; no second
parser is introduced in the GUI. Keep the text editor mounted when block mode is
visible so its source history remains authoritative, and expose undo/redo through
the same editor transaction interface. Unsupported constructs retain a visible
source card. First acceptance: change a loop count through a block, observe the
real work result, then switch to text and undo the same edit without losing a
comment or an unrelated declaration.

The next call-result slice uses the resolved callee result from the same IR to
list actual outcome tags and payloads. A handler action inserts every declared
branch with an explicit unanswered question. Returning a result is offered only
when it fits the enclosing component's result type, and is an explicit user
choice. Neither action invents a success branch or drops an existing step.

Yes/no call results offer two open branches using the canonical Bool type.
Field transactions resolve the current field by identity so another local edit
cannot leave a queued event pointing at an old source offset.

The resource slice exposes declared states, initial/terminal markers and
transitions as readable lifecycle cards. State-change controls edit parser-owned
identifier spans; the canonical type environment supplies the resource type.
The state list is not a claim that every transition is legal from the current
path. Existing ownership analysis continues to judge legality and every exit.
Creating/changing cleanup must never silently add a success result or acknowledge
an obligation. Rich lifecycle-definition authoring remains a separate slice.

Resource step creation uses scoped resource names captured by the type resolver,
not a GUI reconstruction of variables. Capture at most 100 resource bindings
per block, with an explicit total/truncation notice. Scope membership is not
ownership liveness: selecting a moved resource can still produce a real finding.
Insert steps before a final return/propagation, retaining its leading notes.
Cancellation starts with an explicit unanswered cleanup question; adding a handler
alone must never be presented as satisfying its obligations.

The data/event slice projects type members and finite-machine states, guards,
updates and invariants as child cards from the same AST. Field edits replace
only their parser-owned range; no event is translated into a structured-flow
statement. The initial slice edits existing definitions. Adding/removing members,
changing finite domains and rewriting relationships remain separate actions until
their source-preserving transactions and impact previews are implemented.
These child cards consume the same projection budget as flow blocks.

Call-input holes should look like unanswered fields, not require authors to erase
an `unknown` expression before typing. Keep the exact unknown source until the
user enters a value. The resolver can suggest type-compatible in-scope names for
these holes (bounded scan and output); the UI never chooses one automatically.
Suggestions do not establish ownership liveness or remove the unresolved finding.

Standalone shape editing will reuse the interface form's type spelling,
nominal-reference validation and comment-preserving rewrite. It previews against
one checked snapshot and reports transitive affected declarations before applying
changes to buffers. No source is saved by the preview. A stale source hash refuses
the edit. Shared type names cannot be casually renamed; name/reference migration
requires a separate reviewed operation. New nested definitions follow the same
collision policy as callable-interface authoring.

### Eighteenth-review maintenance extension

Existing flow cards have a contract form for caller/return rules, work budgets
and input bounds. It shares durable drafts, current-source comparison, preview,
Apply, undo and guarded saves with operation editing. Budget/bound rows support
keyboard addition/removal. Preview retains its trigger focus. The focused journey
passes in Chromium and WebKit, including a browser reload before application.
Renamed inputs explicitly warn about retained references; unsupported expression
rewrites still require deliberate source edits rather than silent renaming.
