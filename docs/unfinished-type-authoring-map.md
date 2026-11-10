# Choosing types before preview

The fifteenth review observed that adding a record field silently chooses Text.
That is an authoring assumption with design consequences. An added value slot
should ask what it holds, while preserving the user's partial form on restart.
This is a working-tree follow-up outside the frozen sixteenth candidate.

## Draft contract

Add a draft-only `{ kind: "unselected" }` member to the shared authoring type
shape. Draft validation accepts it, complete validation and all source writers
reject it with a specific choice-required message. It is not a Pymtheg language
type, unknown runtime value, or a claim that an interface has been checked.
Existing forms, examples, saved drafts and generated designs stay readable.

New inputs, record fields, list item types and enabled outcome payloads start
unselected. Selecting a composite kind may expose additional unselected slots.
The existing labelled example templates remain examples rather than being
rewritten. The dropdown shows "Choose a type" with a short explanation of what the value
holds and practical
plain-language choices. Once selected, it can be explicitly cleared back to the
unselected draft state. No field is silently assigned Text on addition.

Use the existing main recovery schemas and guarded preview transaction. There
must be no second source builder, no newly accepted language syntax and no
partial output file. Nested types and agent-supplied draft values follow the
same validation contract. The source writer rejects unselected nodes even when
called without prior form validation.

## First checks

- Added fields/inputs have distinct names and unselected types.
- Incomplete nested slots round-trip through actual recovery; preview explains
  which choice remains and emits no source. A selected type then generates and
  checks through the normal pipeline.
- Existing complete and legacy drafts still validate.
- Restart, new-field dropdown, keyboard selection and nested list/payload
  selection are covered in a browser journey after the reviewer releases it.
- Use "Data shape" consistently in declaration-form labels instead of "New shape".

## Current evidence

The source writer rejects an unanswered type directly, in nested lists/outcomes
and through declaration/interface preview. Durable recovery round-trips the
exact unfinished field. Completing it generates a normally checked declaration.
The real MCP template test also refuses an unanswered field without disk changes.
The complete local suite passes 601/601, and the focused real-MCP/source rerun
passes 4/4; formatting and the installed private-package smoke pass. Logs: `parent-unselected-full-local.txt`,
`parent-unselected-mcp.txt`, `parent-unselected-format.txt`.

The updated browser scripts deliberately choose types previously inherited from
Text defaults. `studio-type-choices.browser.mjs` is a new recovery/keyboard/
preview journey; `studio-type-authoring.browser.mjs` now checks an unanswered
field survives restart and fails preview until selected. These and the affected
rich-interface/creation journeys remain unrun while the independent reviewer
owns the browser. This working tree is newer than the frozen review candidate.

## Conflict-display follow-up

Strict source generation must not be reused for displaying unfinished drafts.
Both interface and shared-type conflict screens originally threw when asked to
render an unanswered saved type. Actual React render tests reproduce both
crashes (`parent-type-conflict-reproduced.txt`). The first SSR setup failed
earlier on a missing browser `location`; that harness error is retained in
`parent-type-conflict-before.txt` and fixed by stubbing only the unused network
module. No conflict component or data was mocked.

`describeDraftType` now produces bounded display-only text, including "type not
chosen". The source writer still refuses that draft. Both component render
regressions pass (`parent-type-conflict-fixed.txt`). The prepared browser
journeys additionally choose a saved unanswered field/input after concurrent
edits and verify preview remains blocked until a real type is selected. They
remain unrun until the reviewer releases the browser.
