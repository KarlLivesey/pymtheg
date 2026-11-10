# Atomic numeric-range editing in Blocks

The fifteenth review identifies a usability gap: event-model creation can define
numeric ranges, but existing models require Text for range changes. A user fixing
a range counterexample must be able to change those bounds without reading the
grammar. The paired editor is implemented and its focused source, recovery and browser
checks pass. This is a bounded authoring feature, not a completion score.

## Draft and source contracts

- The parser owns optional half-open spans for each numeric bound. Include the
  minus sign, exclude `in`, `..`, `=` and comments. Synthetic generated-machine
  ASTs need no bound spans. Analysis semantics do not change.
- The state block projects one range-edit object with both spans, current raw
  bound text, state type, a stable machine/state key and a hash of its source
  declaration. Keys must not depend on absolute project paths or list positions.
- A bounded recoverable draft stores the project-relative file, that key/hash,
  original bounds and both unfinished input strings. It does not write partial
  strings such as `-` into source or trigger parsing on every keystroke.
- Inputs use plain Minimum/Maximum labels and an explicit Apply range action.
  Blank or malformed numbers remain editable drafts. Apply validates whole
  numbers and uses the shared numeric-domain rules; it replaces both spans in
  one source transaction, preserves surrounding comments and triggers the normal
  check. Text/Blocks share the same undo history.
- Closing, switching views/files and restart retain the draft. The ordinary
  draft indicator must include it; never say there is no unsaved work while a
  range draft exists. Applying/discarding clears only that state's draft.
- If the target state was renamed, removed or edited since the draft, refuse
  application with an explicit review/reset route. Do not transfer a draft by
  index or silently overwrite a different state. Unrelated changes outside the
  state need not invalidate it.

## First probes

1. Start with a range overflow. Change the maximum through Blocks, observe the
   changed model and undo as one source edit; preserve comments and disk bytes.
2. Type `-`, switch views, restart and recover that exact unfinished input. Do
   not use sleeps or assume typing finishes before an automatic check.
3. Reject backwards/Nat-negative ranges without destroying the draft or source.
4. Move the project: relative file/key identity still locates the same state.
5. Change/rename/remove the state during an unfinished edit: require explicit
   handling; editing a different state must not apply the old values.
6. Check keyboard, narrow layout, and the source-spanned range finding/trace.

This design intentionally separates an unfinished range form from applied source.
It does not introduce a second checker or infer that widening a range makes a
safety requirement correct.

## Implemented boundary and evidence

`numeric-range.ts` shares whole-number/Nat validation with machine creation.
The parser records signed literal spans; `describeBlocks` projects state-owned
hashes and machine/state keys. `range-data.ts` applies a pair only against an
unambiguous current state. A general field edit within the same state invalidates
its range projection until canonical rechecking; unrelated field edits map the
unchanged range spans. Numeric equivalence preserves original literal spelling.

`StateRangeEditor` keeps drafts in the main recovery context rather than component
state. The shared dirty indicator and unload guard include them. A global list
reopens draft files, recovered definitions expand by state key, and stale or
orphaned drafts retain their values with explicit reset/discard/Text choices.
Apply uses the common buffer/undo transaction without reformatting unrelated text.

`state-range.test.mjs` covers comments, invalid pairs, relocation, state changes,
ambiguous IDs and durable recovery. The first fixture mistakenly used unsupported
block comments; it was corrected to the language's line comments, without
changing parser acceptance. The first browser narrow-viewport assertion forgot
to scroll to the control; that harness failure is retained in
`parent-range-first.txt`.

The complete extended journey passes in Chromium, Firefox and WebKit: real
overflow counterexample, unfinished `-`, view/file switches, restart, invalid
Nat/backwards ranges, Enter/Apply, corrected bounded simulation, one-step Undo,
external state change, explicit reset and a narrow form axe scan. Screenshots
and separate logs are in `evidence/product-audit/range-*` and `parent-range-*.txt`.
No human screen-reader assessment has been performed.
