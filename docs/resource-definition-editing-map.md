# Editing a retained resource lifecycle in Blocks

The source, Studio/MCP previews and first GUI/recovery journeys are implemented.
The broader integration boundary passes 529 local tests and all 89 registered
GUI journeys on one unchanged candidate; exact evidence is in
`evidence/product-audit/resource-edit-validation.json`. Creation already
works; editing an existing definition must be explicit and retain the same
resource identity. A typed name must never convert a create form into an edit.

The first observable probe removes an allowed transition from a real file
lifecycle, previews affected components and makes the existing checker reject a
now-illegal transition. It must preserve unrelated declarations and comments,
reject a stale source hash, and leave source files untouched until explicit Save.

## Shared contracts

- Reuse the creation form's state/initial/terminal/transition schema and one
  canonical resource writer. Validation must not diverge between create/edit.
- Describe the checked AST with its symbol ID, source/declaration hashes and
  structured definition. The resource name stays fixed in this slice; state
  changes can break callers and must expose that impact, not silently rename
  transition statements throughout the project.
- Use the shared source-edit preview and reverse dependency closure. Recovered
  syntax or incomplete source discovery prevents a complete-impact claim.
- An unchanged form is a no-op. Rebuilding a definition preserves internal and
  trailing comments as explicitly labelled prior notes, with their old source
  line and a review notice; comments outside the definition remain byte-exact.
- State removal must leave dangling initial/transition selections visibly invalid
  in the form. Terminal membership may be removed with the deleted state, never
  silently transferred to another state.

## GUI and recovery work after the first source probe

Open the existing lifecycle from its Blocks card. Reuse the resource fields,
preview before applying, show affected components, and use the same unsaved
buffer/undo/Save contract as other structural forms. Keep create and edit modes
visibly distinct. One unfinished declaration form is retained; opening another
must preserve it rather than overwrite it.

Recovery retains the edited definition and its checked baseline, never approval.
An unrelated source/comment change can use a fresh preview. If the lifecycle
itself changed, show current and saved definitions and require an explicit
resolution before preview. A removed/renamed resource remains a recoverable form
with an explanation; do not guess a replacement identity.

## Probes and limits

1. Remove Open→Closed: the actual caller must fail; restore it and the caller
   passes, while unrelated source remains byte-exact.
2. Change the initial or terminal state: real ownership exit findings change.
3. Rename a state: initial/terminal/transition form references follow only when
   unambiguous; other program references are reported as affected, not rewritten.
4. Duplicate state/edge, missing endpoint and zero cleanup states are refused.
5. Preserve comments with provenance, including a trailing declaration comment.
6. Held/stale preview, restart, concurrent structural change and keyboard-only
   editing follow the existing authoring safety tests.
7. Existing definitions beyond the form's 40-state/80-transition limits remain
   readable and editable in Text; no silent trimming.

Whole-resource renames, automatic state-use migration and full finite-machine
creation remain separate decisions. No new ownership semantics or checker is
introduced here.

## Executed probes so far

Source tests prove real invalid transitions after an edit, unchanged unrelated
source, explicit comment provenance, stale/name/endpoint rejection and visible
form limits. Studio and actual MCP previews are read-only. The GUI removes and
restores a transition, sees the real R002 finding and preserves disk bytes. A
blank state survives an actual restart; a concurrent rule change blocks preview
until current and edited definitions are explicitly resolved. The initial GUI
probe used an incorrect expected sentence; that failure is retained separately
from the corrected journey. Resource forms now use readable state cards and a
wider layout. Full integration and additional stale/keyboard probes follow.

## Fourteenth-review merge extension

When current and saved edits diverge, offer an explicit three-way combination
of independent transition and terminal-set changes. State-list and initial-state
changes merge only when one side is unchanged or both agree. Incompatible
changes stay unresolved. Shared resource validation must reject combined dangling
references or invalid lifecycles; the browser does not add a second validator.
Show each side's additions/removals and require the normal source preview after
choosing a combination. Combining never writes source or acknowledges a review.
