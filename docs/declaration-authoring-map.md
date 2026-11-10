# Creating declarations in Blocks

The thirteenth review's primary onboarding blocker is that people must switch
to Text to declare the operations, data and resources their flow uses. Editing
existing declarations does not solve that journey. The create-only
component, operation, data-shape and resource forms are now implemented. Their
source/API/agent and focused GUI journeys pass; current broader validation is
recorded in the progress log.

## User journey and boundary

From an existing Blocks file, choose **Add to this design**, then one of:
component, external operation, data shape, or resource lifecycle. Give it a name
and complete labelled fields. Preview the generated declaration and apply it
to the shared unsaved buffer. The ordinary checker supplies the findings.
Creation never saves to disk and never adds a call, cleanup step or success
path automatically. Text and undo remain available.

- Component and operation forms reuse signature input/output controls, including
  explicit value/borrow/take modes. An operation has no implementation body.
  A component begins with an explicit open design question.
- Data shape reuses the record/outcome editor with bounded nested shapes.
- Resource lifecycle asks for states, starting state, cleanup-complete states
  and allowed transitions. New resources are not automatically settled.
- Effects and cost summaries are declared assumptions. Omitting an operation's
  cost must leave callers' costs unknown, never zero. Atomicity is not a default.
- Finite numeric domains, states, events and safety-rule creation are now a
  separate working slice; see [machine-authoring-map.md](machine-authoring-map.md).
  Its restart/counterexample/correction GUI journey passes; current audit
  identifies the tested browsers and remaining accessibility limits.

## Shared transaction

One bounded authoring request contains a declaration kind, structured fields,
target file, checked run and expected source hash. Validate names, duplicate
members, transition endpoints and limits before generating source. Use the
existing type spelling and nominal-reference policy; do not create a second
type resolver or silently bind an ambiguous name.

Generate additions against the canonical captured IR, then use the shared
source-edit preview and apply guard. Name collisions refuse creation; they
must never convert an add into an edit. Existing declarations/comments stay
byte-identical in the preview. The canonical formatter prepares newly generated
source, and the normal checker validates it after application.

The form draft retains its target and incomplete fields in local recovery.
Resuming always checks a fresh source snapshot. One unfinished creation form is
kept at a time; starting again resumes it. Discard is explicit, and closing does
not discard it.
Source changes require a new preview; recovery does not imply source approval.
A loaded draft is editable even if the original declaration context disappeared.

## First probes

1. Add an abstract operation with an input, three possible outcomes and a remote
   effect. Call it in Blocks, see the actual outcomes and required effect. Its
   unspecified work remains unknown.
2. Add a resource lifecycle, create it in a flow and get a real missing-cleanup
   finding; fix normal and cancellation paths through existing block controls.
3. Add a nested record/outcome type, use it in a signature and preview effects on
   consumers. Duplicate names are refused without changing source.
4. Begin each form, leave a field unfinished, restart Studio and resume it.
5. Hold the preview, edit/switch source, then release: old source cannot win.
6. Complete the workflow with keyboard-only interaction and narrow layout.

Each probe closes a small implementation loop. A complete form schema alone,
generated text alone or a green unit suite does not establish first-use quality.

## Current evidence and remaining limits

- Source tests validate append-only source preservation, duplicate-name refusal,
  nested types, explicit operation assumptions and unknown work.
- Studio and real MCP preview the same builder, including virtual files.
- The operation GUI journey creates a declaration, adds a call, exposes the
  missing effect and corrects it through the interface form.
- The resource/data/component journey edits lifecycle states, removes and
  replaces a cleanup state, observes/fixes a real leak, restores an unfinished
  data shape after restart and reuses it as a component output.
- A held preview cannot overwrite a newer Text edit; resuming needs a fresh
  preview. No journey silently writes source.

These controls create declarations. Editing an existing resource definition is implemented through the same form
and validation, including restart/conflict recovery; see
`resource-definition-editing-map.md`. Richer operation constraints and rewriting
existing complete machine definitions remain open. New-machine creation has
source/API/backend evidence, with GUI acceptance still pending.
New type declarations may resolve missing references, so creation previews do
not claim a complete old-graph impact list. The normal recheck supplies current
findings. Cost controls create constant exact/upper summaries; symbolic formulas
remain available in Text. Atomicity is an explicit unchecked assumption.

The first completed broad GUI boundary is 85/85 on pinned Chromium, recorded in
`parent-declaration-pinned-gui/journeys.json`. Later focused checks add unique
default input names after removal and paged MCP creation catalogues. The normal
and creation interface forms share input allocation; they do not independently
invent naming rules. Cross-file type discovery/import is now implemented with
source/API/MCP evidence; its GUI acceptance remains pending. See
`declaration-type-import-map.md` for identity, staleness and limit contracts.

## Contextual creation guidance after the fifteenth freeze

The same short purpose text used by MCP templates is now placed beside the
fields in each Studio declaration form. New forms explicitly label their
starting names and values as examples to customize. Existing lifecycle edits
do not receive that example label. Shared text explains inputs, unknown work,
resource cleanup and event safety rules in ordinary program-design terms.

This is a working-tree follow-up outside the immutable fifteenth review
candidate. Core/Web TypeScript checks and the real MCP template workflow pass.
Its visual/keyboard check is pending the reviewer's browser release. Generic
editable defaults remain intentional starting points; this change does not
claim to resolve every default-choice usability concern.
